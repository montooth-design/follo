export const CHANNELS = {
  readmeEvidence: 'engineering:readme:evidence',
  readmeGenerate: 'engineering:readme:generate',
  readmeState: 'engineering:readme:state',
  readmeCancel: 'engineering:readme:cancel',
  readmeSave: 'engineering:readme:save',
  readmeExport: 'engineering:readme:export',
  status: 'engineering:status',
  getSettings: 'engineering:settings:get',
  updateSettings: 'engineering:settings:update',
  openRepository: 'engineering:repository:open',
  recentRepositories: 'engineering:repository:recent',
  reopenRepository: 'engineering:repository:reopen',
  analyzeRepository: 'engineering:analysis:start',
  analysisState: 'engineering:analysis:state',
  parsedFile: 'engineering:analysis:file',
  graph: 'engineering:analysis:graph',
  inspectFile: 'engineering:analysis:inspect',
  search: 'engineering:analysis:search',
  conceptSearch: 'engineering:concept:start',
  conceptSearchState: 'engineering:concept:state',
  cancelConceptSearch: 'engineering:concept:cancel',
  decisionDefinitions: 'engineering:decisions:definitions',
  evaluateDecision: 'engineering:decisions:evaluate',
  decisionResults: 'engineering:decisions:results',
  aiStatus: 'engineering:ai:status',
  configureLlm: 'engineering:ai:configure',
  testLlm: 'engineering:ai:test',
  configureDecision: 'engineering:ai:decision:configure',
  testDecision: 'engineering:ai:decision:test',
  configureOpenRouter: 'engineering:ai:openrouter:configure',
  openRouterModels: 'engineering:ai:openrouter:models',
  privacy: 'engineering:privacy:get',
  setPrivacy: 'engineering:privacy:set',
  ask: 'engineering:ask:start',
  askState: 'engineering:ask:state',
  cancelAsk: 'engineering:ask:cancel',
  repositorySummary: 'engineering:summary:get',
  generateSummary: 'engineering:summary:start',
  summaryState: 'engineering:summary:state',
  cancelSummary: 'engineering:summary:cancel',
  fileSource: 'engineering:analysis:source',
  explainCode: 'engineering:code:start',
  codeExplanationState: 'engineering:code:state',
  cancelCodeExplanation: 'engineering:code:cancel',
} as const;

