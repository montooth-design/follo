import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDatabase } from '@follo/database';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { AiService } from '../../ai/configuration/ai-service';
import { AnalysisService } from '../../repositories/application/analysis-service';
import { DecisionService } from '../../ai/decisions/decision-service';
import { PrivacyService } from '../../repositories/application/source-permissions';
import { AskService } from '../../ai/investigation/ask-service';
import { CredentialVault } from '../../ai/configuration/credential-vault';
import { LocalInvestigationObserver } from '../../ai/investigation/observability';
import { ConceptSearchService, validateConceptResults } from '../application/concept-search';

test('concept results accept only fetched files, derive trusted paths and reject duplicates and malformed output', () => {
  const content = { results: [{ fileId: 'a', reason: 'Checks credentials.' }], limitations: [] };
  const evidence = [{ id: 'a', path: 'login.ts' }];
  assert.equal(
    validateConceptResults(JSON.stringify(content), evidence).results[0].path,
    'login.ts',
  );
  assert.throws(() => validateConceptResults(JSON.stringify(content), []), /unsupported/);
  assert.throws(
    () =>
      validateConceptResults(
        JSON.stringify({ ...content, results: [...content.results, ...content.results] }),
        evidence,
      ),
    /unsupported/,
  );
  assert.throws(
    () =>
      validateConceptResults(
        JSON.stringify({ ...content, results: [{ ...content.results[0], path: '../secret' }] }),
        evidence,
      ),
    /unsupported/,
  );
  assert.throws(() => validateConceptResults('not JSON', evidence), /invalid/);
  assert.equal(
    validateConceptResults(
      JSON.stringify({ results: [], limitations: ['No supported matches.'] }),
      [],
    ).results.length,
    0,
  );
});

test('concept search expands intent through tools without exposing Graph Only source, requires verified AI and supports cancellation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-concept-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    writeFileSync(path.join(root, 'login.ts'), 'export const privateSourceToken = "credential";');
    const parsed = await parseRepository(root);
    const repositoryId = randomUUID();
    const file = parsed.files[0];
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
    let calls = 0;

    const transport: typeof fetch = async (_url, options) => {
      calls++;
      const body = String(options?.body);
      assert.ok(!body.includes('privateSourceToken'));
      if (calls > 1)
        assert.ok(
          !JSON.parse(body).tools.some(
            (tool: { function: { name: string } }) => tool.function.name === 'get_decision',
          ),
        );
      if (calls === 2) assert.ok(body.includes('get_repository_summary'));
      if (calls === 3) assert.ok(body.includes('login.ts'));
      const event =
        calls < 3
          ? {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call${calls}`,
                        type: 'function',
                        function: {
                          name: calls === 1 ? 'follo_ping' : 'search_code',
                          arguments: calls === 1 ? '{}' : '{"query":"login","offset":0}',
                        },
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
                  delta: {
                    content: JSON.stringify({
                      results: [
                        {
                          fileId: file.id,
                          reason: 'Login filename suggests the user sign-in entry point.',
                        },
                      ],
                      limitations: ['Source was not inspected.'],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
            };

      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    };

    const vault = new CredentialVault(path.join(root, 'vault'), {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text),
      decryptString: (bytes) => bytes.toString(),
    });
    const ai = new AiService(db, vault, transport);
    const analysis = new AnalysisService(db);
    const privacy = new PrivacyService(db, analysis);
    const service = new ConceptSearchService(
      analysis,
      privacy,
      new AskService(
        ai,
        analysis,
        new DecisionService(db, analysis),
        privacy,
        new LocalInvestigationObserver(db),
      ),
    );
    assert.throws(
      () => service.start(repositoryId, saved.analysisId, 'where users sign in'),
      /not configured/,
    );
    assert.throws(() => service.start(repositoryId, saved.analysisId, ' '.repeat(1001)), /concept/);
    ai.configure({ endpoint: 'https://fixture.example/v1', model: 'fixture-model', apiKey: '' });
    await ai.test();
    const id = service.start(repositoryId, saved.analysisId, 'where users sign in');
    assert.throws(() => service.start(repositoryId, saved.analysisId, 'authentication'), /already/);
    for (let i = 0; i < 200 && service.get(id).status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.get(id).status, 'complete', service.get(id).error ?? undefined);
    assert.equal(service.get(id).result?.results[0].fileId, file.id);
    assert.match(service.get(id).result!.limitations.at(-1)!, /Metadata-based/);
    const cancelled = service.start(repositoryId, saved.analysisId, 'access controls');
    service.cancel('unrelated');
    service.cancel(cancelled);
    for (let i = 0; i < 200 && service.get(cancelled).status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.get(cancelled).status, 'cancelled');
    assert.throws(() => service.get('unknown'), /Unknown/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
