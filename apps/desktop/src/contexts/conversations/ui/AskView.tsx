import { Heading } from '../../../shared/ui';
import { useEffect, useState } from 'react';
import type {
  AiStatus,
  AnalysisSummary,
  AskState,
  GraphSnapshot,
  PrivacyPolicy,
  RecentRepository,
} from '@follo/shared';
import { Inspector } from '../../code-intelligence/ui/Inspector';

export function AskView({
  active: visible,
  onNavigate,
}: {
  active: boolean;
  onNavigate: (section: 'Settings' | 'Code Maps' | 'Search') => void;
}) {
  const [repositories, setRepositories] = useState<RecentRepository[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [summary, setSummary] = useState<AnalysisSummary>();
  const [graph, setGraph] = useState<GraphSnapshot>();
  const [ai, setAi] = useState<AiStatus>();
  const [policy, setPolicy] = useState<PrivacyPolicy>();
  const [question, setQuestion] = useState('');
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<AskState>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    Promise.all([window.engineering!.getRecentRepositories(), window.engineering!.getAiStatus()])
      .then(([repositories, ai]) => {
        if (active) {
          setRepositories(repositories);
          setRepositoryId(repositories[0]?.id ?? '');
          setAi(ai);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSummary(undefined);
    setGraph(undefined);
    setPolicy(undefined);
    setSelected('');
    setError('');
    if (repositoryId)
      void (async () => {
        const state = await window.engineering!.getAnalysisState(repositoryId);
        if (!state.result?.provenance || state.status !== 'complete')
          throw new Error('Analyze this repository first.');
        const [graph, policy] = await Promise.all([
          window.engineering!.getGraph(repositoryId, state.result.provenance.analysisId),
          window.engineering!.getPrivacy(repositoryId, state.result.provenance.analysisId),
        ]);

        if (active) {
          setSummary(state.result);
          setGraph(graph);
          setPolicy(policy);
        }
      })().catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, [repositoryId, visible]);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const state = await window.engineering!.getAskState(jobId);
        if (!active) return;
        setJob(state);
        if (state.status === 'running') timer = setTimeout(() => void poll(), 150);
      } catch (error) {
        if (active) setError(String(error));
      }
    };

    void poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);
  const analysisId = summary?.provenance?.analysisId;
  const running = starting || job?.status === 'running';

  async function ask() {
    if (!analysisId) return;
    setStarting(true);
    setError('');
    setJob(undefined);
    setSelected('');

    try {
      setJobId(await window.engineering!.ask(repositoryId, analysisId, question));
    } catch (error) {
      setError(String(error));
    } finally {
      setStarting(false);
    }
  }

  function answer(text: string) {
    return text.split(/(\[file:[^\]\n]+\]|\[decision:[^\]\n]+\])/).map((part, index) => {
      if (part.startsWith('[file:')) {
        const id = part.slice(6, -1);
        const file = job?.evidence.files.find((file) => file.id === id);

        return file ? (
          <button
            className="inline-file"
            key={index}
            disabled={job?.analysisId !== analysisId}
            onClick={() => setSelected(id)}
          >
            {file.path}
          </button>
        ) : (
          <span key={index}>{part}</span>
        );
      }

      if (part.startsWith('[decision:')) {
        const [id, outcome] = part.slice(10, -1).split('=');

        return (
          <span key={index} className="decision-citation">
            {job?.evidence.decisionIds.includes(id)
              ? `Registered decision ${id.slice(0, 8)}${outcome ? ` · ${outcome}` : ''}`
              : part}
          </span>
        );
      }

      return <span key={index}>{part}</span>;
    });
  }

  return (
    <section aria-label="Ask investigation">
      <div className="map-toolbar">
        <label>
          Repository
          <select
            aria-label="Ask repository"
            value={repositoryId}
            disabled={running}
            onChange={(event) => {
              setJob(undefined);
              setJobId('');
              setRepositoryId(event.target.value);
            }}
          >
            <option value="">Choose a repository</option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        </label>
        <span className="metadata-note">
          {summary?.provenance
            ? `Saved ${new Date(summary.provenance.savedAt).toLocaleString()} · ${policy?.level ?? 'loading permissions'}`
            : 'Choose a saved analysis'}
        </span>
      </div>
      {ai && !ai.llm.verified && (
        <div className="ask-offline">
          <Heading as="h2" variant="section">
            {ai.llm.configured
              ? 'LLM connection needs verification'
              : 'Generative AI is unconfigured'}
          </Heading>
          {ai.llm.configured && (
            <p>
              Your LLM ({ai.llm.model}) is saved. Open Settings → AI and choose Test LLM to enable
              investigations.
            </p>
          )}
          <p>
            Repository analysis works locally. Explore dependencies, dependents, blast radius, paths
            and cycles in the code map, or search saved source.
          </p>
          <div className="map-toolbar">
            {ai.llm.configured && (
              <button className="secondary" onClick={() => onNavigate('Settings')}>
                Verify LLM In Settings
              </button>
            )}
            <button className="secondary" onClick={() => onNavigate('Code Maps')}>
              Explore Code Maps
            </button>
            <button className="secondary" onClick={() => onNavigate('Search')}>
              Search Source
            </button>
          </div>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="ask-question">
          Question
          <textarea
            aria-label="Engineering question"
            value={question}
            maxLength={4000}
            disabled={running}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What depends on this file? How does one module reach another?"
          />
        </label>
        <div className="map-toolbar">
          <button
            className="primary"
            disabled={!analysisId || !ai?.llm.verified || !question.trim() || running}
          >
            Investigate
          </button>
          {running && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void window.engineering!.cancelAsk().catch((error) => setError(String(error)));
              }}
            >
              Cancel Investigation
            </button>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {job && (
        <>
          <p role="status" className="metadata-note">
            {job.status}
            {job.activeTool ? ` · ${job.activeTool}` : ''}
          </p>
          {job.error && (
            <p role="alert" className="error">
              {job.error}
            </p>
          )}
          {analysisId && job.analysisId !== analysisId && (
            <p className="inspection-warnings">
              This investigation belongs to an older analysis. Run a new investigation to inspect
              current saved evidence.
            </p>
          )}
          {job.streamedText && (
            <article className="ask-answer">
              <Heading as="h3" variant="detail">
                Draft explanation — awaiting completion
              </Heading>
              <div className="answer-text">{job.streamedText}</div>
            </article>
          )}
          {job.answer && (
            <article className="ask-answer">
              <Heading as="h3" variant="detail">
                AI explanation
              </Heading>
              <div className="answer-text">{answer(job.answer)}</div>
              <p className="metadata-note">
                Inspect the underlying evidence before relying on an explanation.
              </p>
            </article>
          )}
          {job.evaluation && (
            <article className="ask-answer">
              <Heading as="h3" variant="detail">
                Reference checks
              </Heading>
              <p className="metadata-note">
                Files: {job.evaluation.validFileReferences}/{job.evaluation.fileReferences}{' '}
                supported · Decisions: {job.evaluation.validDecisionReferences}/
                {job.evaluation.decisionReferences} supported
              </p>
              {job.evaluation.unsupported.map((item, index) => (
                <p className="inspection-warnings" key={index}>
                  {item.reference}: {item.reason}
                </p>
              ))}
              {job.evaluation.warnings.map((warning) => (
                <p className="inspection-warnings" key={warning}>
                  {warning}
                </p>
              ))}
              <p className="metadata-note">{job.evaluation.scope}</p>
            </article>
          )}
          {job.observationError && (
            <p className="error" role="alert">
              {job.observationError}
            </p>
          )}
          {!!job.activity.length && (
            <details className="inspector-list" open>
              <summary>Tool and decision activity ({job.activity.length})</summary>
              <div>
                {job.activity.map((item, index) => (
                  <p className="metadata-note" key={index}>
                    {item.name === 'get_decision' ? 'Registered decision' : item.name} ·{' '}
                    {item.status} · {item.latencyMs} ms {item.error && `· ${item.error}`}
                  </p>
                ))}
              </div>
            </details>
          )}
          {!!job.evidence.files.length && (
            <details className="inspector-list" open>
              <summary>Verified file evidence ({job.evidence.files.length})</summary>
              <div>
                {job.evidence.files.map((file) => (
                  <button
                    className="file-link"
                    key={file.id}
                    disabled={job.analysisId !== analysisId}
                    onClick={() => setSelected(file.id)}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            </details>
          )}
          {!!job.evidence.decisionIds.length && (
            <p className="metadata-note">
              Registered decision results: {job.evidence.decisionIds.join(', ')}
            </p>
          )}
          {job.stats && (
            <p className="metadata-note">
              {job.stats.toolCalls} tool calls · {job.stats.toolFailures} failures ·{' '}
              {job.stats.rounds} rounds · {job.stats.latencyMs} ms · Tokens:{' '}
              {job.stats.inputTokens ?? 'unknown'} in / {job.stats.outputTokens ?? 'unknown'} out
            </p>
          )}
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
