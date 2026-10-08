import type { LocalDatabase } from '@follo/database';
import type { PrivacyPolicy } from '@follo/shared';
import type { AnalysisService } from './analysis-service';
import { redactSecrets } from '@follo/llm';

export function validatePolicy(input: unknown, fileIds: Set<string>): PrivacyPolicy {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'level,selectedFileIds' ||
    !('level' in input) ||
    !['graph-only', 'selected-source', 'full-file'].includes(String(input.level)) ||
    !('selectedFileIds' in input) ||
    !Array.isArray(input.selectedFileIds) ||
    input.selectedFileIds.length > 50 ||
    input.selectedFileIds.some((id) => typeof id !== 'string' || !fileIds.has(id))
  )
    throw new Error('Invalid source permission selection.');
  if (input.level !== 'selected-source' && input.selectedFileIds.length)
    throw new Error('Only Selected Source accepts a file selection.');

  return {
    level: input.level as PrivacyPolicy['level'],
    selectedFileIds: [...new Set(input.selectedFileIds)],
  };
}

export class SourceBudget {
  private usedBytes = 0;
  private readonly files = new Set<string>();
  constructor(
    private readonly policy: PrivacyPolicy,
    private readonly read: (fileId: string) => string | null,
    private readonly maxBytes = 65536,
    private readonly maxFiles = 12,
  ) {}
  get usage() {
    return { sourceBytes: this.usedBytes, sourceFiles: this.files.size };
  }
  get(fileId: string, startLine: number, endLine: number, full: boolean) {
    if (this.policy.level === 'graph-only') throw new Error('Graph Only forbids source access.');
    if (
      this.policy.level === 'selected-source' &&
      (!this.policy.selectedFileIds.includes(fileId) || full)
    )
      throw new Error('Selected Source permits snippets from explicitly selected files only.');
    if (
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine - startLine >= 200
    )
      throw new Error('Snippet range must contain 1–200 lines.');
    if (!this.files.has(fileId) && this.files.size >= this.maxFiles)
      throw new Error('Source file budget exceeded.');
    const source = this.read(fileId);
    if (source === null) throw new Error('Source is unavailable in this saved snapshot.');
    const safeSource = redactSecrets(source);
    const lines = safeSource.split('\n');
    if (!full && startLine > lines.length) throw new Error('Snippet starts beyond the saved file.');
    const content = full ? safeSource : lines.slice(startLine - 1, endLine).join('\n');
    const bytes = Buffer.byteLength(content);
    if (bytes > this.maxBytes - this.usedBytes)
      throw new Error('Source byte budget exceeded. Request a smaller snippet.');
    this.usedBytes += bytes;
    this.files.add(fileId);

    return {
      fileId,
      startLine: full ? 1 : startLine,
      endLine: full ? lines.length : Math.min(endLine, lines.length),
      content,
      snapshot: true,
    };
  }
}

export class PrivacyService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly analysis: AnalysisService,
  ) {}
  get(repositoryId: unknown, analysisId: unknown): PrivacyPolicy {
    const graph = this.analysis.getGraph(repositoryId, analysisId);
    const key = `privacy:repository:${repositoryId}`;
    const stored = this.database.readConfiguration(key);
    const fileIds = new Set(
      graph.nodes.filter((file) => file.status === 'parsed').map((file) => file.id),
    );

    if (!stored) {
      const legacy = this.database.readConfiguration(`privacy:${analysisId}`);
      const policy = legacy
        ? validatePolicy(legacy, fileIds)
        : { level: 'graph-only' as const, selectedFileIds: [] };
      if (legacy) this.database.saveConfiguration(key, policy);

      return policy;
    }

    // File IDs identify relative paths and remain stable across scans. Missing or
    // skipped paths are not eligible for access in the current snapshot.
    const candidates = (stored as PrivacyPolicy).selectedFileIds;
    const storedIds = new Set(
      Array.isArray(candidates)
        ? candidates.filter((id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id))
        : [],
    );
    const policy = validatePolicy(stored, storedIds);

    return { ...policy, selectedFileIds: policy.selectedFileIds.filter((id) => fileIds.has(id)) };
  }
  set(repositoryId: unknown, analysisId: unknown, input: unknown): PrivacyPolicy {
    const graph = this.analysis.getGraph(repositoryId, analysisId);
    const policy = validatePolicy(
      input,
      new Set(graph.nodes.filter((file) => file.status === 'parsed').map((file) => file.id)),
    );
    this.database.saveConfiguration(`privacy:repository:${repositoryId}`, policy);

    return policy;
  }
  preserve(repositoryId: unknown): void {
    const state = this.analysis.getState(repositoryId);
    if (state.status === 'complete' && state.result?.provenance)
      this.get(repositoryId, state.result.provenance.analysisId);
  }
  budget(repositoryId: string, analysisId: string): SourceBudget {
    const policy = this.get(repositoryId, analysisId);

    return new SourceBudget(policy, (fileId) => {
      this.analysis.getGraph(repositoryId, analysisId);
      this.analysis.getFile(repositoryId, fileId);

      return this.database.getSource(analysisId, fileId);
    });
  }
}
