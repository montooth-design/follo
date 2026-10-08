import { Heading } from '../../../shared/ui';
import { useEffect, useRef, useState } from 'react';
import {
  EditorView,
  lineNumbers,
  drawSelection,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
} from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
} from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { Code, Sparkles, X } from 'lucide-react';
import type { AiStatus, AskState, PrivacyPolicy, SnapshotSource } from '@follo/shared';

type Lines = { startLine: number; endLine: number };

function SourceViewer({
  source,
  nonce,
  onSelection,
  reveal,
  clearSelection,
}: {
  source: SnapshotSource;
  nonce: string;
  onSelection: (lines: Lines | null) => void;
  reveal: Lines | null;
  clearSelection: number;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const selectionCallback = useRef(onSelection);
  selectionCallback.current = onSelection;
  useEffect(() => {
    if (!parent.current || source.content === null) return;
    const theme = new Compartment();
    const dark = () => document.documentElement.dataset.theme !== 'light';
    const view = new EditorView({
      parent: parent.current,
      doc: source.content,
      extensions: [
        lineNumbers(),
        drawSelection(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        bracketMatching(),
        foldGutter(),
        keymap.of(defaultKeymap),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorState.readOnly.of(true),
        EditorState.transactionFilter.of((transaction) =>
          transaction.docChanged ? [] : transaction,
        ),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: '0',
          'aria-label': `Saved code for ${source.path}`,
          'aria-readonly': 'true',
        }),
        EditorView.cspNonce.of(nonce),
        javascript({
          typescript: source.language === 'typescript' || source.language === 'tsx',
          jsx: source.language === 'tsx' || source.language === 'jsx',
        }),
        theme.of(dark() ? oneDark : []),
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet) return;
          const range = update.state.selection.main;
          selectionCallback.current(
            range.empty
              ? null
              : {
                  startLine: update.state.doc.lineAt(range.from).number,
                  endLine: update.state.doc.lineAt(Math.max(range.from, range.to - 1)).number,
                },
          );
        }),
      ],
    });
    editor.current = view;
    const observer = new MutationObserver(() =>
      view.dispatch({ effects: theme.reconfigure(dark() ? oneDark : []) }),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      observer.disconnect();
      view.destroy();
      editor.current = null;
    };
  }, [source, nonce]);
  useEffect(() => {
    const view = editor.current;
    if (!view || !reveal || reveal.startLine < 1 || reveal.endLine > view.state.doc.lines) return;
    view.dispatch({
      selection: {
        anchor: view.state.doc.line(reveal.startLine).from,
        head: view.state.doc.line(reveal.endLine).to,
      },
      scrollIntoView: true,
    });
    view.focus();
  }, [reveal]);
  useEffect(() => {
    const view = editor.current;
    if (view && clearSelection)
      view.dispatch({ selection: { anchor: view.state.selection.main.head } });
  }, [clearSelection]);

  return <div className="source-viewer" ref={parent} />;
}

