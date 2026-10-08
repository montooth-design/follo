import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { LocalDatabase } from '@follo/database';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { AnalysisService } from '../apps/desktop/src/contexts/repositories/application/analysis-service';

const git = {
  status: 'not-repository' as const,
  root: null,
  branch: null,
  commit: null,
  detached: false,
  workingTree: 'unknown' as const,
};

test('analysis facts, coverage, graph evidence and metrics survive restart and reload through registered IPC service', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'follo-persist-'));
  const dbPath = path.join(root, 'analysis.sqlite');

  try {
    writeFileSync(path.join(root, 'a.ts'), "import './b'; import './missing';");
    writeFileSync(path.join(root, 'b.ts'), "import './a';");
    const parsed = await parseRepository(root);
    const result = { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() };
    let db = new LocalDatabase(dbPath);
    const id = randomUUID();
    db.rememberRepository({
      id,
      path: root,
      name: 'fixture',
      lastOpenedAt: new Date().toISOString(),
    });
    const saved = db.saveAnalysis(id, result, git);
    db.close();
    db = new LocalDatabase(dbPath);

    try {
      const reloaded = db.getLatestAnalysis(id)!;
      assert.equal(reloaded.analysisId, saved.analysisId);
      assert.deepEqual(reloaded.coverage, result.coverage);
      assert.deepEqual(reloaded.techStack, result.techStack);
      assert.deepEqual(reloaded.files, result.files);
      assert.equal(reloaded.graph.cycles.length, 1);
      assert.equal(reloaded.graph.edges.length, 2);
      assert.equal(reloaded.graph.metrics.length, 2);
      const service = new AnalysisService(db);
      assert.equal(service.getState(id).status, 'complete');
      assert.equal(service.getState(id).result?.provenance?.analysisId, saved.analysisId);
      assert.deepEqual(service.getFile(id, parsed.files[0].id), parsed.files[0]);
      assert.equal(service.getGraph(id, saved.analysisId).edges.length, 2);
      assert.throws(() => service.getGraph(id, randomUUID()), /Analysis changed/);
      const inspection = service.inspectFile(id, saved.analysisId, {
        fileId: parsed.files[0].id,
        maxDepth: 5,
        targetFileId: parsed.files[1].id,
      });
      assert.equal(inspection.metrics.fanIn, 1);
      assert.equal(inspection.blastRadius.length, 1);
      assert.equal(inspection.metrics.maxDependencyDepth, null);
      assert.equal(inspection.path?.length, 2);
      assert.throws(
        () =>
          service.inspectFile(id, saved.analysisId, {
            fileId: parsed.files[0].id,
            maxDepth: 51,
            targetFileId: null,
          }),
        /Invalid/,
      );
      assert.throws(
        () =>
          service.inspectFile(id, saved.analysisId, {
            fileId: '0'.repeat(64),
            maxDepth: 5,
            targetFileId: null,
          }),
        /not present/,
      );
      assert.throws(() => service.getState(randomUUID()), /registered/);
      service.dispose();
      const bad = structuredClone(result);
      bad.graph.edges.push({
        sourceFileId: 'missing',
        targetFileId: parsed.files[0].id,
        evidence: [],
      });
      assert.throws(() => db.saveAnalysis(id, bad, git), /FOREIGN KEY/);
      assert.equal(db.getLatestAnalysis(id)!.analysisId, saved.analysisId);
      const definition = {
        id: 'fixture-check',
        version: 1,
        name: 'Fixture',
        questions: [{ id: 'q', type: 'boolean' as const, question: 'Fixture only?' }],
      };
      db.saveDefinition(definition);
      assert.throws(
        () => db!.saveDefinition({ ...definition, name: 'Changed without a version' }),
        /version increase/,
      );
      const decision = {
        decisionId: randomUUID(),
        definitionId: definition.id,
        definitionVersion: 1,
        analysisId: saved.analysisId,
        subjectId: parsed.files[0].id,
        inputStateHash: 'fixture-hash',
        state: { verified: true },
        provider: 'fixture',
        model: 'fixture',
        answers: [{ questionId: 'q', value: true }],
        latencyMs: 1,
        createdAt: new Date().toISOString(),
      };
      db.saveResult(decision);
      assert.equal(db.getDecisionResults(saved.analysisId)[0].inputStateHash, 'fixture-hash');
      assert.throws(
        () => db!.saveResult({ ...decision, decisionId: randomUUID(), subjectId: 'missing' }),
        /FOREIGN KEY/,
      );
      assert.throws(() => db.saveAnalysis(randomUUID(), result, git), /registered/);
    } finally {
      db.close();
    }

    const verify = new DatabaseSync(dbPath);

    try {
      assert.equal(verify.prepare('SELECT count(*) AS n FROM analyses').get()!.n, 1);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('schema 2 migration preserves repository history and appearance', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'follo-migrate-'));
  const dbPath = path.join(root, 'old.sqlite');

  try {
    const old = new DatabaseSync(dbPath);
    old.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES('appearance', '{"theme":"light"}');
      CREATE TABLE repositories(id TEXT PRIMARY KEY, path_key TEXT UNIQUE, path TEXT, name TEXT, last_opened_at TEXT);
      PRAGMA user_version=2;`);
    old.close();
    const db = new LocalDatabase(dbPath);

    try {
      assert.equal(db.schemaVersion, 5);
      assert.equal(db.getSettings().theme, 'light');
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
