import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const suites = [
  'readme',
  'foundation',
  'repositories',
  'parser',
  'graph',
  'persistence',
  'search',
  'concept-search',
  'decisions',
  'llm',
  'secrets',
  'privacy',
  'tools',
  'agent',
  'evaluation',
  'ask',
  'tech-stack',
  'repository-highlights',
  'repository-summary',
  'code-explanation',
];
const contextTests = {
  readme: 'apps/desktop/src/contexts/repositories/tests/readme.test.ts',
  repositories: 'apps/desktop/src/contexts/repositories/tests/repositories.test.ts',
  privacy: 'apps/desktop/src/contexts/repositories/tests/privacy.test.ts',
  'repository-summary': 'apps/desktop/src/contexts/repositories/tests/repository-summary.test.ts',
  'repository-highlights':
    'apps/desktop/src/contexts/repositories/tests/repository-highlights.test.ts',
  'tech-stack': 'apps/desktop/src/contexts/repositories/tests/tech-stack.test.ts',
  'code-explanation': 'apps/desktop/src/contexts/code-intelligence/tests/code-explanation.test.ts',
  'concept-search': 'apps/desktop/src/contexts/search/tests/concept-search.test.ts',
  agent: 'apps/desktop/src/contexts/ai/tests/agent.test.ts',
  ask: 'apps/desktop/src/contexts/ai/tests/ask.test.ts',
  evaluation: 'apps/desktop/src/contexts/ai/tests/evaluation.test.ts',
  llm: 'apps/desktop/src/contexts/ai/tests/llm.test.ts',
  tools: 'apps/desktop/src/contexts/ai/tests/tools.test.ts',
  secrets: 'apps/desktop/src/contexts/ai/tests/secrets.test.ts',
};

await build({
  entryPoints: suites.map((name) => contextTests[name] ?? `tests/${name}.test.ts`),
  outdir: 'dist/tests',
  entryNames: '[name]',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['node:sqlite'],
});
const result = spawnSync(
  electron,
  ['--test', ...suites.map((name) => `dist/tests/${name}.test.cjs`)],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
