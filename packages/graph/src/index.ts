import type {
  ParsedFile,
  GraphNode,
  GraphEdge,
  GraphGap,
  GraphCycle,
  GraphSnapshot,
} from '@follo/shared';

export type Direction = 'dependencies' | 'dependents';
export interface WalkRequest {
  fileId: string;
  direction: Direction;
  maxDepth?: number;
}
export interface WalkEntry {
  fileId: string;
  depth: number;
  viaFileId: string;
}
export interface FileMetrics {
  fileId: string;
  fanIn: number;
  fanOut: number;
  directDependencies: number;
  directDependents: number;
  downstreamDependents: number;
  /** Longest dependency path in a DAG; null when a reachable cycle makes walks unbounded. */
  maxDependencyDepth: number | null;
  /** Number of strongly connected cycle groups containing this file (0 or 1). */
  cycleCount: number;
  linesOfCode: number | null;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** File-level directed graph. All public collections are defensive copies. No filesystem or framework access. */
export class EngineeringGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly outgoing = new Map<string, string[]>();
  private readonly incoming = new Map<string, string[]>();
  private readonly edges: GraphEdge[] = [];
  private readonly gaps: GraphGap[] = [];
  private readonly cycles: GraphCycle[];
  private readonly cyclic = new Set<string>();
  private readonly order: string[];

  constructor(files: readonly ParsedFile[]) {
    const paths = new Map<string, ParsedFile>();

    for (const file of files) {
      if (!file.id || !file.path || this.nodes.has(file.id) || paths.has(file.path))
        throw new Error('Graph requires unique nonempty file IDs and paths.');
      paths.set(file.path, file);
      this.nodes.set(file.id, {
        id: file.id,
        path: file.path,
        status: file.status,
        linesOfCode: file.linesOfCode,
      });
      this.outgoing.set(file.id, []);
      this.incoming.set(file.id, []);
    }

    this.order = [...this.nodes.keys()].sort(this.compareIds);

    for (const id of this.order) {
      const file = paths.get(this.nodes.get(id)!.path)!;
      const targets = new Map<string, GraphEdge>();

      for (const fact of file.imports) {
        const target =
          fact.resolution.status === 'resolved' ? paths.get(fact.resolution.targetPath) : undefined;

        if (file.status === 'parsed' && target?.status === 'parsed') {
          let edge = targets.get(target.id);

          if (!edge) {
            edge = { sourceFileId: id, targetFileId: target.id, evidence: [] };
            targets.set(target.id, edge);
          }

          edge.evidence.push(structuredClone(fact));
        } else {
          const reason =
            fact.resolution.status === 'resolved'
              ? 'Resolved endpoint is missing or skipped in the supplied snapshot.'
              : fact.resolution.status === 'external'
                ? `External package: ${fact.resolution.packageName}`
                : fact.resolution.reason;
          this.gaps.push({ sourceFileId: id, fact: structuredClone(fact), reason });
        }
      }

      for (const edge of [...targets.values()].sort((a, b) =>
        this.compareIds(a.targetFileId, b.targetFileId),
      )) {
        edge.evidence.sort(
          (a, b) =>
            a.line - b.line ||
            compare(a.kind, b.kind) ||
            compare(a.specifier ?? '', b.specifier ?? ''),
        );
        this.edges.push(edge);
        this.outgoing.get(id)!.push(edge.targetFileId);
        this.incoming.get(edge.targetFileId)!.push(id);
      }
    }

    for (const values of this.incoming.values()) values.sort(this.compareIds);
    this.gaps.sort(
      (a, b) =>
        this.compareIds(a.sourceFileId, b.sourceFileId) ||
        a.fact.line - b.fact.line ||
        compare(JSON.stringify(a.fact), JSON.stringify(b.fact)),
    );
    this.cycles = this.computeCycles();
    for (const cycle of this.cycles) for (const id of cycle.fileIds) this.cyclic.add(id);
  }

  private compareIds = (a: string, b: string): number =>
    compare(this.nodes.get(a)!.path, this.nodes.get(b)!.path) || compare(a, b);
  private require(id: string): void {
    if (!this.nodes.has(id)) throw new Error('Unknown graph file ID.');
  }
  getDependencies(fileId: string): string[] {
    this.require(fileId);

    return [...this.outgoing.get(fileId)!];
  }
  getDependents(fileId: string): string[] {
    this.require(fileId);

    return [...this.incoming.get(fileId)!];
  }
  getNeighbors(fileId: string): string[] {
    return [...new Set([...this.getDependencies(fileId), ...this.getDependents(fileId)])].sort(
      this.compareIds,
    );
  }
  calculateFanIn(fileId: string): number {
    return this.getDependents(fileId).length;
  }
  calculateFanOut(fileId: string): number {
    return this.getDependencies(fileId).length;
  }

  /** Breadth-first traversal: shortest depths, each other file once, root excluded even in cycles. */
  walk({ fileId, direction, maxDepth = this.nodes.size }: WalkRequest): WalkEntry[] {
    this.require(fileId);
    if (direction !== 'dependencies' && direction !== 'dependents')
      throw new Error('Invalid graph traversal direction.');
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0)
      throw new Error('Depth must be a nonnegative safe integer.');
    const adjacency = direction === 'dependencies' ? this.outgoing : this.incoming;
    const visited = new Set([fileId]);
    const queue = [{ fileId, depth: 0 }];
    const result: WalkEntry[] = [];

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (current.depth >= maxDepth) continue;

