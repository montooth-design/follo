import { Heading, SectionCard, SectionHeader, ViewHeader } from '../../../shared/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecentRepository, Repository } from '@follo/shared';
import { AnalysisPanel } from './AnalysisPanel';
import { ArrowRight, Folder, LoaderCircle } from 'lucide-react';
import { VIEW_COPY } from '../../../renderer/view-copy';

function menuOrder(items: RecentRepository[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

export function RepositoriesView({
  ready,
  active = true,
  requested,
  onRepositories,
  onSelected,
}: {
  ready: boolean;
  active?: boolean;
  requested?: { id: string; revision: number; focusPermissions?: boolean };
  onRepositories: (items: RecentRepository[]) => void;
  onSelected: (repository: Repository) => void;
}) {
  const [recent, setRecent] = useState<RecentRepository[]>([]);
  const [selected, setSelected] = useState<Repository>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [handledRequest, setHandledRequest] = useState<number>();
  const [loadedRepository, setLoadedRepository] = useState<string>();
  const onAnalysisReady = useCallback((id: string) => setLoadedRepository(id), []);
  const openedRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    let active = true;
    window.engineering
      ?.getRecentRepositories()
      .then((result) => {
        if (active) {
          const items = menuOrder(result);
          setRecent(items);
          onRepositories(items);
          setHistoryLoaded(true);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, [onRepositories]);
  useEffect(() => {
    if (!requested?.id || busy || analyzing || openedRequest.current === requested.revision) return;
    openedRequest.current = requested.revision;
    void open(requested.id).then((repository) => {
      setHandledRequest(requested.revision);
      if (repository && requested.focusPermissions)
        requestAnimationFrame(() =>
          document
            .querySelector(
              '[aria-label="Selected repository"] [aria-label="Source Permissions settings"]',
            )
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        );
    });
  }, [requested, busy, analyzing]);

  async function open(id?: string) {
    const bridge = window.engineering;
    if (!bridge || busy || analyzing) return;
    setBusy(true);
    setError('');

    try {
      const repository = id ? await bridge.reopenRepository(id) : await bridge.openRepository();

      if (repository) {
        setSelected(repository);
        onSelected(repository);
        const items = menuOrder(await bridge.getRecentRepositories());
        setRecent(items);
        onRepositories(items);
      }

      return repository;
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  const gitLabels = {
    repository: 'Yes',
    'not-repository': 'No',
    unavailable: 'Git unavailable',
    error: 'Unknown',
  };
  const fileCount = (count: number) =>
    `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`;
  const loading =
    busy ||
    (!!requested && handledRequest !== requested.revision) ||
    (!!selected && loadedRepository !== selected.id);

  return (
    <div className="repository-layout">
      <ViewHeader
        title={selected?.name ?? VIEW_COPY.Repositories.heading}
        actions={
          recent.length > 0 && (
            <button
              className="primary repository-header-choose"
              onClick={() => void open()}
              disabled={busy || analyzing || !ready}
            >
              {busy ? 'Opening…' : 'Open New Repository'}
            </button>
          )
        }
      />
      {loading && (
        <div className="repository-loading" role="status" aria-live="polite">
          <LoaderCircle className="loading-spinner" aria-hidden="true" />
          <strong>Loading repository…</strong>
          <span>Reading repository details and saved analysis.</span>
        </div>
      )}
      <div className="repository-content" hidden={loading}>
        {selected ? (
          <>
            <div className="repository-path">{selected.path}</div>
            <p className="metadata-note">
              Inspected {new Date(selected.inspectedAt).toLocaleString()} · Counts exclude
              node_modules, dist, build, coverage, .git, and .next.
            </p>
          </>
        ) : (
          <p className="subtitle">{VIEW_COPY.Repositories.subheading}</p>
        )}
        {historyLoaded && !recent.length && (
          <section className="repository-picker">
            <span className="tag">OPEN REPOSITORY</span>
            <Heading as="h2" variant="section">
              Start with your source.
            </Heading>
            <p className="muted">
              Choose an existing checkout or source folder. Follo inspects it locally and does not
              modify it.
            </p>
            <button
              className="primary"
              onClick={() => void open()}
              disabled={busy || analyzing || !ready}
            >
              {busy ? 'Opening / Inspecting…' : 'Open New Repository'} <ArrowRight />
            </button>
            <p className="picker-note">No account or Git authentication required.</p>
          </section>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {busy && (
          <p role="status" className="muted">
            Waiting for folder selection or inspecting source files and Git metadata…
          </p>
        )}
        {selected && (
          <section className="repository-details" aria-label="Selected repository">
            <SectionCard variant="repository">
              <SectionHeader
                title="Repository details"
                headingLevel="h2"
                className="repository-title"
              >
                <span className="tag">READ ONLY</span>
              </SectionHeader>
              <dl className="metadata-grid">
                <div>
                  <dt>Git repository</dt>
                  <dd>{gitLabels[selected.git.status]}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>{selected.git.detached ? 'Detached HEAD' : (selected.git.branch ?? '—')}</dd>
                </div>
                <div>
                  <dt>Commit</dt>
                  <dd title={selected.git.commit ?? undefined}>
                    {selected.git.commit?.slice(0, 12) ??
                      (selected.git.status === 'repository' ? 'No commit available' : '—')}
                  </dd>
                </div>
                <div>
                  <dt>Working tree</dt>
                  <dd>
                    {selected.git.status !== 'repository'
                      ? '—'
                      : { clean: 'Clean', modified: 'Modified', unknown: 'Unknown' }[
                          selected.git.workingTree
                        ]}
                  </dd>
                </div>
                <div>
                  <dt>TypeScript / TSX</dt>
                  <dd>
                    {selected.project.typescriptFiles
                      ? fileCount(selected.project.typescriptFiles)
                      : selected.project.scanComplete
                        ? 'No files found'
                        : 'Unknown (partial scan)'}
                  </dd>
                </div>
                <div>
                  <dt>JavaScript / JSX</dt>
                  <dd>
                    {selected.project.javascriptFiles
                      ? fileCount(selected.project.javascriptFiles)
                      : selected.project.scanComplete
                        ? 'No files found'
                        : 'Unknown (partial scan)'}
                  </dd>
                </div>
                <div>
                  <dt>package.json</dt>
                  <dd>{selected.project.packageJson ? 'Present' : 'Not found at folder root'}</dd>
                </div>
                <div>
                  <dt>tsconfig.json</dt>
                  <dd>{selected.project.tsconfigJson ? 'Present' : 'Not found at folder root'}</dd>
                </div>
                <div>
                  <dt>jsconfig.json</dt>
                  <dd>{selected.project.jsconfigJson ? 'Present' : 'Not found at folder root'}</dd>
                </div>
                <div>
                  <dt>Source files</dt>
                  <dd>
                    {selected.project.scanComplete ? '' : 'At least '}
                    {selected.project.sourceFiles.toLocaleString()}
                  </dd>
                </div>
              </dl>
              {selected.warnings.length > 0 && (
                <div className="inspection-warnings">
                  <Heading as="h3" variant="detail">
                    Inspection notes
                  </Heading>
                  <ul>
                    {selected.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!selected.project.sourceFiles && selected.project.scanComplete && (
                <p className="metadata-note">
                  No supported .ts, .tsx, .js, or .jsx files were found in this folder.
                </p>
              )}
              <div className="analysis-next">
                <span>Metadata reflects the last inspection.</span>
                <button
                  className="secondary"
                  disabled={busy || analyzing}
                  onClick={() => void open(selected.id)}
                >
                  Refresh Metadata
                </button>
              </div>
            </SectionCard>
            <AnalysisPanel
              key={selected.id}
              repositoryId={selected.id}
              active={active}
              onBusyChange={setAnalyzing}
              onReady={onAnalysisReady}
            />
          </section>
        )}
        <section className="recent-repositories" aria-label="Repositories">
          {recent.length ? (
            <div className="recent-list">
              {recent.map((repository) => (
                <button
                  key={repository.id}
                  className={`recent-repository${selected?.id === repository.id ? ' selected' : ''}`}
                  disabled={busy || analyzing || !ready}
                  onClick={() => void open(repository.id)}
                >
                  <span className="recent-icon">
                    <Folder />
                  </span>
                  <span className="recent-info">
                    <strong>{repository.name}</strong>
                    <small>{repository.path}</small>
                  </span>
                  <span className="recent-date">
                    {new Date(repository.lastOpenedAt).toLocaleDateString()}
                  </span>
                  <ArrowRight />
                </button>
              ))}
            </div>
          ) : (
            <p className="recent-empty">
              Opened folders will appear here. Selecting one refreshes its metadata.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
