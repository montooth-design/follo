import { SectionCard, SectionHeader, Heading, VerificationBadge } from '../../../shared/ui';
import { useEffect, useState } from 'react';
import { DEFAULT_EXCLUSIONS, type AnalysisState, type ParsedFile } from '@follo/shared';
import { TechStack } from './TechStack';
import { RepositoryHighlights } from './RepositoryHighlights';
import { RepositorySummary } from './RepositorySummary';
import { ReadmeDraft } from './ReadmeDraft';
import { PrivacySettings } from './PrivacySettings';

const idle: AnalysisState = { status: 'idle', progress: null, result: null, error: null };

export function AnalysisPanel({
  repositoryId,
  onBusyChange,
  active = true,
  onReady,
}: {
  repositoryId: string;
  active?: boolean;
  onBusyChange: (busy: boolean) => void;
  onReady?: (repositoryId: string) => void;
}) {
  const [analysis, setAnalysis] = useState<AnalysisState>(idle);
  const [exclusions, setExclusions] = useState(DEFAULT_EXCLUSIONS.join(', '));
  const [revision, setRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [file, setFile] = useState<ParsedFile>();
  const [loadingFile, setLoadingFile] = useState(false);
  const [importPage, setImportPage] = useState(0);
  useEffect(() => {
    setAnalysis(idle);
    setFile(undefined);
    setPage(0);
    setError('');
  }, [repositoryId]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Parsing runs in a worker. Poll its saved state while running, then stop.
    // The active flag prevents a response for the previous repository updating this view.

    async function poll() {
      try {
        const result = await window.engineering!.getAnalysisState(repositoryId);
        if (!active) return;
        setAnalysis(result);
        onBusyChange(result.status === 'running');
        onReady?.(repositoryId);
        if (result.status === 'running') timer = setTimeout(() => void poll(), 500);
      } catch (error) {
        if (active) {
          setError(String(error));
          onBusyChange(false);
          onReady?.(repositoryId);
        }
      }
    }

    void poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repositoryId, revision, onBusyChange, onReady]);

  async function analyze() {
    setError('');
    setStarting(true);
    onBusyChange(true);

    try {
      await window.engineering!.analyzeRepository(repositoryId, {
        exclusions: exclusions
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setFile(undefined);
      setPage(0);
      setAnalysis({ ...idle, status: 'running' });
      setRevision((value) => value + 1);
    } catch (error) {
      setError(String(error));
      onBusyChange(false);
    } finally {
      setStarting(false);
    }
  }

  async function inspectFile(id: string) {
    setLoadingFile(true);
    setError('');

    try {
      setFile(await window.engineering!.getParsedFile(repositoryId, id));
      setImportPage(0);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoadingFile(false);
    }
  }

  const running = starting || analysis.status === 'running';
  const result = analysis.result;
  const candidates =
    result?.files.filter(
      (file) =>
        file.path.toLowerCase().includes(filter.toLowerCase()) &&
        (!reviewOnly || file.reviewCount > 0 || file.diagnosticCount > 0),
    ) ?? [];
  const visible = candidates.slice(page * 100, (page + 1) * 100);

  return (
    <section className="parser-panel" aria-label="Parser analysis">
      <SectionCard variant="repository">
        <SectionHeader title="Source analysis">
          <span>TS-Morph · Local only</span>
        </SectionHeader>
        <label className="exclusion-label">
          Excluded directory names
          <input
            value={exclusions}
            disabled={running}
            onChange={(event) => setExclusions(event.target.value)}
            placeholder="node_modules, dist, build…"
          />
        </label>
        <div className="analysis-next">
          <button className="primary" disabled={running} onClick={() => void analyze()}>
            {running ? 'Analyzing…' : 'Analyze Repository'}
          </button>
          {analysis.status === 'complete' && (
            <VerificationBadge state="verified" className="analysis-completed">
              Completed
            </VerificationBadge>
          )}
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {analysis.error && (
          <div role="alert" className="error">
            {analysis.error}
          </div>
        )}
        {analysis.progress && analysis.status !== 'complete' && (
          <div role="status" className="parser-progress">
            <span className="tag">{analysis.progress.stage.toUpperCase()}</span>
            <span>{analysis.progress.message}</span>
            {analysis.status === 'running' && analysis.progress.total !== null && (
              <progress
                value={analysis.progress.completed}
                max={Math.max(analysis.progress.total, 1)}
              />
            )}
          </div>
        )}
      </SectionCard>
      <PrivacySettings repositoryId={repositoryId} snapshot={result} active={active} />
      {result && (
        <>
          {result.provenance && (
            <ReadmeDraft
              key={`${repositoryId}:${result.provenance.analysisId}`}
              repositoryId={repositoryId}
              analysisId={result.provenance.analysisId}
              active={active}
            />
          )}
          {result.provenance && (
            <RepositorySummary
              active={active}
              repositoryId={repositoryId}
              analysisId={result.provenance.analysisId}
              onInspect={(id) => {
                void inspectFile(id).then(() =>
                  requestAnimationFrame(() =>
                    document
                      .querySelector('.parsed-file')
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                  ),
                );
              }}
            />
          )}
          <SectionCard variant="repository">
            <RepositoryHighlights
              key={result.provenance?.analysisId ?? result.completedAt}
              analysis={result}
              busy={loadingFile || running}
              onInspect={(id) => {
                void inspectFile(id).then(() =>
                  requestAnimationFrame(() =>
                    document
                      .querySelector('.parsed-file')
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                  ),
                );
              }}
            />
          </SectionCard>
          {result.techStack && (
            <SectionCard variant="repository">
              <TechStack stack={result.techStack} />
            </SectionCard>
          )}
          <SectionCard variant="repository">
            <Heading as="h3" variant="section">
              Analysis coverage
            </Heading>
            {!result.coverage.discoveryComplete && (
              <div className="inspection-warnings">
                Discovery is incomplete. Counts cover only the discovered portion of this
                repository.
              </div>
            )}
            <dl className="coverage-grid">
              {(
                [
                  ['Files discovered', result.coverage.filesDiscovered],
                  ['Files parsed', result.coverage.filesParsed],
                  ['Files skipped', result.coverage.filesSkipped],
                  ['Files with syntax errors', result.coverage.filesWithSyntaxErrors],
                  ['Imports discovered', result.coverage.importsDiscovered],
                  ['Internal resolved', result.coverage.internalResolved],
                  ['External', result.coverage.external],
                  ['Skipped imports', result.coverage.skipped],
                  ['Unresolved', result.coverage.unresolved],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
          <SectionCard variant="repository">
            <SectionHeader title="Dependency graph">
              <span>Verified internal imports</span>
            </SectionHeader>
            <dl className="coverage-grid">
              {(
                [
                  ['Graph files', result.graph.nodeCount],
                  ['Unique dependency edges', result.graph.edgeCount],
                  ['Cycle groups', result.graph.cycleGroupCount],
                  ['Files in cycles', result.graph.cyclicFileCount],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
          {result.warnings.length > 0 && (
            <details className="inspection-warnings">
              <summary>Analysis notes ({result.warnings.length})</summary>
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <SectionCard variant="repository">
            <Heading as="h3" variant="section">
              Source files
            </Heading>
            <div className="parser-filter">
              <input
                aria-label="Filter parsed files"
                placeholder="Filter files by path…"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
              />
              <label>
                <input
                  type="checkbox"
                  checked={reviewOnly}
                  onChange={(event) => {
                    setReviewOnly(event.target.checked);
                    setPage(0);
                  }}
                />{' '}
                Needs review
              </label>
            </div>
            <div className="parser-files">
              {visible.map((item) => (
                <button
                  key={item.id}
                  disabled={loadingFile || running}
                  className={file?.id === item.id ? 'selected' : ''}
                  onClick={() => void inspectFile(item.id)}
                >
                  <span>{item.path}</span>
                  <small>
                    {item.status} · {item.importCount} imports
                    {item.reviewCount || item.diagnosticCount ? ' · needs review' : ''}
                  </small>
                </button>
              ))}
            </div>
            {!visible.length && <p className="metadata-note">No files match this view.</p>}
            <div className="parser-pagination">
              <span>{candidates.length.toLocaleString()} files · up to 100 per page</span>
              <button
                className="secondary"
                disabled={!page}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <button
                className="secondary"
                disabled={(page + 1) * 100 >= candidates.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </SectionCard>
          {file && (
            <SectionCard variant="repository" as="article" className="parsed-file">
              <Heading as="h3" variant="section">
                {file.path}
              </Heading>
              <p className="metadata-note">
                {file.status} · {file.linesOfCode ?? 'Unknown'} LOC · SHA-256:{' '}
                {file.hash ?? 'Unavailable'}
              </p>
              {file.diagnostics.length > 0 && (
                <ul className="inspection-warnings">
                  {file.diagnostics.map((diagnostic, index) => (
                    <li key={index}>
                      {diagnostic.line ? `Line ${diagnostic.line}: ` : ''}
                      {diagnostic.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="import-table">
                {file.imports.slice(importPage * 200, (importPage + 1) * 200).map((item, index) => (
                  <div key={index}>
                    <span>
                      Line {item.line} · {item.kind}
                      <strong>{item.specifier ?? '[computed expression]'}</strong>
                    </span>
                    <span className={`import-status ${item.resolution.status}`}>
                      {item.resolution.status}
                    </span>
                    <span>
                      {item.resolution.status === 'resolved'
                        ? item.resolution.targetPath
                        : item.resolution.status === 'external'
                          ? item.resolution.packageName
                          : item.resolution.reason}
                    </span>
                  </div>
                ))}
              </div>
              {file.imports.length > 200 && (
                <div className="parser-pagination">
                  <span>{file.imports.length} imports · 200 per page</span>
                  <button
                    className="secondary"
                    disabled={!importPage}
                    onClick={() => setImportPage((value) => value - 1)}
                  >
                    Previous Imports
                  </button>
                  <button
                    className="secondary"
                    disabled={(importPage + 1) * 200 >= file.imports.length}
                    onClick={() => setImportPage((value) => value + 1)}
                  >
                    Next Imports
                  </button>
                </div>
              )}
              {!file.imports.length && (
                <p className="metadata-note">No imports were found in this file.</p>
              )}
            </SectionCard>
          )}
        </>
      )}
    </section>
  );
}
