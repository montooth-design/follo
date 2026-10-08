import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', 'node:sqlite'],
  sourcemap: true,
};
// Source is grouped by responsibility; runtime bundles stay flat so __dirname
// paths for the preload, parser worker, and renderer remain stable in the ASAR.
await build({
  ...common,
  entryPoints: ['apps/desktop/src/desktop/main.ts'],
  outfile: 'apps/desktop/dist/main.cjs',
});
await build({
  ...common,
  entryPoints: ['apps/desktop/src/desktop/preload.ts'],
  outfile: 'apps/desktop/dist/preload.cjs',
});
await build({
  ...common,
  entryPoints: ['apps/desktop/src/contexts/repositories/infrastructure/parser-worker.ts'],
  outfile: 'apps/desktop/dist/parser-worker.cjs',
});
