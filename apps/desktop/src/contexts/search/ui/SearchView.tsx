import { useEffect, useState } from 'react';
import type {
  RecentRepository,
  AnalysisSummary,
  SearchPage,
  GraphSnapshot,
  ConceptSearchState,
  AiStatus,
} from '@follo/shared';
import { Inspector } from '../../code-intelligence/ui/Inspector';

export function SearchView({ onSettings }: { onSettings: () => void }) {
  const [mode, setMode] = useState('keyword');
  const [ai, setAi] = useState<AiStatus>();
  const [concept, setConcept] = useState<ConceptSearchState>();
  const [jobId, setJobId] = useState('');
  // Incrementing allows submitting the same query again after a failed or cancelled search.
  const [revision, setRevision] = useState(0);
  const [repositories, setRepositories] = useState<RecentRepository[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [summary, setSummary] = useState<AnalysisSummary>();
  const [graph, setGraph] = useState<GraphSnapshot>();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<SearchPage>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void window
      .engineering!.getAiStatus()
      .then(setAi)
      .catch((error) => setError(String(error)));
    let active = true;
    window
      .engineering!.getRecentRepositories()
      .then((items) => {
        if (active) {
          setRepositories(items);
          setRepositoryId(items[0]?.id ?? '');
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setSummary(undefined);
    setGraph(undefined);
    setPage(undefined);
    setSelected('');
    setSubmitted('');
    setError('');
    if (!repositoryId) return;

    void (async () => {
      try {
        const state = await window.engineering!.getAnalysisState(repositoryId);
        if (!state.result?.provenance || state.status !== 'complete')
          throw new Error('Analyze this repository first.');
        const graph = await window.engineering!.getGraph(
          repositoryId,
          state.result.provenance.analysisId,
        );

        if (active) {
          setSummary(state.result);
          setGraph(graph);
        }
      } catch (error) {
        if (active) setError(String(error));
      }
    })();

    return () => {
      active = false;
    };
  }, [repositoryId]);
  const analysisId = summary?.provenance?.analysisId;
  useEffect(() => {
    let active = true;
    let ownedJob = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPage(undefined);
    setConcept(undefined);
    setJobId('');
    setError('');
    setLoading(false);
    if (!submitted || !analysisId) return;
    setLoading(true);

    void (async () => {
      try {
        if (mode === 'keyword') {
          const page = await window.engineering!.searchCode(repositoryId, analysisId, {
            query: submitted,
            offset,
          });

          if (active) {
            setPage(page);
            setLoading(false);
          }

          return;
        }

        ownedJob = await window.engineering!.searchConcept(repositoryId, analysisId, submitted);

        if (!active) {
          await window.engineering!.cancelConceptSearch(ownedJob);

          return;
        }

        setJobId(ownedJob);

        const poll = async () => {
          try {
            const state = await window.engineering!.getConceptSearchState(ownedJob);
            if (!active) return;
            setConcept(state);

            if (state.status === 'running') timer = setTimeout(() => void poll(), 300);
            else {
              setLoading(false);
              setJobId('');
              if (state.error) setError(state.error);
            }
          } catch (error) {
            if (active) {
              setError(String(error));
              setLoading(false);
            }
          }
        };

        await poll();
      } catch (error) {
        if (active) {
          setError(String(error));
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      clearTimeout(timer);
      if (ownedJob) void window.engineering!.cancelConceptSearch(ownedJob).catch(() => {});
    };
  }, [submitted, offset, repositoryId, analysisId, mode, revision]);

  return (
    <section aria-label="Code search">
      <form
        className="map-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected('');
          setOffset(0);
          setSubmitted(query.trim());
          setRevision((value) => value + 1);
        }}
      >
        <label>
          Repository
          <select
            aria-label="Search repository"
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
          >
            <option value="">Choose a repository</option>
            {repositories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search by
          <select
            aria-label="Search mode"
            value={mode}
            onChange={(event) => {
              setSubmitted('');
              setSelected('');
              setMode(event.target.value);
            }}
          >
            <option value="keyword">Keyword</option>
            <option value="concept">Concept · AI</option>
          </select>
        </label>
        <label>
          {mode === 'concept' ? 'Concept' : 'Keywords'}
          <input
            aria-label={mode === 'concept' ? 'Search concept' : 'Search keywords'}
            value={query}
            maxLength={mode === 'concept' ? 1000 : 200}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              mode === 'concept'
                ? 'Where are user permissions checked?'
                : 'commission, authentication…'
            }
          />
        </label>
        <button
          className="primary"
          disabled={
            !analysisId || loading || !query.trim() || (mode === 'concept' && !ai?.llm.verified)
          }
        >
          {mode === 'concept' ? 'Find Related Files' : 'Search Source'}
        </button>
        {loading && jobId && (
          <button
            type="button"
            className="secondary"
            onClick={() => void window.engineering!.cancelConceptSearch(jobId)}
          >
            Cancel
          </button>
        )}
      </form>
      {mode === 'concept' && !ai?.llm.verified && (
        <button className="secondary" onClick={onSettings}>
          Configure And Verify LLM
        </button>
      )}
      {summary && !summary.searchIndexed && (
        <p className="inspection-warnings">
          This snapshot predates search indexing. Analyze the repository again to build its index.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && (
        <p role="status">
          {mode === 'concept'
            ? `Finding related files${concept?.activeTool ? ` · ${concept.activeTool}` : '…'}`
            : 'Searching saved source…'}
        </p>
      )}
      {concept?.result && (
        <>
          <p className="metadata-note">{concept.result.results.length} related files · AI-ranked</p>
          <div className="search-results">
            {concept.result.results.map((item) => (
              <button
                key={item.fileId}
                className="search-result"
                onClick={() => setSelected(item.fileId)}
              >
                <strong>{item.path}</strong>
                <span>{item.reason}</span>
              </button>
            ))}
          </div>
          {!concept.result.results.length && (
            <p>No supported matches. Try describing the behavior differently.</p>
          )}
          {concept.result.limitations.map((text, index) => (
            <p className="metadata-note" key={index}>
              {text}
            </p>
          ))}
        </>
      )}
      {page && (
        <>
          <p className="metadata-note">
            {page.total} matching files · Showing {offset + (page.results.length ? 1 : 0)}–
            {offset + page.results.length}
          </p>
          <div className="search-results">
            {page.results.map((item) => (
              <button
                key={item.fileId}
                className="search-result"
                onClick={() => setSelected(item.fileId)}
              >
                <strong>{item.path}</strong>
                <span>{item.snippet}</span>
              </button>
            ))}
          </div>
          {!page.results.length && (
            <p className="metadata-note">No matching files. Try fewer or different keywords.</p>
          )}
          <div className="parser-pagination">
            <button
              className="secondary"
              disabled={!offset || loading}
              onClick={() => setOffset((value) => value - 50)}
            >
              Previous Results
            </button>
            <button
              className="secondary"
              disabled={offset + 50 >= page.total || loading}
              onClick={() => setOffset((value) => value + 50)}
            >
              Next Results
            </button>
          </div>
        </>
      )}
      {selected && graph && analysisId && (
        <Inspector
          key={`${analysisId}:${selected}`}
          repositoryId={repositoryId}
          analysisId={analysisId}
          fileId={selected}
          graph={graph}
          onSelect={setSelected}
        />
      )}
    </section>
  );
}
