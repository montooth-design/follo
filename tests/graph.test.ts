import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineeringGraph } from '@follo/graph';
import { parseRepository } from '@follo/parser';
import type { ParsedFile, ParsedImport } from '@follo/shared';

function file(id: string, targets: string[] = []): ParsedFile {
  return {
    id,
    path: `${id}.ts`,
    hash: null,
    linesOfCode: 3,
    status: 'parsed',
    diagnostics: [],
    imports: targets.map((target, index) => ({
      kind: 'import',
      specifier: `./${target}`,
      line: index + 1,
      resolution: { status: 'resolved', targetPath: `${target}.ts` },
    })),
  };
}

test('adjacency retains import evidence, accounts for gaps and rejects invalid endpoints', () => {
  const a = file('a', ['b', 'b', 'missing', 'skipped']);
  a.imports.push(
    {
      kind: 'dynamic',
      line: 5,
      specifier: null,
      resolution: { status: 'skipped', reason: 'Computed expression' },
    },
    {
      kind: 'import',
      line: 6,
      specifier: 'react',
      resolution: { status: 'external', packageName: 'react' },
    },
    {
      kind: 'import',
      line: 7,
      specifier: './unknown',
      resolution: { status: 'unresolved', reason: 'Missing file' },
    },
  );
  const skipped = { ...file('skipped'), status: 'skipped' as const, linesOfCode: null };
  const graph = new EngineeringGraph([a, file('b'), skipped]);
  const snapshot = graph.snapshot();
  assert.deepEqual(graph.getDependencies('a'), ['b']);
  assert.deepEqual(graph.getDependents('b'), ['a']);
  assert.deepEqual(graph.getNeighbors('a'), ['b']);
  assert.equal(snapshot.edges[0].evidence.length, 2);
  assert.equal(snapshot.summary.gapCount, 5);
  assert.equal(snapshot.summary.resolvedImportCount, 2);
  assert.equal(snapshot.summary.nodeCount, 3);
  assert.deepEqual(
    snapshot.metrics.find((value) => value.fileId === 'a'),
    { fileId: 'a', fanIn: 0, fanOut: 1, cycleCount: 0, linesOfCode: 3 },
  );
  assert.equal(
    snapshot.edges.reduce((count, edge) => count + edge.evidence.length, 0) + snapshot.gaps.length,
    a.imports.length,
  );
  assert.throws(() => new EngineeringGraph([file('a'), file('a')]), /unique/);
  assert.throws(() => new EngineeringGraph([file('a'), { ...file('b'), path: 'a.ts' }]), /unique/);
  assert.throws(() => graph.getDependencies('unknown'), /Unknown/);
  assert.throws(
    () => graph.walk({ fileId: 'a', direction: 'dependencies', maxDepth: -1 }),
    /Depth/,
  );
  assert.throws(
    () => graph.walk({ fileId: 'a', direction: 'dependencies', maxDepth: Infinity }),
    /Depth/,
  );
  assert.throws(() => graph.walk({ fileId: 'a', direction: 'bad' as 'dependencies' }), /direction/);
  assert.equal(graph.calculateMetrics('skipped').linesOfCode, null);
});
test('dependency chain and blast radius share bounded BFS with shortest depths and deterministic paths', () => {
  const graph = new EngineeringGraph([
    file('a', ['c', 'b']),
    file('b', ['d']),
    file('c', ['d']),
    file('d', ['a']),
    file('alone'),
  ]);
  assert.deepEqual(graph.getDependencyChain('a'), [
    { fileId: 'b', depth: 1, viaFileId: 'a' },
    { fileId: 'c', depth: 1, viaFileId: 'a' },
    { fileId: 'd', depth: 2, viaFileId: 'b' },
  ]);
  assert.deepEqual(
    graph.getBlastRadius('d').map((entry) => [entry.fileId, entry.depth]),
    [
      ['b', 1],
      ['c', 1],
      ['a', 2],
    ],
  );
  assert.equal(graph.getDependencyChain('a', 1).length, 2);
  assert.deepEqual(graph.getBlastRadius('d', 0), []);
  assert.deepEqual(graph.findPath({ sourceFileId: 'a', targetFileId: 'd' }), ['a', 'b', 'd']);
  assert.deepEqual(graph.findPath({ sourceFileId: 'a', targetFileId: 'a' }), ['a']);
  assert.equal(graph.findPath({ sourceFileId: 'a', targetFileId: 'alone' }), null);
});
test('cycles are stable strongly connected groups, including self loops but excluding one-way links', () => {
  const files = [
    file('a', ['b']),
    file('b', ['a', 'c']),
    file('c', ['d']),
    file('d', ['c']),
    file('e', ['e']),
    file('tail', ['a']),
    file('alone'),
  ];
  const graph = new EngineeringGraph(files);
  assert.deepEqual(
    graph.findCycles().map((cycle) => cycle.fileIds),
    [['a', 'b'], ['c', 'd'], ['e']],
  );
  assert.equal(graph.calculateMetrics('tail').cycleCount, 0);
  assert.equal(graph.calculateMetrics('tail').maxDependencyDepth, null);
  assert.equal(graph.calculateMetrics('e').cycleCount, 1);
  assert.equal(graph.calculateFanIn('e'), 1);
  assert.equal(graph.getBlastRadius('e').length, 0);
  const reverse = [...files]
    .reverse()
    .map((value) => ({ ...value, imports: [...value.imports].reverse() }));
  assert.deepEqual(new EngineeringGraph(reverse).snapshot(), graph.snapshot());
});
test('DAG metrics distinguish longest dependency depth from shortest BFS depth', () => {
  const graph = new EngineeringGraph([
    file('a', ['d', 'b']),
    file('b', ['c']),
    file('c', ['d']),
    file('d'),
    file('other', ['d']),
  ]);
  assert.equal(graph.getDependencyChain('a').find((entry) => entry.fileId === 'd')!.depth, 1);
  assert.equal(graph.calculateMetrics('a').maxDependencyDepth, 3);
  assert.deepEqual(graph.calculateMetrics('d'), {
    fileId: 'd',
    fanIn: 3,
    fanOut: 0,
    directDependencies: 0,
    directDependents: 3,
    downstreamDependents: 4,
    maxDependencyDepth: 0,
    cycleCount: 0,
    linesOfCode: 3,
  });
  assert.equal(new EngineeringGraph([]).snapshot().summary.nodeCount, 0);
});
test('input and returned collections cannot mutate graph facts or future queries', () => {
  const a = file('a', ['b']);
  const graph = new EngineeringGraph([a, file('b', ['a'])]);
  a.imports.length = 0;
  a.path = 'changed';
  graph.getDependencies('a').length = 0;
  const snapshot = graph.snapshot();
  snapshot.edges[0].evidence[0].resolution = { status: 'skipped', reason: 'changed' };
  snapshot.nodes[0].path = 'changed';
  graph.findCycles()[0].fileIds.length = 0;
  assert.deepEqual(graph.getDependencies('a'), ['b']);
  assert.equal(graph.snapshot().nodes[0].path, 'a.ts');
  assert.equal(graph.snapshot().edges[0].evidence[0].resolution.status, 'resolved');
  assert.equal(graph.findCycles()[0].fileIds.length, 2);
});
test('iterative algorithms handle a 10,000-file chain and large cycle without call-stack overflow', () => {
  const ids = Array.from({ length: 10000 }, (_, index) => `f${index.toString().padStart(5, '0')}`);
  const files = ids.map((id, index) => file(id, index + 1 < ids.length ? [ids[index + 1]] : []));
  const graph = new EngineeringGraph(files);
  assert.equal(graph.calculateMetrics(ids[0]).maxDependencyDepth, 9999);
  assert.equal(graph.getBlastRadius(ids[9999]).length, 9999);
  assert.equal(graph.findCycles().length, 0);
  files[9999].imports = file(ids[9999], [ids[0]]).imports;
  const cyclic = new EngineeringGraph(files);
  assert.equal(cyclic.findCycles()[0].fileIds.length, 10000);
  assert.equal(cyclic.calculateMetrics(ids[0]).maxDependencyDepth, null);
});
test('seeded small graphs agree with independent transitive-closure reachability and cycle oracle', () => {
  let seed = 413;

  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;

    return seed / 4294967296;
  };

  for (let trial = 0; trial < 30; trial++) {
    const size = 8;
    const ids = Array.from({ length: size }, (_, index) => String(index));
    const edges = ids.map(() => ids.map(() => random() < 0.2));
    const closure = edges.map((row) => [...row]);
    for (let k = 0; k < size; k++)
      for (let i = 0; i < size; i++)
        for (let j = 0; j < size; j++) closure[i][j] ||= closure[i][k] && closure[k][j];
    const graph = new EngineeringGraph(
      ids.map((id, i) =>
        file(
          id,
          ids.filter((_, j) => edges[i][j]),
        ),
      ),
    );
    const groups = graph.findCycles();

    for (let i = 0; i < size; i++) {
      assert.deepEqual(
        graph
          .getDependencyChain(ids[i])
          .map((entry) => entry.fileId)
          .sort(),
        ids.filter((_, j) => j !== i && closure[i][j]),
      );
      assert.deepEqual(
        graph
          .getBlastRadius(ids[i])
          .map((entry) => entry.fileId)
          .sort(),
        ids.filter((_, j) => j !== i && closure[j][i]),
      );
      assert.equal(graph.calculateMetrics(ids[i]).cycleCount, Number(closure[i][i]));

      for (let j = 0; j < size; j++) {
        assert.equal(
          groups.some((group) => group.fileIds.includes(ids[i]) && group.fileIds.includes(ids[j])),
          closure[i][j] && closure[j][i],
        );
        const found = graph.findPath({ sourceFileId: ids[i], targetFileId: ids[j] });
        assert.equal(found !== null, i === j || closure[i][j]);
        if (found)
          for (let p = 1; p < found.length; p++)
            assert.ok(edges[Number(found[p - 1])][Number(found[p])]);
      }
    }
  }
});
test('real TS/JS parser facts produce verified graph edges, reexports, dynamic edges and visible uncertainty', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'follo-graph-'));

  try {
    writeFileSync(
      path.join(root, 'a.ts'),
      "export * from './b'; import('./b'); import './missing'; import 'react';",
    );
    writeFileSync(path.join(root, 'b.jsx'), "import './a'; export const value = <div/>;");
    const parsed = await parseRepository(root);
    const graph = new EngineeringGraph(parsed.files);
    const a = parsed.files.find((value) => value.path === 'a.ts')!;
    const b = parsed.files.find((value) => value.path === 'b.jsx')!;
    assert.deepEqual(graph.getDependencies(a.id), [b.id]);
    assert.equal(graph.snapshot().summary.resolvedImportCount, 3);
    assert.equal(graph.snapshot().summary.edgeCount, 2);
    assert.equal(graph.snapshot().summary.gapCount, 2);
    assert.equal(graph.findCycles().length, 1);
    assert.equal(graph.getBlastRadius(a.id)[0].fileId, b.id);
    assert.ok(
      graph
        .snapshot()
        .edges.some((edge) => edge.evidence.some((fact: ParsedImport) => fact.kind === 'dynamic')),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
