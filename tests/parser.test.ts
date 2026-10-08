import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { parseRepository, DEFAULT_LIMITS } from '@follo/parser';
import {
  DEFAULT_EXCLUSIONS,
  validateParserOptions,
  type ParserAnalysis,
  type ParserProgress,
} from '@follo/shared';
import { LocalDatabase } from '@follo/database';
import { AnalysisService } from '../apps/desktop/src/contexts/repositories/application/analysis-service';

function fixture(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-parser-'));

  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  return root;
}

function invariants(result: ParserAnalysis): void {
  const coverage = result.coverage;
  assert.equal(coverage.filesDiscovered, coverage.filesParsed + coverage.filesSkipped);
  assert.equal(
    coverage.importsDiscovered,
    coverage.internalResolved + coverage.external + coverage.skipped + coverage.unresolved,
  );
  assert.equal(result.files.flatMap((file) => file.imports).length, coverage.importsDiscovered);

  for (const file of result.files)
    for (const item of file.imports) {
      if (item.resolution.status === 'resolved') {
        const targetPath = item.resolution.targetPath;
        assert.ok(result.files.some((target) => target.path === targetPath));
      }
    }
}

test('parser establishes deterministic hashes, LOC and every import kind in mixed JS/TS', async () => {
  const entry = `import { value } from './nested/b';\nexport * from './nested/b';\nconst dynamic = import('./view');\nconst computed = import(target);\nconst cjs = require('./view');\nimport type { Shape } from './types';\ntype Later = import('./types').Shape;\nimport 'react/jsx-runtime';\nimport '@vendor/core/deep';\nimport 'node:fs';\n`;
  const root = fixture({
    'entry.ts': entry,
    'nested/b.ts': "export const value=1; import '../entry';",
    'view.jsx': 'export const view = <div/>;',
    'types.ts': 'export interface Shape {}',
  });

  try {
    const progress: ParserProgress[] = [];
    const result = await parseRepository(root, undefined, (update) => progress.push(update));
    invariants(result);
    assert.equal(result.coverage.filesDiscovered, 4);
    const file = result.files.find((file) => file.path === 'entry.ts')!;
    assert.equal(file.hash, createHash('sha256').update(entry).digest('hex'));
    assert.equal(file.linesOfCode, 10);
    assert.equal(file.imports.length, 10);
    assert.equal(
      file.imports.find((item) => item.kind === 'require')?.resolution.status,
      'resolved',
    );
    assert.equal(
      file.imports.find((item) => item.kind === 'dynamic' && item.specifier === null)?.resolution
        .status,
      'skipped',
    );
    assert.equal(
      file.imports.find((item) => item.kind === 'reexport')?.resolution.status,
      'resolved',
    );
    assert.equal(
      file.imports.find((item) => item.kind === 'import-type')?.resolution.status,
      'resolved',
    );
    assert.deepEqual(
      file.imports.find((item) => item.specifier === '@vendor/core/deep')?.resolution,
      { status: 'external', packageName: '@vendor/core' },
    );
    assert.deepEqual(
      progress
        .map((item) => item.stage)
        .filter((stage, index, stages) => !index || stage !== stages[index - 1]),
      ['discover', 'parse', 'resolve', 'complete'],
    );
    const second = await parseRepository(root);
    assert.deepEqual(result.files, second.files);
    assert.equal(readFileSync(path.join(root, 'entry.ts'), 'utf8'), entry);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nearest configs, inherited path aliases, reexports and .js-to-.ts substitution use TypeScript resolution', async () => {
  const root = fixture({
    'base.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['src/*'] } },
    }),
    'tsconfig.json':
      '{ // JSONC config\n"extends":"./base.json","compilerOptions":{"moduleResolution":"bundler","module":"esnext"}}',
    'entry.ts': "import '@lib/util'; export {util} from './src/util.js'; import '@lib/missing';",
    'src/util.ts': 'export const util=1;',
    'nested/tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@local/*': ['./*'] } },
    }),
    'nested/local.ts': "import '@local/value';",
    'nested/value.js': 'export const value=1;',
  });

  try {
    const result = await parseRepository(root);
    invariants(result);
    const imports = result.files.find((file) => file.path === 'entry.ts')!.imports;
    assert.deepEqual(imports[0].resolution, { status: 'resolved', targetPath: 'src/util.ts' });
    assert.deepEqual(imports[1].resolution, { status: 'resolved', targetPath: 'src/util.ts' });
    assert.equal(imports[2].resolution.status, 'unresolved');
    assert.deepEqual(
      result.files.find((file) => file.path === 'nested/local.ts')!.imports[0].resolution,
      { status: 'resolved', targetPath: 'nested/value.js' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NodeNext package imports honor package type and import/require conditions', async () => {
  const root = fixture({
    'package.json': JSON.stringify({
      type: 'module',
      imports: { '#local': { import: './esm.ts', require: './cjs.ts' } },
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' },
    }),
    'entry.ts':
      "import '#local'; const local = require('#local'); import equal = require('#local');",
    'esm.ts': 'export const esm=1;',
    'cjs.ts': 'export const cjs=1;',
  });

  try {
    const result = await parseRepository(root);
    invariants(result);
    const imports = result.files.find((file) => file.path === 'entry.ts')!.imports;
    assert.deepEqual(imports[0].resolution, { status: 'resolved', targetPath: 'esm.ts' });
    assert.deepEqual(imports[1].resolution, { status: 'resolved', targetPath: 'cjs.ts' });
    assert.deepEqual(imports[2].resolution, { status: 'resolved', targetPath: 'cjs.ts' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unresolved, external, excluded, unsupported and outside imports stay visible', async () => {
  const root = fixture({
    'entry.js':
      "import './missing'; import './dist/generated'; import './style.css'; import '../outside'; import 'lodash';",
    'dist/generated.ts': 'export const generated=1;',
    'style.css': 'body{}',
  });

  try {
    const result = await parseRepository(root);
    invariants(result);
    assert.equal(result.coverage.filesDiscovered, 1);
    assert.deepEqual(
      result.files[0].imports.map((item) => item.resolution.status),
      ['unresolved', 'skipped', 'skipped', 'skipped', 'external'],
    );
    const configured = await parseRepository(root, { exclusions: ['.git'] });
    assert.equal(configured.coverage.filesDiscovered, 2);
    assert.equal(
      configured.files.find((file) => file.path === 'entry.js')!.imports[1].resolution.status,
      'resolved',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('symbolic links and external config extensions do not escape the selected scope', async () => {
  const outside = fixture({
    'secret.ts': 'export const secret=1;',
    'base.json': '{"compilerOptions":{"baseUrl":"."}}',
  });
  const root = fixture({
    'entry.ts': "import './linked/secret';",
    'tsconfig.json': '{"extends":"../external-config.json"}',
  });

  try {
    symlinkSync(
      outside,
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const result = await parseRepository(root);
    invariants(result);
    assert.equal(result.files.length, 1);
    assert.equal(result.coverage.unresolved, 1);
    assert.ok(result.warnings.some((warning) => warning.includes('symbolic links')));
    assert.ok(result.warnings.some((warning) => warning.includes('external-config')));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('malformed source, invalid UTF-8, oversized files and shadowed require report uncertainty', async () => {
  const root = fixture({
    'broken.ts': "import './valid'; const broken = ;",
    'valid.ts': 'export const value=1;',
    'encoding.ts': Buffer.from([0xff, 0xfe, 0xff]),
    'large.ts': 'x'.repeat(1000),
    'shadow.js': "function require(name) { return name; } require('./valid');",
  });

  try {
    const result = await parseRepository(root, undefined, undefined, {
      ...DEFAULT_LIMITS,
      maxFileBytes: 100,
    });
    invariants(result);
    assert.equal(result.coverage.filesSkipped, 2);
    assert.equal(result.coverage.filesWithSyntaxErrors, 1);
    assert.equal(
      result.files.find((file) => file.path === 'broken.ts')!.imports[0].resolution.status,
      'skipped',
    );
    assert.equal(
      result.files.find((file) => file.path === 'shadow.js')!.imports[0].resolution.status,
      'skipped',
    );
    assert.ok(
      result.files
        .find((file) => file.path === 'large.ts')!
        .diagnostics[0].message.includes('per-file limit'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty folders and bounded discovery preserve coverage invariants and input validation', async () => {
  const root = fixture({});

  try {
    assert.equal((await parseRepository(root)).coverage.filesDiscovered, 0);
    writeFileSync(path.join(root, 'one.ts'), '');
    writeFileSync(path.join(root, 'two.ts'), '');
    const result = await parseRepository(root, undefined, undefined, {
      ...DEFAULT_LIMITS,
      maxFiles: 1,
    });
    invariants(result);
    assert.equal(result.coverage.filesDiscovered, 1);
    assert.equal(result.coverage.discoveryComplete, false);
    for (const input of [
      null,
      {},
      { exclusions: ['../outside'] },
      { exclusions: ['*'] },
      { exclusions: [], secret: 'no' },
    ])
      assert.throws(() => validateParserOptions(input));
    assert.ok(validateParserOptions({ exclusions: [] }).exclusions.includes('.git'));
    assert.deepEqual(
      validateParserOptions({ exclusions: DEFAULT_EXCLUSIONS }).exclusions,
      DEFAULT_EXCLUSIONS,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker analysis runs only registered IDs, exposes progress/facts and rejects arbitrary paths', async () => {
  const root = fixture({
    'entry.ts': "export * from './value';",
    'value.ts': 'export const value=1;',
  });
  const db = new LocalDatabase(':memory:');
  const service = new AnalysisService(db, path.resolve('apps/desktop/dist/parser-worker.cjs'));

  try {
    const id = randomUUID();
    db.rememberRepository({
      id,
      name: 'fixture',
      path: root,
      lastOpenedAt: new Date().toISOString(),
    });
    await assert.rejects(service.start(root, { exclusions: [] }), /Invalid repository ID/);
    await assert.rejects(service.start(randomUUID(), { exclusions: [] }), /registered repository/);
    await service.start(id, { exclusions: DEFAULT_EXCLUSIONS });
    await assert.rejects(service.start(id, { exclusions: [] }), /in progress/);
    for (let attempts = 0; service.getState(id).status === 'running' && attempts < 200; attempts++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    const state = service.getState(id);
    assert.equal(state.status, 'complete', state.error ?? 'Worker should complete');
    assert.equal(state.result?.coverage.internalResolved, 1);
    assert.equal(state.result?.graph.edgeCount, 1);
    assert.equal(state.result?.graph.nodeCount, 2);
    assert.equal(state.result?.graph.cycleGroupCount, 0);
    const file = service.getFile(
      id,
      state.result!.files.find((file) => file.path === 'entry.ts')!.id,
    );
    assert.equal(file.imports[0].resolution.status, 'resolved');
    assert.throws(() => service.getFile(id, '../value.ts'), /Invalid parsed-file ID/);
    assert.throws(() => service.getFile(id, '0'.repeat(64)), /not present/);
    assert.equal('source' in file, false);
  } finally {
    service.dispose();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('case handling follows the host filesystem and invalid manifests leave module conditions unresolved', async () => {
  const root = fixture({ 'entry.ts': "import './VALUE';", 'value.ts': 'export const value=1;' });

  try {
    const result = await parseRepository(root);
    invariants(result);
    assert.equal(
      result.files.find((file) => file.path === 'entry.ts')!.imports[0].resolution.status,
      process.platform === 'win32' ? 'resolved' : 'unresolved',
    );
    writeFileSync(path.join(root, 'package.json'), '{invalid JSON');
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}',
    );
    writeFileSync(path.join(root, 'entry.ts'), "import '#local';");
    const invalid = await parseRepository(root);
    invariants(invalid);
    assert.equal(invalid.coverage.unresolved, 1);
    assert.ok(invalid.warnings.some((warning) => warning.includes('manifest is invalid')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('snapshot byte-budget skips are visible and every discovered file remains accounted for', async () => {
  const root = fixture({
    'first.ts': 'export const first=1;',
    'second.ts': 'export const second=2;',
  });

  try {
    const result = await parseRepository(root, undefined, undefined, {
      ...DEFAULT_LIMITS,
      maxTotalBytes: 22,
    });
    invariants(result);
    assert.equal(result.coverage.filesDiscovered, 2);
    assert.equal(result.coverage.filesParsed, 1);
    assert.equal(result.coverage.filesSkipped, 1);
    assert.ok(
      result.files
        .find((file) => file.status === 'skipped')!
        .diagnostics[0].message.includes('byte limit'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('absolute paths cannot impersonate the virtual filesystem and legitimate internal absolute imports resolve', async () => {
  const root = fixture({
    'entry.ts': "import '/repo/value';",
    'value.ts': 'export const value=1;',
  });

  try {
    const outside = await parseRepository(root);
    assert.equal(
      outside.files.find((file) => file.path === 'entry.ts')!.imports[0].resolution.status,
      'skipped',
    );
    writeFileSync(
      path.join(root, 'entry.ts'),
      `import ${JSON.stringify(path.join(root, 'value.ts'))};`,
    );
    const internal = await parseRepository(root);
    assert.deepEqual(
      internal.files.find((file) => file.path === 'entry.ts')!.imports[0].resolution,
      { status: 'resolved', targetPath: 'value.ts' },
    );
    writeFileSync(path.join(root, 'entry.ts'), "import '@alias/value';");
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      '{"compilerOptions":{"baseUrl":"/repo","paths":{"@alias/*":["*"]}}}',
    );
    const configured = await parseRepository(root);
    assert.equal(configured.coverage.internalResolved, 0);
    assert.equal(configured.coverage.unresolved, 1);
    assert.ok(
      configured.warnings.some((warning) => warning.includes('Absolute compiler-resolution paths')),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
