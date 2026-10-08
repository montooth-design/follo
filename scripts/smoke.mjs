import { spawnSync } from 'node:child_process';
import electron from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const runner = path.resolve('dist/smoke/runner');
mkdirSync(runner, { recursive: true });
const { version } = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'));
writeFileSync(
  path.join(runner, 'package.json'),
  JSON.stringify({
    name: 'follo-smoke',
    productName: 'Follo',
    version,
    main: path.resolve('tests/desktop-smoke.cjs'),
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, [runner], { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
