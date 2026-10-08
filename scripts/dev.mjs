import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ configFile: 'apps/desktop/vite.config.ts' });
await server.listen();
const env = { ...process.env, FOLLO_DEV_URL: 'http://127.0.0.1:5173/' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['apps/desktop'], { stdio: 'inherit', env });

async function stop(code = 0) {
  child.kill();
  await server.close();
  process.exit(code);
}

child.on('exit', (code) => void stop(code ?? 1));
child.on('error', (error) => {
  console.error(error);
  void stop(1);
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
