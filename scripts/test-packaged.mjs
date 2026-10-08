import { spawnSync } from 'node:child_process';
import path from 'node:path';

const result = spawnSync(
  path.resolve('release/win-unpacked/Follo.exe'),
  ['tests/packaged-parser.cjs'],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