      for (const next of adjacency.get(current.fileId)!) {
        if (visited.has(next)) continue;
        visited.add(next);
        const entry = { fileId: next, depth: current.depth + 1, viaFileId: current.fileId };
        queue.push(entry);
        result.push(entry);
      }
    }

    return result;
  }
  getDependencyChain(fileId: string, maxDepth?: number): WalkEntry[] {
    return this.walk({ fileId, direction: 'dependencies', maxDepth });
  }
  getBlastRadius(fileId: string, maxDepth?: number): WalkEntry[] {
    return this.walk({ fileId, direction: 'dependents', maxDepth });
  }

  /** Shortest directed path; null means no verified path in this snapshot. */
  findPath({
    sourceFileId,
    targetFileId,
  }: {
    sourceFileId: string;
    targetFileId: string;
  }): string[] | null {
    this.require(sourceFileId);
    this.require(targetFileId);
    if (sourceFileId === targetFileId) return [sourceFileId];
    const entries = this.walk({ fileId: sourceFileId, direction: 'dependencies' });
    const parents = new Map(entries.map((entry) => [entry.fileId, entry.viaFileId]));
    if (!parents.has(targetFileId)) return null;
    const path = [targetFileId];
    while (path[path.length - 1] !== sourceFileId) path.push(parents.get(path[path.length - 1])!);

    return path.reverse();
  }
  findCycles(): GraphCycle[] {
    return structuredClone(this.cycles);
  }

  /** Iterative Kosaraju, O(V+E); groups are SCCs, including single-node self loops. */
  private computeCycles(): GraphCycle[] {
    const seen = new Set<string>();
    const finished: string[] = [];

    for (const root of this.order) {
      if (seen.has(root)) continue;
      seen.add(root);
      const stack = [{ id: root, next: 0 }];

      while (stack.length) {
        const frame = stack[stack.length - 1];
        const neighbors = this.outgoing.get(frame.id)!;

        if (frame.next === neighbors.length) {
          finished.push(frame.id);
          stack.pop();
          continue;
        }

        const next = neighbors[frame.next++];

        if (!seen.has(next)) {
          seen.add(next);
          stack.push({ id: next, next: 0 });
        }
      }
    }

    seen.clear();
    const groups: string[][] = [];

    for (const root of finished.reverse()) {
      if (seen.has(root)) continue;
      const group: string[] = [];
      const stack = [root];
      seen.add(root);

      while (stack.length) {
        const id = stack.pop()!;
        group.push(id);

        for (const next of this.incoming.get(id)!)
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
      }

      if (group.length > 1 || this.outgoing.get(root)!.includes(root))
        groups.push(group.sort(this.compareIds));
    }

    groups.sort((a, b) => this.compareIds(a[0], b[0]));

    // Identity is collision-free and independent of traversal/input order.
    return groups.map((fileIds) => ({ id: JSON.stringify([...fileIds].sort(compare)), fileIds }));
  }

  calculateMetrics(fileId: string): FileMetrics {
    const dependencies = this.getDependencyChain(fileId);
    const reachable = new Set([fileId, ...dependencies.map((entry) => entry.fileId)]);
    let maxDependencyDepth: number | null = null;

    if (![...reachable].some((id) => this.cyclic.has(id))) {
      // Reverse topological dynamic programming on the reachable DAG: longest, not shortest, depth.
      const pending = new Map([...reachable].map((id) => [id, this.outgoing.get(id)!.length]));
      const depths = new Map<string, number>();
      const queue = [...reachable].filter((id) => pending.get(id) === 0);
      for (const id of queue) depths.set(id, 0);

      for (let cursor = 0; cursor < queue.length; cursor++) {
        const id = queue[cursor];

        for (const parent of this.incoming.get(id)!) {
          if (!reachable.has(parent)) continue;
          depths.set(parent, Math.max(depths.get(parent) ?? 0, depths.get(id)! + 1));
          pending.set(parent, pending.get(parent)! - 1);
          if (pending.get(parent) === 0) queue.push(parent);
        }
      }

      maxDependencyDepth = depths.get(fileId)!;
    }

    const fanIn = this.calculateFanIn(fileId);
    const fanOut = this.calculateFanOut(fileId);

    return {
      fileId,
      fanIn,
      fanOut,
      directDependencies: fanOut,
      directDependents: fanIn,
      downstreamDependents: this.getBlastRadius(fileId).length,
      maxDependencyDepth,
      cycleCount: this.cyclic.has(fileId) ? 1 : 0,
      linesOfCode: this.nodes.get(fileId)!.linesOfCode,
    };
  }
  snapshot(): GraphSnapshot {
    return structuredClone({
      summary: {
        graphVersion: '0.4.0',
        nodeCount: this.nodes.size,
        edgeCount: this.edges.length,
        resolvedImportCount: this.edges.reduce((total, edge) => total + edge.evidence.length, 0),
        gapCount: this.gaps.length,
        cycleGroupCount: this.cycles.length,
        cyclicFileCount: this.cyclic.size,
      },
      nodes: this.order.map((id) => this.nodes.get(id)!),
      edges: this.edges,
      gaps: this.gaps,
      cycles: this.cycles,
      metrics: this.order.map((fileId) => ({
        fileId,
        fanIn: this.incoming.get(fileId)!.length,
        fanOut: this.outgoing.get(fileId)!.length,
        cycleCount: this.cyclic.has(fileId) ? 1 : 0,
        linesOfCode: this.nodes.get(fileId)!.linesOfCode,
      })),
    });
  }
}
