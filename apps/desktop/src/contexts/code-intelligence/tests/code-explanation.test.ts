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
import { DecisionService } from '../../ai/decisions/decision-service';
import { AiService } from '../../ai/configuration/ai-service';
import { CredentialVault } from '../../ai/configuration/credential-vault';
import { AskService } from '../../ai/investigation/ask-service';
import { LocalInvestigationObserver } from '../../ai/investigation/observability';
import { CodeExplanationService } from '../application/code-explanation';

test('code viewer reads only registered saved source and explanations enforce permissions and the selected range before provider access', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-code-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    const text = '// OUTSIDE_TOP_SECRET\nexport const selectedValue = 7;\n// OUTSIDE_BOTTOM_SECRET';
    writeFileSync(path.join(root, 'a.ts'), text);
    writeFileSync(path.join(root, 'b.jsx'), 'export const OTHER_FILE_SECRET = <div/>;');
    const parsed = await parseRepository(root);
    const repositoryId = randomUUID();
    db.rememberRepository({
      id: repositoryId,
      path: root,
      name: 'Fixture',
      lastOpenedAt: new Date().toISOString(),
    });
    const git = {
      status: 'not-repository' as const,
      root: null,
      branch: null,
      commit: null,
      detached: false,
      workingTree: 'unknown' as const,
    };
    const saved = db.saveAnalysis(
      repositoryId,
      { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() },
      git,
    );
    const file = parsed.files.find((file) => file.path === 'a.ts')!;
    const other = parsed.files.find((file) => file.path === 'b.jsx')!;
    const analysis = new AnalysisService(db);
    const privacy = new PrivacyService(db, analysis);
    assert.equal(analysis.getSource(repositoryId, saved.analysisId, file.id).content, text);
    assert.equal(analysis.getSource(repositoryId, saved.analysisId, other.id).language, 'jsx');
    writeFileSync(path.join(root, 'a.ts'), 'export const liveChange = 99;');
    assert.equal(
      analysis.getSource(repositoryId, saved.analysisId, file.id).content,
      text,
      'Viewer must show the saved scan',
    );
    assert.throws(() => analysis.getSource(randomUUID(), saved.analysisId, file.id), /registered/);
    assert.throws(
      () => analysis.getSource(repositoryId, randomUUID(), file.id),
      /Analysis changed/,
    );
    assert.throws(
      () => analysis.getSource(repositoryId, saved.analysisId, 'C:/arbitrary.ts'),
      /Invalid/,
    );
    let calls = 0;

    const transport: typeof fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      for (const secret of [
        'OUTSIDE_TOP_SECRET',
        'OUTSIDE_BOTTOM_SECRET',
        'OTHER_FILE_SECRET',
        'liveChange',
      ])
        assert.ok(!String(options?.body).includes(secret));
      const toolCall = (name: string, args: unknown) => ({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `code${calls}`,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
      let event;

      if (calls === 1) event = toolCall('follo_ping', {});
      else {
        assert.ok(String(options?.body).includes('selectedValue'));
        assert.deepEqual(
          body.tools.map((tool: { function: { name: string } }) => tool.function.name),
          ['get_file', 'get_dependencies', 'get_dependents'],
        );

        if (calls === 2) {
          assert.equal(body.messages.at(-1).role, 'tool');
          const seed = JSON.parse(body.messages.at(-1).content);
          assert.equal(seed.data.source.content, 'export const selectedValue = 7;');
          event = toolCall('get_file', {
            fileId: file.id,
            source: 'snippet',
            startLine: 1,
            endLine: 3,
          });
        } else if (calls === 3) {
          assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
          event = toolCall('get_file', {
            fileId: other.id,
            source: 'snippet',
            startLine: 1,
            endLine: 1,
          });
        } else if (calls === 4) {
          assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
          event = toolCall('get_file', {
            fileId: file.id,
            source: 'full',
            startLine: 2,
            endLine: 2,
          });
        } else {
          assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
          event = {
            choices: [
              {
                delta: { content: `Exports a constant. [file:${file.id}] [lines:2-2]` },
                finish_reason: 'stop',
              },
            ],
          };
        }
      }

      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    };

    const vault = new CredentialVault(path.join(root, 'vault'), {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    });
    const ai = new AiService(db, vault, transport);
    const investigator = new AskService(
      ai,
      analysis,
      new DecisionService(db, analysis),
      privacy,
      new LocalInvestigationObserver(db),
    );
    const service = new CodeExplanationService(analysis, privacy, investigator);
    const request = { fileId: file.id, startLine: 2, endLine: 2, question: '' };
    assert.throws(() => service.start(repositoryId, saved.analysisId, request), /Graph Only/);
    assert.equal(calls, 0);
    privacy.set(repositoryId, saved.analysisId, {
      level: 'selected-source',
      selectedFileIds: [other.id],
    });
    assert.throws(
      () => service.start(repositoryId, saved.analysisId, request),
      /explicitly selected/,
    );
    assert.equal(calls, 0);
    privacy.set(repositoryId, saved.analysisId, {
      level: 'selected-source',
      selectedFileIds: [file.id],
    });
    assert.throws(
      () => service.start(repositoryId, saved.analysisId, { ...request, startLine: 0 }),
      /1–200/,
    );
    assert.throws(
      () => service.start(repositoryId, saved.analysisId, { ...request, endLine: 500 }),
      /1–200/,
    );
    assert.throws(
      () => service.start(repositoryId, saved.analysisId, { ...request, endLine: 4 }),
      /beyond/,
    );
    assert.throws(
      () =>
        service.start(repositoryId, saved.analysisId, { ...request, question: 'x'.repeat(1001) }),
      /1000/,
    );
    assert.throws(
      () =>
        service.start(repositoryId, saved.analysisId, { ...request, content: 'injected source' }),
      /Invalid/,
    );
    assert.equal(calls, 0);
    ai.configure({ endpoint: 'https://fixture.example/v1', model: 'fixture-model', apiKey: '' });
    await ai.test();
    const id = service.start(repositoryId, saved.analysisId, request);
    service.cancel(randomUUID());
    for (let attempt = 0; attempt < 200 && service.get(id).status === 'running'; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const state = service.get(id);
    assert.equal(state.status, 'complete', state.error ?? undefined);
    assert.equal(state.stats?.toolFailures, 3);
    assert.equal(state.stats?.toolCalls, 4);
    assert.deepEqual(state.evidence.files, [{ id: file.id, path: 'a.ts' }]);
    assert.ok(state.answer.includes('[lines:2-2]'));
    assert.equal(calls, 5);
    const traces = JSON.stringify(db.readConfiguration('investigation-traces'));
    assert.ok(!traces.includes('selectedValue'));
    assert.ok(!traces.includes('Exports a constant'));
    const cancelled = service.start(repositoryId, saved.analysisId, request);
    assert.throws(() => service.start(repositoryId, saved.analysisId, request), /running/);
    service.cancel(cancelled);
    for (let attempt = 0; attempt < 200 && service.get(cancelled).status === 'running'; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.get(cancelled).status, 'cancelled');
    assert.equal(calls, 5, 'Immediate cancellation must stop the pending provider request');
    const newer = db.saveAnalysis(
      repositoryId,
      { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() },
      git,
    );
    assert.throws(
      () => new AnalysisService(db).getSource(repositoryId, saved.analysisId, file.id),
      /Analysis changed/,
    );
    assert.notEqual(newer.analysisId, saved.analysisId);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
