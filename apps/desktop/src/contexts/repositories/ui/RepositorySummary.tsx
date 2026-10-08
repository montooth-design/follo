import { SectionHeader, Heading } from '../../../shared/ui';
import { useEffect, useState } from 'react';
import type {
  AiStatus,
  RepositorySummary as SavedSummary,
  RepositorySummaryState,
  SummaryFinding,
} from '@follo/shared';

export function RepositorySummary({
  repositoryId,
  analysisId,
  onInspect,
  active: visible = true,
}: {
  active?: boolean;
  repositoryId: string;
  analysisId: string;
  onInspect: (id: string) => void;
}) {
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const [ai, setAi] = useState<AiStatus>();
  const [job, setJob] = useState<RepositorySummaryState>();
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    Promise.all([
      window.engineering!.getRepositorySummary(repositoryId),
      window.engineering!.getAiStatus(),
    ])
      .then(([summary, ai]) => {
        if (active) {
          setSummary(summary);
          setAi(ai);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, [repositoryId, analysisId, visible]);
  useEffect(() => {
    setSummary(null);
    setJob(undefined);
    setJobId('');
    setError('');
  }, [repositoryId, analysisId]);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const state = await window.engineering!.getRepositorySummaryState(jobId);
        if (!active) return;
        setJob(state);
        if (state.result) setSummary(state.result);
        if (state.status === 'running') timer = setTimeout(() => void poll(), 200);
      } catch (error) {
        if (active) setError(String(error));
      }
    }

    void poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  async function generate() {
    setStarting(true);
    setError('');

    try {
      setJobId(await window.engineering!.generateRepositorySummary(repositoryId, analysisId));
    } catch (error) {
      setError(String(error));
    } finally {
      setStarting(false);
    }
  }

  const running = starting || job?.status === 'running';
  const stale = !!summary && summary.analysisId !== analysisId;

  function finding(item: SummaryFinding) {
    return (
      <>
        <p>{item.text.replace(/\s*\[file:[^\]\n]+\]/g, '')}</p>
        <div className="summary-evidence">
          {item.inferred && <span className="summary-inference">Inference</span>}
          {item.fileIds.map((id) => (
            <button
              className="file-link"
              key={id}
              disabled={stale || running}
              onClick={() => onInspect(id)}
            >
              {summary?.evidence.find((file) => file.id === id)?.path ?? id}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <section className="repository-product-summary" aria-label="Repository Summary">
      <SectionHeader title="Repository Summary" />
      <div className="map-toolbar">
        <button
          className="primary"
          disabled={running || !ai?.llm.verified}
          onClick={() => void generate()}
        >
          {running
            ? 'Generating Summary…'
            : summary
              ? 'Regenerate Repository Summary'
              : 'Generate Repository Summary'}
        </button>
        {running && (
          <button
            className="secondary"
            onClick={() => {
              void window
                .engineering!.cancelRepositorySummary()
                .catch((error) => setError(String(error)));
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {!ai?.llm.verified && (
        <p className="metadata-note">
          {ai?.llm.configured
            ? 'Verify your LLM in Settings → AI to generate a summary.'
            : 'Configure and test an LLM in Settings → AI to generate a summary.'}
        </p>
      )}
      {!summary && <p className="metadata-note">Purpose, core features and workflow.</p>}
      {running && (
        <p role="status" className="metadata-note">
          {job?.activeTool
            ? `Inspecting evidence · ${job.activeTool}`
            : 'Gathering evidence and writing the summary…'}
        </p>
      )}
      {(error || job?.error) && (
        <p className="error" role="alert">
          {error || job?.error}
        </p>
      )}
      {summary && (
        <>
          {stale && (
            <div className="summary-provenance">
              <span>Outdated · Scan changed</span>
            </div>
          )}
          {stale && (
            <p className="inspection-warnings">
              This summary belongs to an earlier scan. Regenerate it to use the current files.
            </p>
          )}
          <div className="summary-purpose">
            <Heading as="h4" variant="detail">
              Purpose & value
            </Heading>
            {finding(summary.purpose)}
          </div>
          <Heading as="h4" variant="detail">
            Core features
          </Heading>
          <div className="summary-feature-grid">
            {summary.features.map((feature, index) => (
              <article key={index}>{finding(feature)}</article>
            ))}
          </div>
          {!summary.features.length && (
            <p className="metadata-note">Insufficient evidence to identify core features.</p>
          )}
          <div className="summary-workflow">
            <Heading as="h4" variant="detail">
              Typical workflow
            </Heading>
            {finding(summary.workflow)}
          </div>
          {!!summary.limitations.length && (
            <details className="summary-limitations" open>
              <summary>Evidence & limitations</summary>
              <ul>
                {summary.limitations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
