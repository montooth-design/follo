import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { LocalDatabase } from '@follo/database';
import { inspectGit } from './repository-service';
import { EngineeringGraph } from '@follo/graph';
import {
  validateParserOptions,
  validateRepositoryId,
  type AnalysisState,
  type EngineeringAnalysis,
  type ParserOptions,
  type ParserProgress,
  type ParsedFile,
  type SavedAnalysis,
  type FileInspection,
  type SnapshotSource,
} from '@follo/shared';

type WorkerMessage =
  | { type: 'progress'; progress: ParserProgress }
  | { type: 'result'; result: EngineeringAnalysis }
  | { type: 'error'; message: string };
/** Coordinates worker scans and validates access to the current saved snapshot.
 * Rendering a saved file never re-reads its live source from disk.
 */
export class AnalysisService {
  private readonly states = new Map<string, AnalysisState>();
  private readonly results = new Map<string, EngineeringAnalysis>();
  private worker: Worker | null = null;
  private starting = false;
  constructor(
    private readonly database: LocalDatabase,
    private readonly workerPath = path.join(__dirname, 'parser-worker.cjs'),
  ) {}

  private registered(input: unknown): string {
    const id = validateRepositoryId(input);
    if (!this.database.getRepository(id))
      throw new Error('Select a registered repository before analysis.');

    return id;
  }

  async start(input: unknown, options: unknown): Promise<void> {
    const id = this.registered(input);
    const validated = validateParserOptions(options);
    if (this.worker || this.starting) throw new Error('Another parser analysis is in progress.');
    this.starting = true;

    try {
      const stored = this.database.getRepository(id)!;
      let root: string;

      try {
        root = await realpath(stored.path);
      } catch {
        throw new Error('Repository folder is missing or inaccessible.');
      }

      const normalized = (value: string) =>
        process.platform === 'win32' ? value.toLowerCase() : value;
      if (normalized(root) !== normalized(stored.path))
        throw new Error('Repository path changed; select it again.');
      const gitWarnings: string[] = [];
      const git = await inspectGit(root, gitWarnings);
      this.states.clear();
      this.results.clear();
      const state: AnalysisState = {
        status: 'running',
        progress: {
          stage: 'discover',
          completed: 0,
          total: null,
          message: 'Starting parser analysis…',
        },
        result: null,
        error: null,
      };
      this.states.set(id, state);
      const worker = new Worker(this.workerPath, {
        workerData: { root, options: validated as ParserOptions },
        resourceLimits: { maxOldGenerationSizeMb: 768 },
      });
      this.worker = worker;

      const fail = (message: string) => {
        if (state.status !== 'running') return;
        state.status = 'failed';
        state.error = message;
      };

      const timeout = setTimeout(() => {
        fail('Parser analysis exceeded its two-minute limit. Reduce the scope or add exclusions.');
        void worker.terminate();
      }, 120000);
      worker.on('message', (message: WorkerMessage) => {
        if (state.status !== 'running') return;

        if (message.type === 'progress') state.progress = message.progress;
        else if (message.type === 'error') fail(message.message);
        else {
          try {
            state.progress = {
              stage: 'store',
              completed: 0,
              total: null,
              message: 'Saving analysis locally…',
            };
            message.result.warnings.push(...gitWarnings);
            const saved = this.database.saveAnalysis(id, message.result, git);
            this.setResult(id, saved, state);
          } catch (error) {
            fail(
              `Analysis could not be saved: ${error instanceof Error ? error.message : 'Unknown storage error'}`,
            );
          }
        }
      });
      worker.on('error', (error) => fail(error.message));
      worker.on('exit', (code) => {
        clearTimeout(timeout);
        fail(
          code
            ? `Parser worker exited with code ${code}.`
            : 'Parser worker exited without an analysis result.',
        );
        if (this.worker === worker) this.worker = null;
      });
    } catch (error) {
      const state = this.states.get(id);

      if (state?.status === 'running') {
        state.status = 'failed';
        state.error = error instanceof Error ? error.message : 'Could not start parser worker.';
      }

      throw error;
    } finally {
      this.starting = false;
    }
  }

