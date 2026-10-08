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
import { AnalysisService } from '../application/analysis-service';
import { DecisionService } from '../../ai/decisions/decision-service';
import { PrivacyService } from '../application/source-permissions';
import { AskService } from '../../ai/investigation/ask-service';
import { CredentialVault } from '../../ai/configuration/credential-vault';
import { LocalInvestigationObserver } from '../../ai/investigation/observability';
import { RepositorySummaryService, validateSummary } from '../application/repository-summary';

const finding = (id: string, inferred = true) => ({
  text: `Possible functionality [file:${id}]`,
  fileIds: [id],
  inferred,
});
test('summary validation rejects unfetched evidence, unsupported citations, malformed output and unlabelled metadata claims', () => {
  const content = {
    purpose: finding('f'),
    features: [finding('f')],
    workflow: finding('f'),
    limitations: ['No source inspected.'],
  };
  const evidence = [{ id: 'f', path: 'app.ts' }];
  assert.equal(validateSummary(JSON.stringify(content), evidence, true).features.length, 1);
  assert.throws(() => validateSummary(JSON.stringify(content), [], true), /evidence/);
  assert.throws(
    () =>
      validateSummary(JSON.stringify({ ...content, purpose: finding('f', false) }), evidence, true),
    /inference/,
  );
  assert.throws(
    () =>
      validateSummary(
        JSON.stringify({ ...content, purpose: { ...finding('f'), text: 'Claims [file:unknown]' } }),
        evidence,
        true,
      ),
    /citations/,
  );
  assert.throws(
    () => validateSummary(JSON.stringify({ ...content, limitations: [] }), evidence, true),
    /limitations/,
  );
  assert.throws(() => validateSummary('```json\n{}\n```', evidence, false), /valid summary/);
});
test('repository summary gathers snapshot evidence without source under Graph Only and persists with scan/model provenance', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-summary-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    writeFileSync(path.join(root, 'app.ts'), 'export const privateSourceToken = 7;');
    const parsed = await parseRepository(root);
    const repositoryId = randomUUID();
    const file = parsed.files[0];
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
    let calls = 0;

    const transport: typeof fetch = async (_url, options) => {
      calls++;
      assert.ok(!String(options?.body).includes('privateSourceToken'));
      if (calls > 1)
        assert.ok(
          !JSON.parse(String(options?.body)).tools.some(
            (tool: { function: { name: string } }) => tool.function.name === 'get_decision',
          ),
        );
      const name = calls === 1 ? 'follo_ping' : calls === 2 ? 'get_repository_summary' : 'get_file';
      const args =
        calls === 1
          ? '{}'
          : calls === 2
            ? '{"offset":0}'
            : JSON.stringify({ fileId: file.id, source: 'none', startLine: 1, endLine: 1 });
      const answer = JSON.stringify({
        purpose: {
          ...finding(file.id),
          text: `Possible Next.js and Node.js functionality [file:${file.id}]`,
        },
        features: [finding(file.id)],
        workflow: finding(file.id),
        limitations: ['Graph Only; source and README not inspected.'],
      });
      const event =
        calls < 4
          ? {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call${calls}`,
                        type: 'function',
                        function: { name, arguments: args },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }
          : { choices: [{ delta: { content: answer }, finish_reason: 'stop' }] };

      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    };

    const vault = new CredentialVault(path.join(root, 'vault'), {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from([...text].reverse().join('')),
      decryptString: (bytes) => [...bytes.toString()].reverse().join(''),
    });
    const ai = new AiService(db, vault, transport);
    const analysis = new AnalysisService(db);
    const privacy = new PrivacyService(db, analysis);
    const investigator = new AskService(
      ai,
      analysis,
      new DecisionService(db, analysis),
      privacy,
      new LocalInvestigationObserver(db),
    );
    const service = new RepositorySummaryService(db, analysis, ai, privacy, investigator);
    assert.equal(service.get(repositoryId), null);
    assert.throws(() => service.start(repositoryId, saved.analysisId), /not configured/);
    assert.equal(calls, 0);
    ai.configure({ endpoint: 'https://fixture.example/v1', model: 'fixture-model', apiKey: '' });
    await ai.test();
    const id = service.start(repositoryId, saved.analysisId);
    assert.throws(() => service.start(repositoryId, saved.analysisId), /already/);
    for (let attempt = 0; attempt < 200 && service.getState(id).status === 'running'; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const state = service.getState(id);
    assert.equal(state.status, 'complete', state.error ?? undefined);
    assert.equal(state.result?.analysisId, saved.analysisId);
    assert.equal(state.result?.model, 'fixture-model');
    assert.equal(state.result?.permission, 'graph-only');
    assert.equal(service.get(repositoryId)?.features.length, 1);
    assert.equal(service.get(repositoryId)?.evidence[0].id, file.id);
    const restored = new RepositorySummaryService(db, analysis, ai, privacy, investigator);
    assert.deepEqual(restored.get(repositoryId), state.result);
    const newer = db.saveAnalysis(
      repositoryId,
      { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() },
      git,
    );
    assert.notEqual(newer.analysisId, restored.get(repositoryId)?.analysisId);
    const reloadedAnalysis = new AnalysisService(db);
    const reloadedPrivacy = new PrivacyService(db, reloadedAnalysis);
    const cancellationService = new RepositorySummaryService(
      db,
      reloadedAnalysis,
      ai,
      reloadedPrivacy,
      new AskService(
        ai,
        reloadedAnalysis,
        new DecisionService(db, reloadedAnalysis),
        reloadedPrivacy,
        new LocalInvestigationObserver(db),
      ),
    );
    const cancelledId = cancellationService.start(repositoryId, newer.analysisId);
    cancellationService.cancel();
    for (
      let attempt = 0;
      attempt < 200 && cancellationService.getState(cancelledId).status === 'running';
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(cancellationService.getState(cancelledId).status, 'cancelled');
    assert.equal(restored.get(repositoryId)?.analysisId, saved.analysisId);
    assert.throws(() => service.getState(randomUUID()), /Unknown/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
