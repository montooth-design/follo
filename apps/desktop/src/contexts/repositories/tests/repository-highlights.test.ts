import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryHighlights } from '../domain/repository-highlights';

const file = (path: string, status: 'parsed' | 'skipped' = 'parsed') => ({
  id: path,
  path,
  status,
  importCount: 0,
  diagnosticCount: 0,
  reviewCount: 0,
});
test('repository area signals match path segments and camel case without inventing roles from similar names', () => {
  const areas = repositoryHighlights({
    files: [
      file('src/auth/login.ts'),
      file('src/paymentHandler.ts'),
      file('src/db/client.ts'),
      file('src/schema/user.ts'),
      file('src/jobs/emailWorker.ts'),
      file('src/author.ts'),
      file('src/database.ts', 'skipped'),
    ],
    techStack: undefined,
  });
  assert.deepEqual(
    areas.find((area) => area.id === 'auth')?.files.map((file) => file.path),
    ['src/auth/login.ts'],
  );
  assert.deepEqual(
    areas.find((area) => area.id === 'payments')?.files.map((file) => file.path),
    ['src/paymentHandler.ts'],
  );
  assert.equal(areas.find((area) => area.id === 'database')?.files.length, 1);
  assert.ok(areas.some((area) => area.id === 'schema'));
  assert.ok(areas.some((area) => area.id === 'jobs'));
  assert.ok(
    areas.every(
      (area) =>
        !area.files.some(
          (file) => file.path === 'src/author.ts' || file.path === 'src/database.ts',
        ),
    ),
  );
});
test('package-only signals retain declaration versus import evidence and test paths do not imply production features', () => {
  const areas = repositoryHighlights({
    files: [file('tests/payment.test.ts'), file('src/auth.spec.ts'), file('fixtures/db/client.ts')],
    techStack: {
      manifests: 1,
      packages: [
        {
          name: 'stripe',
          importedBy: 0,
          builtin: false,
          declarations: [{ manifest: 'package.json', kind: 'dependencies', version: '^1' }],
        },
      ],
    },
  });
  assert.equal(areas.find((area) => area.id === 'payments')?.files.length, 0);
  assert.equal(areas.find((area) => area.id === 'payments')?.packages[0].importedBy, 0);
  assert.ok(!areas.some((area) => area.id === 'auth' || area.id === 'database'));
  assert.equal(areas.find((area) => area.id === 'tests')?.files.length, 2);
});
test('highlight derivation is stable, read-only, handles Windows paths and tolerates historical snapshots without packages', () => {
  const input = { files: [file('src\\auth\\z.ts'), file('src\\auth\\a.ts')] };
  const before = structuredClone(input);
  assert.deepEqual(
    repositoryHighlights(input)[0].files.map((file) => file.path),
    ['src\\auth\\a.ts', 'src\\auth\\z.ts'],
  );
  assert.deepEqual(input, before);
  assert.deepEqual(repositoryHighlights({ files: [] }), []);
});
