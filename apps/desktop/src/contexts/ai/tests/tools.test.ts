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
import { DecisionService } from '../decisions/decision-service';
import { PrivacyService } from '../../repositories/application/source-permissions';
import { EngineeringTools } from '../investigation/tools';

test('controlled tools isolate snapshots, withhold snippets, reject arbitrary operations and preserve evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-tools-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    writeFileSync(path.join(root, 'a.ts'), "import './b'; export const proprietarySecret = 1;");
    writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;');
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
    const analysis = new AnalysisService(db);
    const privacy = new PrivacyService(db, analysis);
    const decisions = new DecisionService(db, analysis);
    const tools = new EngineeringTools(
      repositoryId,
      saved.analysisId,
      analysis,
      decisions,
      privacy.budget(repositoryId, saved.analysisId),
    );
    assert.equal(privacy.get(repositoryId, saved.analysisId).level, 'graph-only');
    const a = parsed.files.find((file) => file.path === 'a.ts')!;
    const search = await tools.execute(
      'search_code',
      JSON.stringify({ query: 'proprietarySecret', offset: 0 }),
    );
    assert.ok(!JSON.stringify(search).includes('export const'));
    assert.ok(!JSON.stringify(search).includes('snippet'));
    const metadata = await tools.execute(
      'get_file',
      JSON.stringify({ fileId: a.id, source: 'none', startLine: 1, endLine: 1 }),
    );
    assert.ok(!JSON.stringify(metadata).includes('proprietarySecret'));
    await assert.rejects(
      tools.execute(
        'get_file',
        JSON.stringify({ fileId: a.id, source: 'full', startLine: 1, endLine: 1 }),
      ),
      /forbids/,
    );
    await assert.rejects(tools.execute('configure_provider', '{}'), /registered/);
    await assert.rejects(
      tools.execute(
        'get_dependencies',
        JSON.stringify({ fileId: a.id, offset: 0, path: '../secret' }),
      ),
      /schema/,
    );
    await assert.rejects(
      tools.execute('get_blast_radius', JSON.stringify({ fileId: a.id, offset: 0, maxDepth: 11 })),
      /integer/,
    );
    await assert.rejects(
      tools.execute('get_decision', JSON.stringify({ fileId: a.id, definitionId: 'change-risk' })),
      /not configured/,
    );
    assert.equal(tools.evidence.decisionIds.length, 0);
    assert.equal(tools.evidence.files[0].id, a.id);
    privacy.set(repositoryId, saved.analysisId, {
      level: 'selected-source',
      selectedFileIds: [a.id],
    });
    const selected = new EngineeringTools(
      repositoryId,
      saved.analysisId,
      analysis,
      decisions,
      privacy.budget(repositoryId, saved.analysisId),
    );
    assert.ok(
      JSON.stringify(
        await selected.execute(
          'get_file',
          JSON.stringify({ fileId: a.id, source: 'snippet', startLine: 1, endLine: 1 }),
        ),
      ).includes('proprietarySecret'),
    );
    const stale = new EngineeringTools(
      repositoryId,
      randomUUID(),
      analysis,
      decisions,
      privacy.budget(repositoryId, saved.analysisId),
    );
    await assert.rejects(
      stale.execute('get_repository_summary', '{"offset":0}'),
      /Analysis changed/,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
