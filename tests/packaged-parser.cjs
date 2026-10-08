// Runs with the packaged Electron executable in Node mode to exercise the ASAR worker.
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = fs.realpathSync('dist/smoke/repository-fixture');
const worker = new Worker(
  path.resolve('release/win-unpacked/resources/app.asar/dist/parser-worker.cjs'),
  {
    workerData: {
      root,
      options: { exclusions: ['node_modules', 'dist', 'build', 'coverage', '.git', '.next'] },
    },
  },
);
let received = false;
const timeout = setTimeout(() => {
  console.error('Packaged parser timed out');
  void worker.terminate();
  process.exitCode = 1;
}, 20000);
worker.on('message', (message) => {
  if (message.type === 'error') {
    console.error(message.message);
    process.exitCode = 1;
  }

  if (message.type === 'result') {
    received = true;

    try {
      assert.equal(message.result.coverage.filesParsed, 2);
      assert.equal(message.result.coverage.internalResolved, 1);
      assert.equal(message.result.coverage.unresolved, 1);
      assert.equal(message.result.graph.summary.nodeCount, 2);
      assert.equal(message.result.graph.summary.edgeCount, 1);
      assert.equal(message.result.graph.summary.gapCount, 2);
      assert.equal(message.result.graph.summary.cycleGroupCount, 0);
      console.log('Packaged ASAR parser and graph worker passed.');
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
});
worker.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
worker.on('exit', (code) => {
  clearTimeout(timeout);
  if (code || !received) process.exitCode = 1;
});
