import { parentPort, workerData } from 'node:worker_threads';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import type { ParserOptions } from '@follo/shared';

const request = workerData as { root: string; options: ParserOptions };
parseRepository(request.root, request.options, (progress) => {
  if (progress.stage !== 'complete') parentPort?.postMessage({ type: 'progress', progress });
})
  .then((result) => {
    parentPort?.postMessage({
      type: 'progress',
      progress: {
        stage: 'build-graph',
        completed: 0,
        total: null,
        message: 'Building verified dependency graph…',
      },
    });
    const graph = new EngineeringGraph(result.files);
    parentPort?.postMessage({
      type: 'progress',
      progress: {
        stage: 'metrics',
        completed: 0,
        total: null,
        message: 'Summarizing graph edges and cycle groups…',
      },
    });
    const snapshot = graph.snapshot();
    parentPort?.postMessage({
      type: 'progress',
      progress: {
        stage: 'index',
        completed: result.searchDocuments?.length ?? 0,
        total: result.files.length,
        message: 'Search documents ready for local indexing.',
      },
    });
    parentPort?.postMessage({
      type: 'result',
      result: { ...result, completedAt: new Date().toISOString(), graph: snapshot },
    });
  })
  .catch((error) =>
    parentPort?.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Parser worker failed.',
    }),
  );