  getState(input: unknown): AnalysisState {
    const id = this.registered(input);

    if (!this.states.has(id)) {
      const saved = this.database.getLatestAnalysis(id);
      if (saved) this.setResult(id, saved);
    }

    return this.states.get(id) ?? { status: 'idle', progress: null, result: null, error: null };
  }
  private setResult(
    id: string,
    saved: SavedAnalysis,
    state: AnalysisState = { status: 'complete', progress: null, result: null, error: null },
  ): void {
    this.results.set(id, saved);
    const {
      files,
      graph,
      searchDocuments: _searchDocuments,
      analysisId,
      git,
      savedAt,
      repositoryId: _repositoryId,
      ...summary
    } = saved;
    void _repositoryId;
    void _searchDocuments;
    state.result = {
      ...summary,
      provenance: { analysisId, git, savedAt },
      graph: graph.summary,
      files: files.map((file) => ({
        id: file.id,
        path: file.path,
        status: file.status,
        importCount: file.imports.length,
        diagnosticCount: file.diagnostics.length,
        reviewCount: file.imports.filter(
          (item) => item.resolution.status === 'unresolved' || item.resolution.status === 'skipped',
        ).length,
      })),
    };
    state.status = 'complete';
    state.progress = {
      stage: 'complete',
      completed: files.length,
      total: files.length,
      message: 'Saved analysis ready.',
    };
    this.states.set(id, state);
  }
  getFile(input: unknown, fileId: unknown): ParsedFile {
    const id = this.registered(input);
    this.getState(id);
    if (typeof fileId !== 'string' || !/^[0-9a-f]{64}$/.test(fileId))
      throw new Error('Invalid parsed-file ID.');
    const file = this.results.get(id)?.files.find((file) => file.id === fileId);
    if (!file) throw new Error('File is not present in the current parser analysis.');

    return file;
  }
  getGraph(input: unknown, analysisId: unknown) {
    const id = this.registered(input);
    const state = this.getState(id);

    if (
      typeof analysisId !== 'string' ||
      state.status !== 'complete' ||
      state.result?.provenance?.analysisId !== analysisId
    ) {
      throw new Error('Analysis changed or is unavailable. Reload the saved snapshot.');
    }

    return this.results.get(id)!.graph;
  }
  getSource(input: unknown, analysisId: unknown, fileId: unknown): SnapshotSource {
    this.getGraph(input, analysisId);
    const file = this.getFile(input, fileId);
    const content = this.database.getSource(analysisId as string, file.id);
    const extension = file.path.split('.').at(-1)?.toLowerCase();
    const language =
      extension === 'tsx'
        ? 'tsx'
        : extension === 'ts'
          ? 'typescript'
          : extension === 'jsx'
            ? 'jsx'
            : 'javascript';

    return {
      fileId: file.id,
      path: file.path,
      language,
      content,
      lineCount: content === null ? 0 : content.split('\n').length,
    };
  }
  inspectFile(input: unknown, analysisId: unknown, request: unknown): FileInspection {
    if (
      typeof request !== 'object' ||
      !request ||
      Array.isArray(request) ||
      Object.keys(request).sort().join(',') !== 'fileId,maxDepth,targetFileId' ||
      !('fileId' in request) ||
      typeof request.fileId !== 'string' ||
      !/^[0-9a-f]{64}$/.test(request.fileId) ||
      !('maxDepth' in request) ||
      typeof request.maxDepth !== 'number' ||
      !Number.isInteger(request.maxDepth) ||
      request.maxDepth < 0 ||
      request.maxDepth > 50 ||
      !('targetFileId' in request) ||
      (request.targetFileId !== null &&
        (typeof request.targetFileId !== 'string' || !/^[0-9a-f]{64}$/.test(request.targetFileId)))
    ) {
      throw new Error(
        'Invalid file inspection request. Depth must be 0–50 and IDs must belong to the snapshot.',
      );
    }

    const fileId = request.fileId;
    const snapshot = this.getGraph(input, analysisId);
    const id = this.registered(input);
    const result = this.results.get(id)!;
    const graph = new EngineeringGraph(result.files);
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const file = this.getFile(id, request.fileId);
    const metrics = graph.calculateMetrics(request.fileId);
    const path =
      request.targetFileId === null
        ? null
        : graph.findPath({ sourceFileId: request.fileId, targetFileId: request.targetFileId });

    return {
      file,
      metrics,
      dependencies: graph.getDependencies(request.fileId).map((id) => nodes.get(id)!),
      dependents: graph.getDependents(request.fileId).map((id) => nodes.get(id)!),
      dependencyChain: graph
        .getDependencyChain(request.fileId, request.maxDepth)
        .map((entry) => ({ file: nodes.get(entry.fileId)!, depth: entry.depth })),
      blastRadius: graph
        .getBlastRadius(request.fileId, request.maxDepth)
        .map((entry) => ({ file: nodes.get(entry.fileId)!, depth: entry.depth })),
      cycles: graph.findCycles().filter((cycle) => cycle.fileIds.includes(fileId)),
      path: path?.map((id) => nodes.get(id)!) ?? null,
    };
  }
  searchCode(input: unknown, analysisId: unknown, request: unknown) {
    this.getGraph(input, analysisId);

    if (
      typeof request !== 'object' ||
      !request ||
      Array.isArray(request) ||
      Object.keys(request).sort().join(',') !== 'offset,query' ||
      !('query' in request) ||
      !('offset' in request) ||
      typeof request.offset !== 'number'
    ) {
      throw new Error('Invalid search request.');
    }

    return this.database.searchCode(analysisId as string, request.query, request.offset);
  }
  dispose(): void {
    void this.worker?.terminate();
    this.worker = null;
  }
}
