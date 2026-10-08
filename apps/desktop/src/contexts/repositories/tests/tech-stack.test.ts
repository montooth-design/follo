import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRepository } from '@follo/parser';
import { mapLayout } from '../../code-intelligence/domain/code-map-layout';
import type { GraphSnapshot } from '@follo/shared';

test('package inventory combines workspace declarations and distinct importing files, normalizes built-ins', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-stack-'));

  try {
    mkdirSync(path.join(root, 'workspace'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19' }, devDependencies: { typescript: '^5' } }),
    );
    writeFileSync(
      path.join(root, 'workspace/package.json'),
      JSON.stringify({
        peerDependencies: { react: '>=18' },
        optionalDependencies: { optional: '1' },
      }),
    );
    writeFileSync(
      path.join(root, 'a.ts'),
      "import 'react'; import 'react/jsx-runtime'; import 'node:fs'; import 'fs'; import '@vendor/tool/subpath';",
    );
    const stack = (await parseRepository(root)).techStack!;
    assert.equal(stack.manifests, 2);
    assert.equal(stack.packages.find((item) => item.name === 'react')!.importedBy, 1);
    assert.equal(stack.packages.find((item) => item.name === 'react')!.declarations.length, 2);
    assert.equal(stack.packages.find((item) => item.name === 'typescript')!.importedBy, 0);
    assert.equal(stack.packages.find((item) => item.name === 'node:fs')!.importedBy, 1);
    assert.equal(
      stack.packages.find((item) => item.name === '@vendor/tool')!.declarations.length,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('map ranks dependencies left-to-right and keeps cycle members together without overlapping nodes', () => {
  const snapshot = {
    nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, path: `${id}.ts` })),
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'b'],
      ['c', 'd'],
    ].map(([sourceFileId, targetFileId]) => ({ sourceFileId, targetFileId })),
    cycles: [{ id: 'cycle', fileIds: ['b', 'c'] }],
  } as GraphSnapshot;
  const positions = mapLayout(snapshot, new Set(['a', 'b', 'c', 'd']));
  assert.ok(positions.get('a')!.x < positions.get('b')!.x);
  assert.equal(positions.get('b')!.x, positions.get('c')!.x);
  assert.ok(positions.get('c')!.x < positions.get('d')!.x);
  assert.equal(new Set([...positions.values()].map((value) => JSON.stringify(value))).size, 4);
});