export interface Settings {
  theme: 'dark' | 'light';
}
export interface AppStatus {
  styleNonce?: string;
  name: string;
  version: string;
  storage: 'ready';
  schemaVersion: number;
  phase: number;
}
export interface RecentRepository {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}
export interface Repository extends RecentRepository {
  inspectedAt: string;
  project: {
    packageJson: boolean;
    tsconfigJson: boolean;
    jsconfigJson: boolean;
    typescriptFiles: number;
    javascriptFiles: number;
    sourceFiles: number;
    scanComplete: boolean;
    skippedSymlinks: number;
  };
  git: {
    status: 'repository' | 'not-repository' | 'unavailable' | 'error';
    root: string | null;
    branch: string | null;
    commit: string | null;
    detached: boolean;
    workingTree: 'clean' | 'modified' | 'unknown';
  };
  warnings: string[];
}
export interface EngineeringBridge {
  getReadmeEvidence(repositoryId: string, analysisId: string): Promise<ReadmeEvidence>;
  generateReadme(repositoryId: string, analysisId: string, evidenceId: string): Promise<string>;
  getReadmeState(id: string): Promise<AskState>;
  cancelReadme(id: string): Promise<void>;
  saveReadmeDraft(repositoryId: string, analysisId: string, content: string): Promise<string>;
  exportReadme(content: string): Promise<string | null>;
  getStatus(): Promise<AppStatus>;
  getSettings(): Promise<Settings>;
  updateSettings(settings: Settings): Promise<Settings>;
  openRepository(): Promise<Repository | null>;
  getRecentRepositories(): Promise<RecentRepository[]>;
  reopenRepository(id: string): Promise<Repository>;
  analyzeRepository(id: string, options: ParserOptions): Promise<void>;
  getAnalysisState(id: string): Promise<AnalysisState>;
  getParsedFile(repositoryId: string, fileId: string): Promise<ParsedFile>;
  getGraph(repositoryId: string, analysisId: string): Promise<GraphSnapshot>;
  inspectFile(
    repositoryId: string,
    analysisId: string,
    request: InspectRequest,
  ): Promise<FileInspection>;
  searchCode(repositoryId: string, analysisId: string, request: SearchRequest): Promise<SearchPage>;
  searchConcept(repositoryId: string, analysisId: string, query: string): Promise<string>;
  getConceptSearchState(id: string): Promise<ConceptSearchState>;
  cancelConceptSearch(id: string): Promise<void>;
  getDecisionDefinitions(): Promise<
    { id: string; version: number; name: string; configured: boolean }[]
  >;
  evaluateChangeRisk(
    repositoryId: string,
    analysisId: string,
    fileId: string,
  ): Promise<import('@follo/decisions').DecisionResult>;
  getDecisionResults(
    repositoryId: string,
    analysisId: string,
  ): Promise<import('@follo/decisions').DecisionResult[]>;
  getAiStatus(): Promise<AiStatus>;
  configureLlm(
    input: { endpoint: string; model: string; apiKey: string } | null,
  ): Promise<AiStatus>;
  testLlmConnection(): Promise<AiStatus>;
  configureDecision(input: AiConnectionInput | null): Promise<AiStatus>;
  testDecisionConnection(): Promise<AiStatus>;
  configureOpenRouter(input: {
    apiKey: string;
    llmModel: string;
    decisionModel: string;
  }): Promise<AiStatus>;
  getOpenRouterModels(): Promise<AiModel[]>;
  getPrivacy(repositoryId: string, analysisId: string): Promise<PrivacyPolicy>;
  setPrivacy(
    repositoryId: string,
    analysisId: string,
    policy: PrivacyPolicy,
  ): Promise<PrivacyPolicy>;
  ask(repositoryId: string, analysisId: string, question: string): Promise<string>;
  getAskState(id: string): Promise<AskState>;
  cancelAsk(): Promise<void>;
  getRepositorySummary(repositoryId: string): Promise<RepositorySummary | null>;
  generateRepositorySummary(repositoryId: string, analysisId: string): Promise<string>;
  getRepositorySummaryState(id: string): Promise<RepositorySummaryState>;
  cancelRepositorySummary(): Promise<void>;
  getFileSource(repositoryId: string, analysisId: string, fileId: string): Promise<SnapshotSource>;
  explainCode(
    repositoryId: string,
    analysisId: string,
    request: ExplainCodeRequest,
  ): Promise<string>;
  getCodeExplanationState(id: string): Promise<AskState>;
  cancelCodeExplanation(id: string): Promise<void>;
}
export interface ExplainCodeRequest {
  fileId: string;
  startLine: number;
  endLine: number;
  question: string;
}
export interface SnapshotSource {
  fileId: string;
  path: string;
  language: 'typescript' | 'tsx' | 'javascript' | 'jsx';
  content: string | null;
  lineCount: number;
}
export interface SummaryFinding {
  text: string;
  fileIds: string[];
  inferred: boolean;
}
export interface RepositorySummary {
  analysisId: string;
  generatedAt: string;
  model: string;
  permission: PrivacyPolicy['level'];
  purpose: SummaryFinding;
  features: SummaryFinding[];
  workflow: SummaryFinding;
  limitations: string[];
  evidence: { id: string; path: string }[];
}
export interface RepositorySummaryState {
  id: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  activeTool?: string;
  result: RepositorySummary | null;
  error: string | null;
}
export interface AskState {
  id: string;
  repositoryId: string;
  analysisId: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  streamedText: string;
  answer: string;
  activeTool?: string;
  error: string | null;
  activity: {
    name: string;
    status: 'running' | 'complete' | 'failed';
    latencyMs: number;
    error?: string;
  }[];
  evidence: { files: { id: string; path: string }[]; decisionIds: string[] };
  stats: {
    toolCalls: number;
    toolFailures: number;
    rounds: number;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
  evaluation?: GroundednessReport;
  observationError?: string;
}
export interface GroundednessReport {
  fileReferences: number;
  validFileReferences: number;
  decisionReferences: number;
  validDecisionReferences: number;
  unsupported: { reference: string; reason: string }[];
  warnings: string[];
  scope: string;
}
export interface PrivacyPolicy {
  level: 'graph-only' | 'selected-source' | 'full-file';
  selectedFileIds: string[];
}
export interface AiConnectionInput {
  endpoint: string;
  model: string;
  apiKey: string;
}
export interface AiConnectionStatus {
  configured: boolean;
  verified: boolean;
  endpoint: string;
  model: string;
}
export interface AiModel {
  id: string;
  name: string;
  kind: 'llm' | 'decision';
}
export interface AiStatus {
  decisionConfigured: boolean;
  llm: AiConnectionStatus;
  decision: AiConnectionStatus;
  secureStorageAvailable: boolean;
}

export const DEFAULT_EXCLUSIONS = ['node_modules', 'dist', 'build', 'coverage', '.git', '.next'];
export interface ParserOptions {
  exclusions: string[];
}

export function validateParserOptions(input: unknown): ParserOptions {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !('exclusions' in input) ||
    !Array.isArray(input.exclusions) ||
    input.exclusions.length > 50 ||
    input.exclusions.some(
      (value) =>
        typeof value !== 'string' ||
        !/^[a-zA-Z0-9_.-]{1,80}$/.test(value) ||
        value === '.' ||
        value === '..',
    )
  ) {
    throw new Error('Exclusions must be up to 50 directory names, with no paths or wildcards.');
  }

  return { exclusions: [...new Set([...input.exclusions, '.git'])] };
}

export type ImportResolution =
  | { status: 'resolved'; targetPath: string }
  | { status: 'external'; packageName: string }
  | { status: 'skipped'; reason: string }
  | { status: 'unresolved'; reason: string };
