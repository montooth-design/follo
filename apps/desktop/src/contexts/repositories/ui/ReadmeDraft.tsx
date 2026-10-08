import { useEffect, useRef, useState } from 'react';
import type { AskState, ReadmeEvidence } from '@follo/shared';
import { SectionCard, SectionHeader } from '../../../shared/ui';
import { ChevronRight, FileText } from 'lucide-react';

export function ReadmeDraft({
  repositoryId,
  analysisId,
  active,
}: {
  repositoryId: string;
  analysisId: string;
  active: boolean;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);
  const [evidence, setEvidence] = useState<ReadmeEvidence>();
  const [approved, setApproved] = useState(false);
  const [verified, setVerified] = useState(false);
  const [content, setContent] = useState('');
  const [job, setJob] = useState<AskState>();
  const [jobId, setJobId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    void window
      .engineering!.getAiStatus()
      .then((status) => {
        if (mounted) setVerified(status.llm.verified);
      })
      .catch((error) => {
        if (mounted) setError(String(error));
      });

    return () => {
      mounted = false;
    };
  }, [active]);
  useEffect(() => {
    setEvidence(undefined);
    setApproved(false);
    setContent('');
    setJob(undefined);
    setJobId('');
    setError('');
    setNotice('');
  }, [repositoryId, analysisId]);
  useEffect(() => {
    if (!jobId) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const state = await window.engineering!.getReadmeState(jobId);
        if (!mounted) return;
        setJob(state);
        if (state.status === 'complete') {
          setContent(state.answer);
          setNotice('Draft ready for review. Commands have not been executed.');
        } else if (state.status === 'running') timer = setTimeout(() => void poll(), 250);
        else setError(state.error ?? 'Generation cancelled.');
      } catch (error) {
        if (mounted) setError(String(error));
      }
    };

    void poll();

    return () => {
      mounted = false;
      clearTimeout(timer);
      void window.engineering!.cancelReadme(jobId).catch(() => {});
    };
  }, [jobId]);
  const running = busy || job?.status === 'running';

  async function review() {
    setBusy(true);
    setReading(true);
    setEvidence(undefined);
    setError('');
    setApproved(false);
    setNotice('');

    try {
      setEvidence(await window.engineering!.getReadmeEvidence(repositoryId, analysisId));
    } catch (error) {
      setError(String(error));
    } finally {
      setReading(false);
      setBusy(false);
    }
  }

  async function generate() {
    if (!approved || !evidence) return;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const id = await window.engineering!.generateReadme(repositoryId, analysisId, evidence.id);

      if (!mounted.current) {
        await window.engineering!.cancelReadme(id);

        return;
      }

      setJob(undefined);
      setJobId(id);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save(exportFile: boolean) {
    setBusy(true);
    setError('');

    try {
      const filename = exportFile
        ? await window.engineering!.exportReadme(content)
        : await window.engineering!.saveReadmeDraft(repositoryId, analysisId, content);
      if (filename) setNotice(`Saved ${filename}`);
    } catch {
      setError(
        'Could not save. Existing files are never overwritten; export to a new filename if README.follo.md already exists.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard variant="repository" aria-label="README draft">
      <SectionHeader title="README draft" />
      <p className="metadata-note">
        If your project doesn’t have a README yet, you can generate one from its setup files and
        saved analysis. Review and edit the draft before saving it.
      </p>
      <div className="map-toolbar">
        <button className="secondary" disabled={running} onClick={() => void review()}>
          {reading ? 'Reading Setup Files…' : 'Read Setup Files'}
        </button>
      </div>
      {reading && (
        <div className="readme-reading" role="status">
          <progress aria-label="Reading setup files" />
          <span>Reading setup files and hiding sensitive values…</span>
        </div>
      )}
      {!verified && (
        <p className="metadata-note">
          Configure and verify your LLM in Settings to generate a README.
        </p>
      )}
      {evidence && (
        <>
          <details className="readme-files">
            <summary>
              Setup files read · {evidence.files.length}{' '}
              {evidence.files.length === 1 ? 'file' : 'files'}
            </summary>
            {evidence.files.map((file) => (
              <details key={file.path} className="readme-file">
                <summary>
                  <FileText aria-hidden="true" />
                  <span>{file.path}</span>
                  <ChevronRight className="readme-file-chevron" aria-hidden="true" />
                </summary>
                <pre className="readme-evidence">{file.content}</pre>
              </details>
            ))}
            {evidence.limitations.map((text) => (
              <p className="metadata-note" key={text}>
                {text}
              </p>
            ))}
          </details>
          <div className="readme-generate-panel">
            <label className="readme-consent">
              <input
                type="checkbox"
                checked={approved}
                disabled={running}
                onChange={(event) => setApproved(event.target.checked)}
              />
              <span>
                Share these setup files with my AI to generate a README.
                <small>
                  Sensitive values are hidden. Your repository’s source permissions still apply.
                </small>
              </span>
            </label>
            <div className="readme-generate-actions">
              {job?.status === 'running' && (
                <button
                  className="secondary"
                  onClick={() => void window.engineering!.cancelReadme(job.id)}
                >
                  Cancel
                </button>
              )}
              <button
                className="primary"
                disabled={running || !approved || !verified}
                onClick={() => void generate()}
              >
                {job?.status === 'running' ? 'Generating…' : 'Generate README Draft'}
              </button>
            </div>
          </div>
        </>
      )}
      {job?.status === 'running' && (
        <p role="status">{job.activeTool ? `Inspecting ${job.activeTool}…` : 'Writing README…'}</p>
      )}
      {content && (
        <>
          <label>
            Editable Markdown preview
            <textarea
              aria-label="README Markdown"
              className="readme-editor"
              value={content}
              maxLength={65536}
              disabled={running}
              onChange={(event) => {
                setContent(event.target.value);
                setNotice('Unsaved edits');
              }}
            />
          </label>
          <div className="map-toolbar">
            <button
              className="primary"
              disabled={running || !content.trim()}
              onClick={() => void save(false)}
            >
              Save README.follo.md
            </button>
            <button
              className="secondary"
              disabled={running || !content.trim()}
              onClick={() => void save(true)}
            >
              Export Markdown…
            </button>
          </div>
          <p className="metadata-note">
            Review commands and missing details before sharing. Existing files are never
            overwritten. Draft edits stay in this view until you save or export.
          </p>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