export function CodeExplorer({
  repositoryId,
  analysisId,
  fileId,
  onSettings,
  onSourceSettings,
}: {
  repositoryId: string;
  analysisId: string;
  fileId: string;
  onSettings: () => void;
  onSourceSettings: () => void;
}) {
  const [source, setSource] = useState<SnapshotSource>();
  const [ai, setAi] = useState<AiStatus>();
  const [policy, setPolicy] = useState<PrivacyPolicy>();
  const [nonce, setNonce] = useState('');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Lines | null>(null);
  const [reveal, setReveal] = useState<Lines | null>(null);
  const [clearSelection, setClearSelection] = useState(0);
  const [question, setQuestion] = useState('');
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<AskState>();
  const [explained, setExplained] = useState<Lines>();
  const ownedJob = useRef('');
  const mounted = useRef(false);
  useEffect(() => {
    let current = true;
    mounted.current = true;
    if (fileId)
      Promise.all([
        window.engineering!.getFileSource(repositoryId, analysisId, fileId),
        window.engineering!.getAiStatus(),
        window.engineering!.getPrivacy(repositoryId, analysisId),
        window.engineering!.getStatus(),
      ])
        .then(([source, ai, policy, status]) => {
          if (current) {
            setSource(source);
            setAi(ai);
            setPolicy(policy);
            setNonce(status.styleNonce ?? '');
          }
        })
        .catch((error) => {
          if (current) setError(String(error));
        });

    return () => {
      current = false;
      mounted.current = false;
      if (ownedJob.current)
        void window.engineering!.cancelCodeExplanation(ownedJob.current).catch(() => {});
    };
  }, [repositoryId, analysisId, fileId]);
  useEffect(() => {
    if (!jobId) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const state = await window.engineering!.getCodeExplanationState(jobId);
        if (!current) return;
        setJob(state);
        if (state.status === 'running') timer = setTimeout(() => void poll(), 150);
      } catch (error) {
        if (current) setError(String(error));
      }
    }

    void poll();

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [jobId]);
  const running = starting || job?.status === 'running';
  const range = selection ?? { startLine: 1, endLine: Math.min(source?.lineCount ?? 1, 200) };
  const permitted =
    policy?.level === 'full-file' ||
    (policy?.level === 'selected-source' && policy.selectedFileIds.includes(fileId));

  async function explain() {
    if (!source || source.content === null) return;
    setStarting(true);
    setError('');
    setJob(undefined);
    setJobId('');
    setExplained(range);

    try {
      const id = await window.engineering!.explainCode(repositoryId, analysisId, {
        fileId,
        ...range,
        question,
      });

      if (!mounted.current) {
        void window.engineering!.cancelCodeExplanation(id).catch(() => {});

        return;
      }

      ownedJob.current = id;
      setJobId(id);
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  function explanation(text: string) {
    return text.split(/(\[file:[^\]\n]+\]|\[lines:\d+-\d+\])/).map((part, index) => {
      if (part.startsWith('[file:')) {
        const evidence = job?.evidence.files.find((item) => item.id === part.slice(6, -1));

        return evidence ? (
          <span className="code-file-citation" key={index}>
            {evidence.path}
          </span>
        ) : (
          <span key={index}>{part}</span>
        );
      }

      const match = part.match(/^\[lines:(\d+)-(\d+)\]$/);

      if (match && explained) {
        const startLine = Number(match[1]);
        const endLine = Number(match[2]);
        if (
          startLine >= explained.startLine &&
          endLine >= startLine &&
          endLine <= explained.endLine
        )
          return (
            <button
              className="inline-file"
              key={index}
              onClick={() => setReveal({ startLine, endLine })}
            >
              Lines {startLine}–{endLine}
            </button>
          );
      }

      return <span key={index}>{part}</span>;
    });
  }

  return (
    <section className="code-explorer" aria-label="Code and explanation">
      <article className="code-source-panel">
        <div className="code-panel-heading">
          <Heading as="h3" variant="detail">
            <Code />
            Code
          </Heading>
          {source && <span className="tag">{source.language} · Saved scan</span>}
        </div>
        {source && <div className="code-file-path">{source.path}</div>}
        {!fileId ? (
          <p className="code-empty">Click a file in the map to view its code.</p>
        ) : !source && !error ? (
          <p className="code-empty" role="status">
            Loading saved code…
          </p>
        ) : source?.content === null ? (
          <p className="code-empty">
            Source is unavailable for this file in the saved scan. Reanalyze the repository or
            choose another file.
          </p>
        ) : (
          source && (
            <SourceViewer
              source={source}
              nonce={nonce}
              onSelection={setSelection}
              reveal={reveal}
              clearSelection={clearSelection}
            />
          )
        )}
        {source?.content !== null && source && (
          <div className="code-selection-status">
            <span>
              {selection
                ? `Selected lines ${selection.startLine}–${selection.endLine}`
                : `${source.lineCount} lines · Select code to explain a section`}
            </span>
            {selection && (
              <button
                className="secondary"
                aria-label="Clear Code Selection"
                onClick={() => {
                  setSelection(null);
                  setReveal(null);
                  setClearSelection((value) => value + 1);
                }}
              >
                <X />
                Clear Selection
              </button>
            )}
          </div>
        )}
      </article>
      <aside className="code-explanation-panel" aria-label="Code explanation">
        <div className="code-panel-heading">
          <Heading as="h3" variant="detail">
            <Sparkles />
            Explanation
          </Heading>
          <span className="tag">AI</span>
        </div>
        {fileId && source?.content !== null && (
          <>
            <label className="code-question">
              Ask about this code
              <textarea
                aria-label="Code explanation question"
                value={question}
                maxLength={1000}
                disabled={running}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Optional: What happens when this function runs?"
              />
            </label>
            <div className="code-explain-actions">
              <button
                className="primary"
                disabled={
                  !source ||
                  !ai?.llm.verified ||
                  !permitted ||
                  running ||
                  range.endLine - range.startLine >= 200
                }
                onClick={() => void explain()}
              >
                <Sparkles />
                {running
                  ? 'Explaining…'
                  : selection
                    ? 'Explain Selection'
                    : source && source.lineCount > 200
                      ? 'Explain First 200 Lines'
                      : 'Explain File'}
              </button>
              {running && (
                <button
                  className="secondary"
                  onClick={() => {
                    if (jobId)
                      void window
                        .engineering!.cancelCodeExplanation(jobId)
                        .catch((error) => setError(String(error)));
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            {selection && range.endLine - range.startLine >= 200 && (
              <p className="metadata-note">Select up to 200 lines for an explanation.</p>
            )}
            {policy && !permitted && (
              <p className="metadata-note">
                {policy.level === 'graph-only'
                  ? 'Enable source access to explain code.'
                  : 'Allow this file in Selected Source permissions.'}{' '}
                <button className="inline-file" onClick={onSourceSettings}>
                  Source Settings
                </button>
              </p>
            )}
            {ai && !ai.llm.verified && (
              <p className="metadata-note">
                Configure and verify an LLM to explain code.{' '}
                <button className="inline-file" onClick={onSettings}>
                  AI Settings
                </button>
              </p>
            )}
          </>
        )}
        {!fileId && (
          <p className="code-empty">Choose a file, then select code or explain the file.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {job?.error && (
          <p className="error" role="alert">
            {job.error}
          </p>
        )}
        {job && (
          <p className="metadata-note" role="status">
            {job.status}
            {explained ? ` · Lines ${explained.startLine}–${explained.endLine}` : ''}
            {job.activeTool ? ` · ${job.activeTool}` : ''}
          </p>
        )}
        {job?.streamedText && (
          <div className="code-answer draft">
            <span className="tag">DRAFT</span>
            <div>{job.streamedText}</div>
          </div>
        )}
        {job?.answer && <div className="code-answer">{explanation(job.answer)}</div>}
        {!!job?.evaluation?.unsupported.length && (
          <p className="inspection-warnings">
            Some file references could not be verified. Check the code before relying on this
            explanation.
          </p>
        )}
      </aside>
    </section>
  );
}
