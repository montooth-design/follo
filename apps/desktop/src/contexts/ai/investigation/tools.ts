import type { ToolDefinition } from '@follo/llm';
import type { AnalysisService } from '../../repositories/application/analysis-service';
import type { DecisionService } from '../decisions/decision-service';
import type { SourceBudget } from '../../repositories/application/source-permissions';
import type { GraphNode } from '@follo/shared';

export interface EvidenceFile {
  id: string;
  path: string;
}
export interface ToolEvidence {
  files: EvidenceFile[];
  decisionIds: string[];
}
const id = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });

function definition(
  name: string,
  description: string,
  properties: Record<string, unknown>,
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

export const ENGINEERING_TOOLS: ToolDefinition[] = [
  definition(
    'search_code',
    'Search saved local source/path/symbol index. Returns metadata only; use get_file for permission-controlled source.',
    { query: { type: 'string', maxLength: 200 }, offset: integer(0, 10000) },
  ),
  definition(
    'get_file',
    'Get saved file metadata. source is none, snippet (1–200 lines), or full; source permissions and budgets apply.',
    {
      fileId: id,
      source: { type: 'string', enum: ['none', 'snippet', 'full'] },
      startLine: integer(1, 1000000),
      endLine: integer(1, 1000000),
    },
  ),
  ...['get_neighbors', 'get_dependencies', 'get_dependents'].map((name) =>
    definition(name, 'Get direct verified file relationships, paged by offset.', {
      fileId: id,
      offset: integer(0, 10000),
    }),
  ),
  definition(
    'get_blast_radius',
    'Get verified downstream dependents with shortest distance up to maxDepth; paged by offset.',
    { fileId: id, maxDepth: integer(0, 10), offset: integer(0, 10000) },
  ),
  definition('find_path', 'Find a shortest verified dependency path, maximum 10 edges.', {
    fileId: id,
    targetFileId: id,
  }),
  definition(
    'get_repository_summary',
    'Get snapshot coverage, graph counts and a paged file listing. Facts are historical.',
    { offset: integer(0, 10000) },
  ),
  definition(
    'get_decision',
    'Get the registered change-risk decision for a file. No risk is inferred without a decision provider.',
    { fileId: id, definitionId: { type: 'string', enum: ['change-risk'] } },
  ),
];

function argumentsFor(name: string, input: string): Record<string, unknown> {
  const tool = ENGINEERING_TOOLS.find((tool) => tool.name === name);
  if (!tool) throw new Error('Tool is not registered.');
  let value: unknown;

  try {
    value = JSON.parse(input);
  } catch {
    throw new Error('Tool arguments must be valid JSON.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Tool arguments must be an object.');
  const properties = tool.parameters.properties as Record<
    string,
    {
      type: string;
      pattern?: string;
      enum?: string[];
      minimum?: number;
      maximum?: number;
      maxLength?: number;
    }
  >;
  if (Object.keys(value).sort().join(',') !== Object.keys(properties).sort().join(','))
    throw new Error('Tool argument fields do not match the registered schema.');
  const args = value as Record<string, unknown>;

  for (const [key, schema] of Object.entries(properties)) {
    const item = args[key];
    if (
      schema.type === 'string' &&
      (typeof item !== 'string' ||
        (schema.pattern && !new RegExp(schema.pattern).test(item)) ||
        (schema.enum && !schema.enum.includes(item)) ||
        (schema.maxLength && item.length > schema.maxLength))
    )
      throw new Error('Invalid tool string argument.');
    if (
      schema.type === 'integer' &&
      (typeof item !== 'number' ||
        !Number.isInteger(item) ||
        item < schema.minimum! ||
        item > schema.maximum!)
    )
      throw new Error('Invalid tool integer argument.');
  }

  return args;
}

/** No filesystem, network, configuration or credential operations are exposed to a model. */
export class EngineeringTools {
  readonly definitions = ENGINEERING_TOOLS;
  readonly evidence: ToolEvidence = { files: [], decisionIds: [] };
  constructor(
    private readonly repositoryId: string,
    private readonly analysisId: string,
    private readonly analysis: AnalysisService,
    private readonly decisions: DecisionService,
    readonly source: SourceBudget,
  ) {}
  private record(nodes: Pick<GraphNode, 'id' | 'path'>[]) {
    for (const file of nodes)
      if (!this.evidence.files.some((existing) => existing.id === file.id))
        this.evidence.files.push({ id: file.id, path: file.path });
  }
  private page(nodes: GraphNode[], offset: number) {
    const files = nodes.slice(offset, offset + 50);
    this.record(files);

    return { files, total: nodes.length, offset, truncated: offset + files.length < nodes.length };
  }
  async execute(name: string, raw: string): Promise<unknown> {
    const args = argumentsFor(name, raw);
    const graph = this.analysis.getGraph(this.repositoryId, this.analysisId);
    const fileId = args.fileId as string;

    if (name === 'search_code') {
      const page = this.analysis.searchCode(this.repositoryId, this.analysisId, {
        query: args.query,
        offset: args.offset,
      });
      // Search snippets never enter model context implicitly, including when source permission is enabled.
      const files = page.results.map((file) => ({ id: file.fileId, path: file.path }));
      this.record(files);

      return {
        files,
        total: page.total,
        indexed: page.indexed,
        offset: args.offset,
        truncated: Number(args.offset) + files.length < page.total,
      };
    }

    if (name === 'get_repository_summary') {
      const state = this.analysis.getState(this.repositoryId).result!;

      return {
        analysisId: this.analysisId,
        savedAt: state.provenance!.savedAt,
        coverage: state.coverage,
        graph: graph.summary,
        ...this.page(graph.nodes, Number(args.offset)),
      };
    }

    const inspection = this.analysis.inspectFile(this.repositoryId, this.analysisId, {
      fileId,
      maxDepth: name === 'get_blast_radius' ? args.maxDepth : 0,
      targetFileId: name === 'find_path' ? args.targetFileId : null,
    });

    if (name === 'get_file') {
      const source =
        args.source === 'none'
          ? null
          : this.source.get(
              fileId,
              Number(args.startLine),
              Number(args.endLine),
              args.source === 'full',
            );
      this.record([inspection.file]);
      const cycles = inspection.cycles.map((cycle) => {
        const files = cycle.fileIds
          .slice(0, 50)
          .map((id) => graph.nodes.find((file) => file.id === id)!);
        this.record(files);

        return {
          id: cycle.id,
          fileCount: cycle.fileIds.length,
          files,
          truncated: cycle.fileIds.length > 50,
        };
      });

      return {
        file: {
          id: fileId,
          path: inspection.file.path,
          hash: inspection.file.hash,
          status: inspection.file.status,
        },
        metrics: inspection.metrics,
        cycles,
        source,
      };
    }

    if (name === 'get_decision') {
      let result = this.decisions
        .results(this.repositoryId, this.analysisId)
        .find((result) => result.definitionId === 'change-risk' && result.subjectId === fileId);
      if (!result)
        result = await this.decisions.evaluate(this.repositoryId, this.analysisId, fileId);
      this.record([inspection.file]);
      if (!this.evidence.decisionIds.includes(result.decisionId))
        this.evidence.decisionIds.push(result.decisionId);

      return {
        decision: result,
        interpretation:
          'Model judgment from the registered definition; probability is not measured breakage frequency.',
      };
    }

    if (name === 'find_path') {
      const path = inspection.path;
      if (path && path.length > 11) throw new Error('Path exceeds the 10-edge traversal limit.');
      if (path) this.record(path);

      return { path, analysisId: this.analysisId };
    }

    if (name === 'get_blast_radius') {
      const entries = inspection.blastRadius.slice(Number(args.offset), Number(args.offset) + 50);
      this.record(entries.map((entry) => entry.file));

      return {
        entries,
        maxDepth: args.maxDepth,
        totalWithinDepth: inspection.blastRadius.length,
        totalDependents: inspection.metrics.downstreamDependents,
        truncated: Number(args.offset) + entries.length < inspection.blastRadius.length,
        depthLimited: inspection.blastRadius.length < inspection.metrics.downstreamDependents,
      };
    }

    const nodes =
      name === 'get_dependencies'
        ? inspection.dependencies
        : name === 'get_dependents'
          ? inspection.dependents
          : [
              ...new Map(
                [...inspection.dependencies, ...inspection.dependents].map((file) => [
                  file.id,
                  file,
                ]),
              ).values(),
            ];
    const page = this.page(nodes, Number(args.offset));

    return {
      ...page,
      relationships: page.files.map((file) => ({
        fileId: file.id,
        dependency: inspection.dependencies.some((node) => node.id === file.id),
        dependent: inspection.dependents.some((node) => node.id === file.id),
      })),
    };
  }
}
