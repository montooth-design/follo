import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalDatabase } from '@follo/database';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { AnalysisService } from '../apps/desktop/src/contexts/repositories/application/analysis-service';
import { literalSearchQuery } from '@follo/search';

test('search syntax is literal, bounded and cannot inject FTS operators', () => {
  assert.equal(
    literalSearchQuery('commission OR invoice*'),
    '"commission"* AND "OR"* AND "invoice"*',
  );
  for (const input of ['', null, 'x'.repeat(201), '!"*', Array(21).fill('x').join(' ')])
    assert.throws(() => literalSearchQuery(input));
});
test('FTS indexes paths, camel-case declarations and source, isolates snapshots, paginates and reloads', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'follo-search-'));
  let db: LocalDatabase | undefined;

  try {
    writeFileSync(
      path.join(root, 'orders.ts'),
      'export function calculateCommission() { return "invoicing"; }',
    );
    for (let i = 0; i < 55; i++)
      writeFileSync(path.join(root, `record${i}.ts`), 'export const commonSearchWord = 1;');
    const parsed = await parseRepository(root);
    const result = { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() };
    const id = randomUUID();
    const dbPath = path.join(root, 'local.sqlite');
    db = new LocalDatabase(dbPath);
    db.rememberRepository({
      id,
      path: root,
      name: 'fixture',
      lastOpenedAt: new Date().toISOString(),
    });
    const saved = db.saveAnalysis(id, result, {
      status: 'not-repository',
      root: null,
      commit: null,
      branch: null,
      detached: false,
      workingTree: 'unknown',
    });
    db.close();
    db = new LocalDatabase(dbPath);
    const service = new AnalysisService(db);
    assert.equal(service.searchCode(id, saved.analysisId, { query: 'orders', offset: 0 }).total, 1);
    assert.equal(
      service.searchCode(id, saved.analysisId, { query: 'commission', offset: 0 }).results[0].path,
      'orders.ts',
    );
    assert.equal(service.searchCode(id, saved.analysisId, { query: 'invoic', offset: 0 }).total, 1);
    const first = service.searchCode(id, saved.analysisId, { query: 'common', offset: 0 });
    const second = service.searchCode(id, saved.analysisId, { query: 'common', offset: 50 });
    assert.equal(first.total, 55);
    assert.equal(first.results.length, 50);
    assert.equal(second.results.length, 5);
    assert.equal(
      new Set([...first.results, ...second.results].map((item) => item.fileId)).size,
      55,
    );
    assert.throws(
      () => service.searchCode(id, randomUUID(), { query: 'common', offset: 0 }),
      /Analysis changed/,
    );
    assert.throws(
      () => service.searchCode(id, saved.analysisId, { query: 'common', offset: -1 }),
      /offset/,
    );
    assert.equal('searchDocuments' in service.getState(id).result!, false);
    for (let i = 0; i < 55; i++)
      writeFileSync(path.join(root, `record${i}.ts`), 'export const replacementWord = 1;');
    const updated = await parseRepository(root);
    const next = db.saveAnalysis(
      id,
      { ...updated, graph: new EngineeringGraph(updated.files).snapshot() },
      saved.git,
    );
    assert.equal(db.searchCode(next.analysisId, 'common', 0).total, 0);
    assert.equal(db.searchCode(saved.analysisId, 'common', 0).total, 55);
    const raw = new LocalDatabase(':memory:');
    assert.equal(raw.schemaVersion, 5);
    raw.close();
    service.dispose();
  } finally {
    db?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
