import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGroundedness } from '../investigation/evaluation';
import type { GraphSnapshot } from '@follo/shared';
import type { DecisionResult } from '@follo/decisions';

const graph = {
  nodes: [
    { id: 'a', path: 'src/a.ts' },
    { id: 'b', path: 'src/b.ts' },
    { id: 'c', path: 'src/my file.ts' },
  ],
} as GraphSnapshot;
const evidence = {
  files: [
    { id: 'a', path: 'src/a.ts' },
    { id: 'c', path: 'src/my file.ts' },
  ],
  decisionIds: ['d'],
};
const decisions = [
  { decisionId: 'd', answers: [{ questionId: 'risk', value: 'HIGH' }] },
] as DecisionResult[];
test('reference checks reject absent and unfetched files, unreturned decisions and mismatched outcomes', () => {
  const report = evaluateGroundedness(
    'src/a.ts [file:a]; src/b.ts [file:b]; invented.ts [file:z]; [decision:d=HIGH]; [decision:d=LOW]; [decision:invented=HIGH]',
    evidence,
    graph,
    decisions,
  );
  assert.equal(report.validFileReferences, 2);
  assert.equal(report.validDecisionReferences, 1);
  assert.equal(report.unsupported.length, 6);
  assert.ok(report.unsupported.some((item) => item.reason.includes('outcome differs')));
  assert.ok(report.scope.includes('not automatically verified'));
});
test('reference checks retain uncertainty and flag uncited risk language and missing evidence', () => {
  const empty = evaluateGroundedness(
    'This is high risk.',
    { files: [], decisionIds: [] },
    graph,
    [],
  );
  assert.equal(empty.warnings.length, 2);
  const spaced = evaluateGroundedness(
    'Inspect src/my file.ts [file:c]',
    evidence,
    graph,
    decisions,
  );
  assert.equal(spaced.unsupported.length, 0);
  const unavailable = evaluateGroundedness('[decision:d=HIGH]', evidence, graph, []);
  assert.equal(unavailable.validDecisionReferences, 0);
});
