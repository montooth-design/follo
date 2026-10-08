import { SectionHeader, Heading } from '../../../shared/ui';
import { useMemo, useState } from 'react';
import type { AnalysisSummary } from '@follo/shared';
import { repositoryHighlights } from '../domain/repository-highlights';
import {
  ShieldCheck,
  CreditCard,
  Database,
  Braces,
  Route,
  Clock,
  HardDrive,
  Mail,
  Lock,
  LayoutDashboard,
  TestTube,
  type LucideIcon,
} from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  auth: ShieldCheck,
  payments: CreditCard,
  database: Database,
  schema: Braces,
  api: Route,
  jobs: Clock,
  storage: HardDrive,
  email: Mail,
  security: Lock,
  ui: LayoutDashboard,
  tests: TestTube,
};

export function RepositoryHighlights({
  analysis,
  onInspect,
  busy,
}: {
  analysis: AnalysisSummary;
  onInspect: (id: string) => void;
  busy: boolean;
}) {
  const highlights = useMemo(() => repositoryHighlights(analysis), [analysis]);
  const [all, setAll] = useState(false);

  return (
    <section className="repository-highlights" aria-label="Repository highlights">
      <SectionHeader title="Repository highlights">
        <span>{highlights.length} detected areas</span>
      </SectionHeader>
      <p className="metadata-note">
        Signals from scanned file names and packages. Open the files to confirm their role.
      </p>
      <div className="highlight-grid">
        {(all ? highlights : highlights.slice(0, 6)).map((area) => {
          const Icon = icons[area.id] ?? ShieldCheck;

          return (
            <article className="highlight-card" key={area.id}>
              <div className="highlight-heading">
                <span className="highlight-icon" aria-hidden="true">
                  <Icon />
                </span>
                <Heading as="h4" variant="detail">
                  {area.title}
                </Heading>
              </div>
              <div className="highlight-count">
                {area.files.length
                  ? `${area.files.length} matching ${area.files.length === 1 ? 'file' : 'files'}`
                  : 'No matching source paths'}
              </div>
              {!!area.packages.length && (
                <div className="highlight-packages">
                  {area.packages.map((item) => (
                    <span
                      key={item.name}
                      title={
                        item.importedBy
                          ? `Imported by ${item.importedBy} scanned files`
                          : 'Declared dependency; no source import observed'
                      }
                    >
                      {item.name}
                      {!item.importedBy && <small> declared</small>}
                    </span>
                  ))}
                </div>
              )}
              <div className="highlight-files">
                {area.files.slice(0, 3).map((file) => (
                  <button
                    className="file-link"
                    key={file.id}
                    disabled={busy}
                    onClick={() => onInspect(file.id)}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
              {area.files.length > 3 && (
                <details>
                  <summary>More files ({area.files.length - 3})</summary>
                  <div className="highlight-files">
                    {area.files.slice(3, 100).map((file) => (
                      <button
                        className="file-link"
                        key={file.id}
                        disabled={busy}
                        onClick={() => onInspect(file.id)}
                      >
                        {file.path}
                      </button>
                    ))}
                  </div>
                  {area.files.length > 100 && (
                    <p className="metadata-note">
                      Showing the first 100 paths. Use the file filter below to explore more.
                    </p>
                  )}
                </details>
              )}
            </article>
          );
        })}
      </div>
      {highlights.length > 6 && (
        <div className="highlight-actions">
          <button
            className="primary highlight-more"
            onClick={() => setAll((previous) => !previous)}
          >
            {all ? 'Show Key Areas' : `Show All ${highlights.length} Areas`}
          </button>
        </div>
      )}
      {!highlights.length && (
        <p className="metadata-note">
          No clear area signals in this snapshot. Browse the packages and files below.
        </p>
      )}
    </section>
  );
}
