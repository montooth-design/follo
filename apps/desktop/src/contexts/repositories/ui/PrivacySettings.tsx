import { SectionCard, SectionHeader, VerificationBadge } from '../../../shared/ui';
import { useEffect, useState } from 'react';
import type { AnalysisSummary, PrivacyPolicy } from '@follo/shared';

export function PrivacySettings({
  repositoryId,
  snapshot,
  active,
}: {
  repositoryId: string;
  snapshot: AnalysisSummary | null;
  active: boolean;
}) {
  const [policy, setPolicy] = useState<PrivacyPolicy>({ level: 'graph-only', selectedFileIds: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const analysisId = snapshot?.provenance?.analysisId;
  useEffect(() => {
    let current = true;
    setLoaded(false);
    setSaved(false);
    setError('');
    if (active && analysisId)
      void window
        .engineering!.getPrivacy(repositoryId, analysisId)
        .then((policy) => {
          if (current) {
            setPolicy(policy);
            setLoaded(true);
          }
        })
        .catch((error) => {
          if (current) setError(String(error));
        });

    return () => {
      current = false;
    };
  }, [repositoryId, analysisId, active]);

  async function save() {
    if (!analysisId) return;
    setBusy(true);
    setError('');
    setSaved(false);

    try {
      setPolicy(await window.engineering!.setPrivacy(repositoryId, analysisId, policy));
      setSaved(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      variant="repository"
      className="ai-settings"
      aria-label="Source Permissions settings"
    >
      <SectionHeader title="Source Permissions">
        {saved && (
          <VerificationBadge state="verified" role="status">
            Saved
          </VerificationBadge>
        )}
      </SectionHeader>
      <div className="permission-explanation">
        <p>
          <strong>Graph Only</strong> — Paths, dependency relationships, metrics, and search
          metadata. No source text.
        </p>
        <p>
          <strong>Selected Source</strong> — Snippets from files you select, up to 200 lines per
          request.
        </p>
        <p>
          <strong>Full File</strong> — Snippets or complete files from anywhere in the saved
          analysis.
        </p>
        <p>
          Source-enabled investigations share a limit of 12 files and 64 KiB. These permissions
          control AI access; local scanning and inspection remain available.
        </p>
      </div>
      {!analysisId ? (
        <p className="metadata-note">Analyze this repository to configure source access.</p>
      ) : (
        <>
          <label>
            Permission{' '}
            <select
              aria-label="Source permission"
              value={policy.level}
              disabled={busy || !loaded}
              onChange={(event) => {
                setSaved(false);
                setPolicy({
                  level: event.target.value as PrivacyPolicy['level'],
                  selectedFileIds: [],
                });
              }}
            >
              <option value="graph-only">Graph Only — no source</option>
              <option value="selected-source">Selected Source — selected snippets</option>
              <option value="full-file">Full File — saved source files</option>
            </select>
          </label>
          {policy.level === 'selected-source' && (
            <>
              <p className="muted">
                Select up to 50 files. Selected paths stay permitted across scans; unavailable files
                cannot be read.
              </p>
              <div className="file-list">
                {snapshot?.files
                  .filter((file) => file.status === 'parsed')
                  .map((file) => (
                    <label key={file.id}>
                      <input
                        type="checkbox"
                        checked={policy.selectedFileIds.includes(file.id)}
                        disabled={
                          busy ||
                          !loaded ||
                          (policy.selectedFileIds.length >= 50 &&
                            !policy.selectedFileIds.includes(file.id))
                        }
                        onChange={(event) => {
                          setSaved(false);
                          setPolicy((previous) => ({
                            ...previous,
                            selectedFileIds: event.target.checked
                              ? [...previous.selectedFileIds, file.id]
                              : previous.selectedFileIds.filter((id) => id !== file.id),
                          }));
                        }}
                      />
                      {file.path}
                    </label>
                  ))}
              </div>
            </>
          )}
          <div className="permission-actions">
            <button className="primary" disabled={busy || !loaded} onClick={() => void save()}>
              Save Source Permissions
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
