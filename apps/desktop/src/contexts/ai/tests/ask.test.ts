import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDatabase } from '@follo/database';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { AnalysisService } from '../../repositories/application/analysis-service';
import { PrivacyService } from '../../repositories/application/source-permissions';
import { DecisionService } from '../decisions/decision-service';
import { AiService } from '../configuration/ai-service';
import { CredentialVault } from '../configuration/credential-vault';
import { AskService } from '../investigation/ask-service';
import { LocalInvestigationObserver } from '../investigation/observability';

test('mock compatibility test and Ask run integrate native tools, evaluation and metadata-only observation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-ask-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    writeFileSync(path.join(root, 'a.ts'), 'export const privateSourceValue = 7;');
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
    const file = parsed.files[0];
    let requests = 0;

    const transport: typeof fetch = async (_url, options) => {
      requests++;
      const body = JSON.parse(String(options!.body));
      assert.ok(!String(options!.body).includes('privateSourceValue'));
      assert.ok(!String(options!.body).includes('fixture-key'));
      const name = requests === 1 ? 'follo_ping' : 'get_repository_summary';
      const event =
        requests < 3
          ? {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call${requests}`,
                        type: 'function',
                        function: { name, arguments: requests === 1 ? '{}' : '{"offset":0}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }
          : {
              choices: [
                {
                  delta: { content: `privateAnswerToken: a.ts [file:${file.id}]` },
                  finish_reason: 'stop',
                },
              ],
            };

      if (requests === 3) {
        assert.equal(body.messages.at(-1).role, 'tool');
        assert.ok(body.messages.at(-1).content.includes(file.id));
      }

      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    };

    // Reversible test-only protection. Production uses Electron's OS vault.
    const vault = new CredentialVault(path.join(root, 'fixture-vault'), {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from([...text].reverse().join('')),
      decryptString: (value) => [...value.toString()].reverse().join(''),
    });
    const ai = new AiService(db, vault, transport);
    const analysis = new AnalysisService(db);
    const service = new AskService(
      ai,
      analysis,
      new DecisionService(db, analysis),
      new PrivacyService(db, analysis),
      new LocalInvestigationObserver(db),
    );
    assert.throws(() => service.start(repositoryId, saved.analysisId, 'q'), /not configured/);
    assert.equal(requests, 0);
    ai.configure({
      endpoint: 'https://fixture.example/v1',
      model: 'fixture-model',
      apiKey: 'fixture-key',
    });
    assert.equal(ai.status().llm.verified, false);
    assert.equal((await ai.test()).llm.verified, true);
    const id = service.start(
      repositoryId,
      saved.analysisId,
      'privateQuestionToken: explain this repository',
    );
    assert.throws(() => service.start(repositoryId, saved.analysisId, 'q'), /running/);
    for (let i = 0; i < 200 && service.get(id).status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const state = service.get(id);
    assert.equal(state.status, 'complete');
    assert.equal(state.stats!.toolCalls, 1);
    assert.equal(state.evaluation!.unsupported.length, 0);
    assert.equal(state.evidence.files[0].id, file.id);
    assert.equal(requests, 3);
    const trace = JSON.stringify(db.readConfiguration('investigation-traces'));
    for (const secret of [
      'privateQuestionToken',
      'privateAnswerToken',
      'privateSourceValue',
      'fixture-key',
    ])
      assert.ok(!trace.includes(secret));
    assert.ok(trace.includes('questionHash'));
    assert.ok(trace.includes('evaluation'));
    assert.throws(() => service.get(randomUUID()), /Unknown/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
