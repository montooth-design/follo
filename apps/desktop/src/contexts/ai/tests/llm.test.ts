import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CompatibleLlmProvider, validateEndpoint } from '@follo/llm';
import { CredentialVault } from '../configuration/credential-vault';
import { AiService } from '../configuration/ai-service';
import { LocalDatabase } from '@follo/database';

const signal = () => new AbortController().signal;
const request = () => ({
  model: 'fixture-model',
  messages: [{ role: 'user' as const, content: 'Fixture prompt' }],
  tools: [
    { name: 'get_file', description: 'Fixture', parameters: { type: 'object', properties: {} } },
  ],
  signal: signal(),
});
test('protocol adapter translates native calls, preserves usage, rejects redirects/insecure URLs and redacts provider failures', async () => {
  let sent: Record<string, unknown> | undefined;

  const transport: typeof fetch = async (_url, options) => {
    assert.equal(options!.redirect, 'error');
    sent = JSON.parse(String(options!.body));

    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call1',
                  type: 'function',
                  function: { name: 'get_file', arguments: '{"fileId":"f"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
    );
  };

  const response = await new CompatibleLlmProvider(
    'https://fixture.example/v1',
    'fixture-secret',
    transport,
  ).respond(request());
  assert.equal(response.toolCalls[0].name, 'get_file');
  assert.equal(response.usage.inputTokens, 10);
  assert.equal(sent!.model, 'fixture-model');
  assert.equal(sent!.store, false);
  assert.equal(validateEndpoint('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
  for (const url of [
    'http://remote.example/v1',
    'https://user:secret@fixture.example',
    'https://fixture.example/?key=secret',
    'file:///private',
  ])
    assert.throws(() => validateEndpoint(url));
  await assert.rejects(
    new CompatibleLlmProvider('https://fixture.example/v1', 'fixture-secret', async () => {
      throw new Error('fixture-secret');
    }).respond(request()),
    (error) => !String(error).includes('fixture-secret'),
  );
  await assert.rejects(
    new CompatibleLlmProvider(
      'https://fixture.example/v1',
      'fixture-secret',
      async () => new Response('invalid fixture-secret JSON'),
    ).respond(request()),
    (error) => !String(error).includes('fixture-secret'),
  );
});
test('streaming reconstructs split tool arguments and UTF-8 content, rejects incomplete streams', async () => {
  const events = [
    {
      choices: [
        {
          delta: {
            content: 'Evidence é',
            tool_calls: [
              {
                index: 0,
                id: 'c1',
                type: 'function',
                function: { name: 'get_file', arguments: '{"file' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: 'Id":"f"}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ];
  const data =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  const transport: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const bytes = new TextEncoder().encode(data);
          for (let index = 0; index < bytes.length; index += 7)
            controller.enqueue(bytes.slice(index, index + 7));
          controller.close();
        },
      }),
    );
  const results = [];
  for await (const event of new CompatibleLlmProvider(
    'https://fixture.example/v1',
    '',
    transport,
  ).stream(request()))
    results.push(event);
  assert.equal(results[0].type, 'text');
  const complete = results.at(-1)!;
  assert.equal(complete.type, 'complete');

  if (complete.type === 'complete') {
    assert.equal(complete.response.text, 'Evidence é');
    assert.equal(complete.response.toolCalls[0].arguments, '{"fileId":"f"}');
  }

  const broken = new CompatibleLlmProvider(
    'https://fixture.example/v1',
    '',
    async () => new Response('data: {"choices":[]}\n\n'),
  );
  await assert.rejects(async () => {
    for await (const event of broken.stream(request())) void event;
  }, /without a complete/);
});
test('AI configuration defaults off; encrypted credentials stay outside SQLite and endpoint changes cannot reuse them', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-vault-'));
  const secret = randomBytes(32);
  const protection = {
    isEncryptionAvailable: () => true,
    encryptString(value: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secret, nonce);
      const body = Buffer.concat([cipher.update(value), cipher.final()]);

      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    },
    decryptString(value: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));

      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
    },
  };
  const db = new LocalDatabase(':memory:');
  const vault = new CredentialVault(path.join(root, 'credential'), protection);

  try {
    const ai = new AiService(db, vault);
    assert.equal(ai.status().llm.configured, false);
    assert.throws(() => ai.connection(), /not configured/);
    const status = ai.configure({
      endpoint: 'https://fixture.example/v1',
      model: 'fixture',
      apiKey: 'fixture-secret',
    });
    assert.equal(status.llm.verified, false);
    assert.equal(JSON.stringify(db.readConfiguration('llm')).includes('fixture-secret'), false);
    assert.equal(
      readFileSync(path.join(root, 'credential')).includes(Buffer.from('fixture-secret')),
      false,
    );
    assert.equal(vault.get('https://fixture.example/v1'), 'fixture-secret');
    assert.throws(() => vault.get('https://other.example/v1'), /does not belong/);
    const unavailable = new CredentialVault(path.join(root, 'blocked'), {
      ...protection,
      getSelectedStorageBackend: () => 'basic_text',
    });
    assert.equal(unavailable.available(), false);
    assert.throws(() => unavailable.set('endpoint', 'secret'), /unavailable/);
    ai.configure(null);
    assert.equal(ai.status().llm.configured, false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
import { NativeDecisionProvider } from '../providers/native-decision-provider';
import { AnalysisService } from '../../repositories/application/analysis-service';
import { DecisionService } from '../decisions/decision-service';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

test('OpenRouter roles use separate native APIs, verified decision results persist without source or credentials', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-decision-provider-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));
  const protection = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from([...text].reverse().join('')),
    decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
  };
  const llmVault = new CredentialVault(path.join(root, 'llm'), protection);
  const decisionVault = new CredentialVault(path.join(root, 'decision'), protection);
  let invalid = false;
  let changed: (() => void) | undefined;
  let requests = 0;

  const transport: typeof fetch = async (url, options) => {
    requests++;
    if (String(url).includes('/models?'))
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'fixture/chat',
              name: 'Chat',
              architecture: { output_modalities: ['text'] },
              supported_parameters: ['tools'],
            },
            {
              id: 'fixture/decision',
              name: 'Decision',
              architecture: { output_modalities: ['decisions'] },
            },
            {
              id: 'fixture/no-tools',
              name: 'No tools',
              architecture: { output_modalities: ['text'] },
              supported_parameters: [],
            },
          ],
        }),
      );
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(options?.redirect, 'error');
    assert.equal(
      (options!.headers as Record<string, string>).Authorization,
      'Bearer fixture-secret',
    );
    assert.ok(!String(options?.body).includes('privateSourceToken'));
    assert.ok(!String(options?.body).includes('fixture-secret'));
    const body = JSON.parse(String(options?.body));
    assert.ok(!body.messages);
    assert.equal(body.model, 'fixture/decision');
    const test = !!body.questions.connection;
    const id = test ? 'connection' : 'risk';
    const probabilities = test
      ? { READY: 1, NOT_READY: 0 }
      : { LOW: 0.1, MODERATE: 0.7, HIGH: 0.15, CRITICAL: 0.05 };
    if (!test) assert.equal(body.state.linesOfCode, 1);
    changed?.();

    return new Response(
      JSON.stringify({
        answers: {
          [id]: {
            type: 'choice',
            choice: invalid ? 'INVALID' : test ? 'READY' : 'MODERATE',
            probabilities,
          },
        },
        model: body.model,
      }),
    );
  };

  try {
    writeFileSync(path.join(root, 'a.ts'), 'export const privateSourceToken = 7;');
    const parsed = await parseRepository(root);
    const repositoryId = randomUUID();
    db.rememberRepository({
      id: repositoryId,
      path: root,
      name: 'Fixture',
      lastOpenedAt: new Date().toISOString(),
    });
    const saved = db.saveAnalysis(
      repositoryId,
      { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() },
      {
        status: 'not-repository',
        root: null,
        branch: null,
        commit: null,
        detached: false,
        workingTree: 'unknown',
      },
    );
    const ai = new AiService(db, llmVault, transport, decisionVault);
    const service = new DecisionService(db, new AnalysisService(db), ai);
    assert.equal(ai.status().decision.configured, false);
    assert.equal(service.list()[0].configured, false);
    assert.equal(requests, 0);
    ai.configureOpenRouter({
      apiKey: 'fixture-secret',
      llmModel: 'fixture/chat',
      decisionModel: 'fixture/decision',
    });
    assert.equal(requests, 0);
    assert.equal(ai.status().decisionConfigured, false);
    assert.equal(ai.status().llm.verified, false);
    assert.ok(!JSON.stringify(ai.status()).includes('fixture-secret'));
    assert.ok(!JSON.stringify(db.readConfiguration('decision')).includes('fixture-secret'));
    assert.equal(llmVault.get('https://openrouter.ai/api/v1'), 'fixture-secret');
    assert.equal(decisionVault.get('https://openrouter.ai/api/alpha/decisions'), 'fixture-secret');
    assert.deepEqual((await ai.openRouterModels()).map((model) => model.kind).sort(), [
      'decision',
      'llm',
    ]);
    await assert.rejects(
      service.evaluate(repositoryId, saved.analysisId, parsed.files[0].id),
      /not configured/,
    );
    assert.equal((await ai.testDecision()).decisionConfigured, true);
    assert.equal(service.list()[0].configured, true);
    assert.equal(ai.status().llm.verified, false);
    const result = await service.evaluate(repositoryId, saved.analysisId, parsed.files[0].id);
    assert.equal(result.provider, 'openrouter-decisions');
    assert.equal(result.answers[0].value, 'MODERATE');
    assert.equal(service.results(repositoryId, saved.analysisId).length, 1);
    invalid = true;
    await assert.rejects(
      service.evaluate(repositoryId, saved.analysisId, parsed.files[0].id),
      /not allowed/,
    );
    assert.equal(service.results(repositoryId, saved.analysisId).length, 1);
    invalid = false;
    changed = () =>
      ai.configure(
        {
          endpoint: 'https://openrouter.ai/api/alpha/decisions',
          model: 'fixture/decision',
          apiKey: '',
        },
        'decision',
      );
    await assert.rejects(
      service.evaluate(repositoryId, saved.analysisId, parsed.files[0].id),
      /changed/,
    );
    assert.equal(service.results(repositoryId, saved.analysisId).length, 1);
    assert.equal(ai.status().decisionConfigured, false);
    changed = undefined;
    const restored = new AiService(db, llmVault, transport, decisionVault);
    assert.equal(restored.status().decision.model, 'fixture/decision');
    invalid = true;
    await assert.rejects(ai.testDecision(), /not allowed/);
    assert.equal(ai.status().decisionConfigured, false);
    ai.configure(null, 'decision');
    assert.equal(ai.status().decision.configured, false);
    assert.equal(ai.status().llm.configured, true);
    const before = ai.status();
    assert.throws(() =>
      ai.configureOpenRouter({
        apiKey: 'fixture-secret',
        llmModel: 'fixture/new',
        decisionModel: 'bad model',
      }),
    );
    assert.deepEqual(ai.status(), before);
    assert.throws(() =>
      ai.configure(
        { endpoint: 'https://other.example/decisions', model: 'fixture', apiKey: 'invalid\nkey' },
        'decision',
      ),
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('native decision protocol rejects malformed responses, extra questions and provider errors without exposing secrets', async () => {
  const request = {
    model: 'fixture',
    state: {},
    questions: [
      {
        id: 'q',
        type: 'choice' as const,
        question: 'Fixture?',
        choices: ['A', 'B'],
        probabilities: true,
      },
    ],
  };

  for (const body of [
    'secret invalid json',
    JSON.stringify({
      answers: { q: { type: 'choice', choice: 'A', probabilities: { A: 1, B: 0 } }, extra: {} },
    }),
    JSON.stringify({
      answers: { q: { type: 'choice', choice: 'A', probabilities: { A: 0.2, B: 0.8 } } },
    }),
  ]) {
    await assert.rejects(
      new NativeDecisionProvider(
        'https://fixture.example/decisions',
        'secret',
        async () => new Response(body),
      ).decide(request, signal()),
      (error) => !String(error).includes('secret'),
    );
  }

  await assert.rejects(
    new NativeDecisionProvider(
      'https://fixture.example/decisions',
      'secret',
      async () => new Response('secret', { status: 401 }),
    ).decide(request, signal()),
    /HTTP 401/,
  );
});
