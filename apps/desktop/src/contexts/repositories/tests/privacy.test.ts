import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceBudget, validatePolicy, PrivacyService } from '../application/source-permissions';
import { LocalDatabase } from '@follo/database';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { AnalysisService } from '../application/analysis-service';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('source permissions enforce graph default, selection, snippet/full distinction and UTF-8 budgets', () => {
  let reads = 0;

  const read = () => {
    reads++;

    return 'é\nsecret\nlast';
  };

  assert.throws(
    () =>
      new SourceBudget({ level: 'graph-only', selectedFileIds: [] }, read).get('a', 1, 2, false),
    /forbids/,
  );
  assert.equal(reads, 0);
  const selected = new SourceBudget({ level: 'selected-source', selectedFileIds: ['a'] }, read, 4);
  assert.throws(() => selected.get('b', 1, 1, false), /selected/);
  assert.throws(() => selected.get('a', 1, 1, true), /snippets/);
  assert.equal(selected.get('a', 1, 1, false).content, 'é');
  assert.equal(selected.usage.sourceBytes, 2);
  assert.throws(() => selected.get('a', 2, 2, false), /byte budget/);
  assert.equal(
    new SourceBudget({ level: 'full-file', selectedFileIds: [] }, read).get('a', 1, 1, true)
      .content,
    read(),
  );
  assert.throws(() =>
    validatePolicy({ level: 'selected-source', selectedFileIds: ['b'] }, new Set(['a'])),
  );
  assert.throws(() =>
    validatePolicy({ level: 'full-file', selectedFileIds: ['a'] }, new Set(['a'])),
  );
});
test('repository permissions migrate, survive rescans and restarts, isolate repositories and exclude unavailable selected files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-permissions-'));
  const databasePath = path.join(root, 'db.sqlite');
  let db = new LocalDatabase(databasePath);

  try {
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;');
    writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;');
    const parsed = await parseRepository(root);
    const git = {
      status: 'not-repository' as const,
      root: null,
      branch: null,
      commit: null,
      detached: false,
      workingTree: 'unknown' as const,
    };
    const repositoryId = randomUUID();
    const otherId = randomUUID();
    for (const id of [repositoryId, otherId])
      db.rememberRepository({
        id,
        path: root + (id === otherId ? '/other' : ''),
        name: id,
        lastOpenedAt: new Date().toISOString(),
      });
    const save = (id: string, facts = parsed) =>
      db.saveAnalysis(
        id,
        {
          ...facts,
          root: db.getRepository(id)!.path,
          graph: new EngineeringGraph(facts.files).snapshot(),
        },
        git,
      );
    const saved = save(repositoryId);
    const other = save(otherId);
    const selectedFile = parsed.files.find((file) => file.path === 'a.ts')!;
    const selection = { level: 'selected-source' as const, selectedFileIds: [selectedFile.id] };
    db.saveConfiguration(`privacy:${saved.analysisId}`, selection);
    let privacy = new PrivacyService(db, new AnalysisService(db));
    privacy.preserve(repositoryId);
    assert.deepEqual(
      db.readConfiguration(`privacy:repository:${repositoryId}`),
      selection,
      'Existing snapshot permissions should migrate before a rescan',
    );
    assert.equal(privacy.get(otherId, other.analysisId).level, 'graph-only');
    const newer = save(repositoryId);
    privacy = new PrivacyService(db, new AnalysisService(db));
    assert.deepEqual(privacy.get(repositoryId, newer.analysisId), selection);
    assert.throws(() => privacy.get(repositoryId, saved.analysisId), /Analysis changed/);
    db.close();
    db = new LocalDatabase(databasePath);
    privacy = new PrivacyService(db, new AnalysisService(db));
    assert.deepEqual(
      privacy.get(repositoryId, newer.analysisId),
      selection,
      'Permission choices should survive a database restart',
    );
    unlinkSync(path.join(root, 'a.ts'));
    const removed = await parseRepository(root);
    const missing = save(repositoryId, removed);
    privacy = new PrivacyService(db, new AnalysisService(db));
    assert.deepEqual(privacy.get(repositoryId, missing.analysisId), {
      level: 'selected-source',
      selectedFileIds: [],
    });
    assert.throws(
      () => privacy.budget(repositoryId, missing.analysisId).get(selectedFile.id, 1, 1, false),
      /explicitly selected/,
    );
    assert.throws(
      () => privacy.set(repositoryId, missing.analysisId, selection),
      /Invalid source permission/,
    );
    privacy.set(repositoryId, missing.analysisId, { level: 'full-file', selectedFileIds: [] });
    const latest = save(repositoryId, removed);
    privacy = new PrivacyService(db, new AnalysisService(db));
    assert.equal(privacy.get(repositoryId, latest.analysisId).level, 'full-file');
    assert.equal(privacy.get(otherId, other.analysisId).level, 'graph-only');
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
