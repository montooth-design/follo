import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalDatabase } from '@follo/database';
import { validateSettings } from '@follo/shared';
import { isTrustedFrame } from '../apps/desktop/src/desktop/ipc-security';

test('appearance persists across database restarts and migration is idempotent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'follo-test-'));

  try {
    const file = path.join(dir, 'test.sqlite');
    const first = new LocalDatabase(file);
    assert.deepEqual(first.getSettings(), { theme: 'dark' });
    first.updateSettings({ theme: 'light' });
    first.close();
    const second = new LocalDatabase(file);

    try {
      assert.deepEqual(second.getSettings(), { theme: 'light' });
    } finally {
      second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('invalid IPC settings cannot store secrets or arbitrary configuration', () => {
  const db = new LocalDatabase(':memory:');

  try {
    for (const input of [
      null,
      [],
      {},
      { theme: 'system' },
      { theme: 'dark', apiKey: 'secret' },
      'dark',
    ]) {
      assert.throws(() => validateSettings(input));
      assert.throws(() => db.updateSettings(input));
    }

    assert.deepEqual(db.getSettings(), { theme: 'dark' });
  } finally {
    db.close();
  }
});
test('IPC accepts only the owned window main frame at the exact trusted URL', () => {
  const url = 'file:///app/renderer/index.html';
  assert.equal(isTrustedFrame(1, 1, url, url, true), true);
  assert.equal(isTrustedFrame(2, 1, url, url, true), false);
  assert.equal(isTrustedFrame(1, 1, url, url, false), false);
  assert.equal(isTrustedFrame(1, 1, undefined, url, true), false);

  for (const untrusted of ['https://evil.example', `${url}.evil`, `${url}?redirect=1`]) {
    assert.equal(isTrustedFrame(1, 1, untrusted, url, true), false);
  }
});
test('newer database schema is rejected without being overwritten', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'follo-test-'));

  try {
    const file = path.join(dir, 'future.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version = 99');
    db.close();
    assert.throws(() => new LocalDatabase(file), /Unsupported database/);
    const verify = new DatabaseSync(file);

    try {
      assert.equal(verify.prepare('PRAGMA user_version').get()?.user_version, 99);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('runtime SQLite provides FTS5 for the later search phase', () => {
  const db = new DatabaseSync(':memory:');

  try {
    db.exec(
      "CREATE VIRTUAL TABLE search_check USING fts5(content); INSERT INTO search_check VALUES ('engineering graph');",
    );
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM search_check WHERE search_check MATCH ?').get('graph')
        ?.n,
      1,
    );
  } finally {
    db.close();
  }
});