export interface ParsedImport {
  kind: 'import' | 'reexport' | 'dynamic' | 'require' | 'import-type';
  specifier: string | null;
  line: number;
  resolution: ImportResolution;
}
export interface ParserDiagnostic {
  line: number | null;
  message: string;
}
export interface ParsedFile {
  id: string;
  path: string;
  hash: string | null;
  linesOfCode: number | null;
  status: 'parsed' | 'skipped';
  imports: ParsedImport[];
  diagnostics: ParserDiagnostic[];
}
export interface ParserCoverage {
  filesDiscovered: number;
  filesParsed: number;
  filesSkipped: number;
  filesWithSyntaxErrors: number;
  importsDiscovered: number;
  internalResolved: number;
  external: number;
  skipped: number;
  unresolved: number;
  discoveryComplete: boolean;
}
export interface ParserProgress {
  stage:
    'discover' | 'parse' | 'resolve' | 'build-graph' | 'metrics' | 'index' | 'store' | 'complete';
  completed: number;
  total: number | null;
  message: string;
}
export interface ParserAnalysis {
  techStack?: {
    packages: {
      name: string;
      declarations: { manifest: string; kind: string; version: string }[];
      importedBy: number;
      builtin: boolean;
    }[];
    manifests: number;
  };
  parserVersion: string;
  root: string;
  startedAt: string;
  completedAt: string;
  exclusions: string[];
  coverage: ParserCoverage;
  files: ParsedFile[];
  warnings: string[];
  searchDocuments?: SearchDocument[];
}
export interface SearchDocument {
  fileId: string;
  path: string;
  symbols: string;
  source: string;
}
export interface SearchRequest {
  query: string;
  offset: number;
}
export interface SearchResult {
  fileId: string;
  path: string;
  snippet: string;
}
export interface SearchPage {
  results: SearchResult[];
  total: number;
  indexed: boolean;
}
export interface ConceptSearchState {
  id: string;
  status: AskState['status'];
  activeTool?: string;
  error: string | null;
  result: {
    results: { fileId: string; path: string; reason: string }[];
    limitations: string[];
  } | null;
}
export interface GraphNode {
  id: string;
  path: string;
  status: ParsedFile['status'];
  linesOfCode: number | null;
}
export interface GraphEdge {
  sourceFileId: string;
  targetFileId: string;
  evidence: ParsedImport[];
}
export interface GraphGap {
  sourceFileId: string;
  fact: ParsedImport;
  reason: string;
}
export interface GraphCycle {
  id: string;
  fileIds: string[];
}
export interface GraphDirectMetrics {
  fileId: string;
  fanIn: number;
  fanOut: number;
  cycleCount: number;
  linesOfCode: number | null;
}
export interface InspectRequest {
  fileId: string;
  maxDepth: number;
  targetFileId: string | null;
}
export interface FileInspection {
  file: ParsedFile;
  metrics: GraphDirectMetrics & {
    directDependencies: number;
    directDependents: number;
    downstreamDependents: number;
    maxDependencyDepth: number | null;
  };
  dependencies: GraphNode[];
  dependents: GraphNode[];
  dependencyChain: { file: GraphNode; depth: number }[];
  blastRadius: { file: GraphNode; depth: number }[];
  cycles: GraphCycle[];
  path: GraphNode[] | null;
}
export interface GraphSummary {
  graphVersion: string;
  nodeCount: number;
  edgeCount: number;
  resolvedImportCount: number;
  gapCount: number;
  cycleGroupCount: number;
  cyclicFileCount: number;
}
export interface GraphSnapshot {
  summary: GraphSummary;
  nodes: GraphNode[];
  edges: GraphEdge[];
  gaps: GraphGap[];
  cycles: GraphCycle[];
  metrics: GraphDirectMetrics[];
}
export interface EngineeringAnalysis extends ParserAnalysis {
  graph: GraphSnapshot;
  searchIndexed?: boolean;
}
export interface SavedAnalysis extends EngineeringAnalysis {
  analysisId: string;
  repositoryId: string;
  git: Repository['git'];
  savedAt: string;
}
export interface AnalysisProvenance {
  analysisId: string;
  git: Repository['git'];
  savedAt: string;
}
export interface AnalysisSummary extends Omit<
  EngineeringAnalysis,
  'files' | 'graph' | 'searchDocuments'
> {
  provenance?: AnalysisProvenance;
  graph: GraphSummary;
  files: {
    id: string;
    path: string;
    status: ParsedFile['status'];
    importCount: number;
    diagnosticCount: number;
    reviewCount: number;
  }[];
}
export interface AnalysisState {
  status: 'idle' | 'running' | 'complete' | 'failed';
  progress: ParserProgress | null;
  result: AnalysisSummary | null;
  error: string | null;
}

export function validateRepositoryId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
  ) {
    throw new Error('Invalid repository ID.');
  }

  return input;
}

export function validateSettings(input: unknown): Settings {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !('theme' in input) ||
    (input.theme !== 'dark' && input.theme !== 'light')
  ) {
    throw new Error('Settings must contain only a valid theme.');
  }

  return { theme: input.theme };
}

export interface ReadmeEvidence {
  id: string;
  files: { path: string; content: string }[];
  limitations: string[];
}
