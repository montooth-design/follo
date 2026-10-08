import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
  chmodSync,
  renameSync,
  statSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { LocalDatabase } from '@follo/database';
import {
  inspectRepository,
  inspectGit,
  RepositoryService,
  EXCLUDED_DIRECTORIES,
} from '../application/repository-service';
import { validateRepositoryId } from '@follo/shared';

const execute = promisify(execFile);

const noGit = async () => {
  throw Object.assign(new Error('not found'), { code: 'ENOENT' });
};

const createFolder = () => mkdtempSync(path.join(tmpdir(), 'follo-repository-'));

function cleanupGitFixture(folder: string): void {
  if (path.dirname(folder) !== tmpdir() || !path.basename(folder).startsWith('follo-repository-')) {
    throw new Error('Refusing to remove an unexpected fixture path.');
  }

  // Git marks loose objects read-only; clear those flags only inside this disposable fixture.
  function writable(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) writable(target);
      else if (entry.isFile()) chmodSync(target, 0o666);
    }
  }

  writable(folder);
  rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
}

test('mixed source files, root configuration and exclusions are detected without reading source', async () => {
  const folder = createFolder();

  try {
    mkdirSync(path.join(folder, 'src'));
    for (const file of ['a.ts', 'b.tsx', 'c.js', 'd.jsx'])
      writeFileSync(path.join(folder, 'src', file), 'untrusted arbitrary text');
    for (const file of ['package.json', 'tsconfig.json', 'jsconfig.json'])
      writeFileSync(path.join(folder, file), 'invalid JSON must not be executed or parsed');

    for (const excluded of EXCLUDED_DIRECTORIES) {
      mkdirSync(path.join(folder, excluded));
      writeFileSync(path.join(folder, excluded, 'ignored.ts'), '');
    }

    const before = readFileSync(path.join(folder, 'src/a.ts'));
    const repo = await inspectRepository(folder, undefined, noGit);
    assert.equal(repo.project.sourceFiles, 4);
    assert.equal(repo.project.typescriptFiles, 2);
    assert.equal(repo.project.javascriptFiles, 2);
    assert.equal(repo.project.packageJson, true);
    assert.equal(repo.project.tsconfigJson, true);
    assert.equal(repo.project.jsconfigJson, true);
    assert.equal(repo.project.scanComplete, true);
    assert.equal(repo.git.status, 'unavailable');
    assert.deepEqual(readFileSync(path.join(folder, 'src/a.ts')), before);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('links outside the selected folder are skipped and inspection limits report partial counts', async () => {
  const folder = createFolder();
  const outside = createFolder();

  try {
    writeFileSync(path.join(outside, 'private.ts'), '');
    symlinkSync(
      outside,
      path.join(folder, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    writeFileSync(path.join(folder, 'local.ts'), '');
    const repo = await inspectRepository(folder, undefined, noGit);
    assert.equal(repo.project.sourceFiles, 1);
    assert.equal(repo.project.skippedSymlinks, 1);
    const partial = await inspectRepository(
      folder,
      { maxEntries: 0, maxMilliseconds: 10000 },
      noGit,
    );
    assert.equal(partial.project.scanComplete, false);
    assert.ok(partial.warnings.some((warning) => warning.includes('lower bound')));
  } finally {
    rmSync(folder, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('reopen rejects a saved folder retargeted through a symbolic link', async () => {
  const parent = createFolder();
  const outside = createFolder();
  const db = new LocalDatabase(':memory:');

  try {
    const folder = path.join(parent, 'original');
    mkdirSync(folder);
    const service = new RepositoryService(db);
    const first = (await service.open(async () => folder))!;
    renameSync(folder, path.join(parent, 'moved'));
    symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.reopen(first.id), /different location/);
  } finally {
    db.close();
    rmSync(parent, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('folder-picker cancellation leaves recents untouched and failures release the operation lock', async () => {
  const db = new LocalDatabase(':memory:');

  try {
    const service = new RepositoryService(db);
    assert.equal(await service.open(async () => null), null);
    assert.deepEqual(db.getRecentRepositories(), []);
    await assert.rejects(
      service.open(async () => path.join(tmpdir(), 'follo-nonexistent', 'missing')),
      /missing or inaccessible/,
    );
    assert.equal(await service.open(async () => null), null);
  } finally {
    db.close();
  }
});

test('reopen accepts registered IDs only and refreshes current file counts', async () => {
  const folder = createFolder();
  const db = new LocalDatabase(':memory:');

  try {
    writeFileSync(path.join(folder, 'first.ts'), '');
    const service = new RepositoryService(db);
    const first = (await service.open(async () => folder))!;
    writeFileSync(path.join(folder, 'second.jsx'), '');
    const second = await service.reopen(first.id);
    assert.equal(second.project.sourceFiles, 2);
    assert.equal(second.id, first.id);
    await service.open(async () => folder);
    assert.equal(db.getRecentRepositories().length, 1);
    await assert.rejects(service.reopen(folder), /Invalid repository ID/);
    await assert.rejects(
      service.reopen('12345678-1234-4123-8123-123456789abc'),
      /not in the recent list/,
    );
    rmSync(folder, { recursive: true, force: true });
    await assert.rejects(service.reopen(first.id), /missing or inaccessible/);
    assert.equal(db.getRecentRepositories().length, 1);
    for (const invalid of [null, {}, '../source', '123'])
      assert.throws(() => validateRepositoryId(invalid));
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('repository history migrates from phase 1 without losing appearance and persists across restarts', () => {
  const folder = createFolder();

  try {
    const file = path.join(folder, 'history.sqlite');
    const original = new DatabaseSync(file);
    original.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('appearance', '{"theme":"light"}'); PRAGMA user_version = 1;`);
    original.close();
    const db = new LocalDatabase(file);
    assert.equal(db.schemaVersion, 5);
    assert.equal(db.getSettings().theme, 'light');
    db.rememberRepository({
      id: '12345678-1234-4123-8123-123456789abc',
      name: 'project',
      path: folder,
      lastOpenedAt: '2026-10-01T12:00:00.000Z',
    });
    db.close();
    const reopened = new LocalDatabase(file);

    try {
      assert.equal(reopened.getRecentRepositories()[0].path, folder);
      assert.equal(reopened.getSettings().theme, 'light');
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('concurrent folder-picker requests are rejected until the first operation completes', async () => {
  const db = new LocalDatabase(':memory:');

  try {
    const service = new RepositoryService(db);
    let finish!: (value: null) => void;
    const first = service.open(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
    );
    await assert.rejects(
      service.open(async () => null),
      /already in progress/,
    );
    finish(null);
    assert.equal(await first, null);
  } finally {
    db.close();
  }
});

test('Git metadata distinguishes missing Git, non-repositories, command failures and unknown working tree', async () => {
  const warnings: string[] = [];
  assert.equal((await inspectGit('.', warnings, noGit)).status, 'unavailable');
  assert.equal(
    (
      await inspectGit('.', [], async () => {
        throw { code: 128, stderr: 'fatal: not a git repository' };
      })
    ).status,
    'not-repository',
  );
  assert.equal(
    (
      await inspectGit('.', [], async () => {
        throw { code: 128, stderr: 'dubious ownership' };
      })
    ).status,
    'error',
  );
  const failedStatus = await inspectGit('.', warnings, async (_directory, args) => {
    if (args[0] === 'status') throw new Error('timeout');

    return 'metadata';
  });
  assert.equal(failedStatus.workingTree, 'unknown');
  assert.ok(warnings.some((warning) => warning.includes('status failed')));
});

test('real Git metadata covers unborn, clean, modified and detached repositories without index writes', async () => {
  const folder = createFolder();
  const git = async (...args: string[]) =>
    execute('git', ['-C', folder, ...args], { windowsHide: true });

  try {
    await git('init', '--initial-branch=main');
    const unborn = await inspectRepository(folder);
    assert.equal(unborn.git.status, 'repository');
    assert.equal(unborn.git.branch, 'main');
    assert.equal(unborn.git.commit, null);
    writeFileSync(path.join(folder, 'entry.ts'), 'export const value = 1;');
    await git('add', 'entry.ts');
    await git(
      '-c',
      'user.name=Follo Test',
      '-c',
      'user.email=follo@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
    const monitor = path.join(folder, process.platform === 'win32' ? 'monitor.bat' : 'monitor.sh');
    const marker = path.join(folder, '.git', 'hook-ran');
    writeFileSync(
      monitor,
      process.platform === 'win32'
        ? `@echo off\r\necho ran > "${marker}"\r\n`
        : `#!/bin/sh\nprintf ran > '${marker}'\n`,
      { mode: 0o755 },
    );
    await git('config', 'core.fsmonitor', monitor);
    await git('config', 'core.excludesFile', path.join(folder, '.git', 'fixture-ignore'));
    writeFileSync(path.join(folder, '.git', 'fixture-ignore'), path.basename(monitor));
    const indexBefore = readFileSync(path.join(folder, '.git/index'));
    const indexModifiedAt = statSync(path.join(folder, '.git/index')).mtimeMs;
    const clean = await inspectRepository(folder);
    assert.equal(clean.git.workingTree, 'clean');
    assert.match(clean.git.commit!, /^[0-9a-f]{40,64}$/);
    assert.deepEqual(readFileSync(path.join(folder, '.git/index')), indexBefore);
    assert.equal(statSync(path.join(folder, '.git/index')).mtimeMs, indexModifiedAt);
    assert.equal(existsSync(marker), false, 'Repository fsmonitor hook must not execute');
    writeFileSync(path.join(folder, 'entry.ts'), 'export const value = 2;');
    assert.equal((await inspectRepository(folder)).git.workingTree, 'modified');
    await git('-c', 'core.fsmonitor=false', 'checkout', '--detach');
    const detached = await inspectRepository(folder);
    assert.equal(detached.git.detached, true);
    assert.equal(detached.git.branch, null);
    const subfolder = path.join(folder, 'nested');
    mkdirSync(subfolder);
    const nested = await inspectRepository(subfolder);
    assert.equal(path.normalize(nested.git.root!), path.normalize(clean.git.root!));
    assert.equal(nested.project.sourceFiles, 0);
  } finally {
    cleanupGitFixture(folder);
  }
});
