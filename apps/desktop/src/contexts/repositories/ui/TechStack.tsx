import { SectionHeader } from '../../../shared/ui';
import { useState } from 'react';
import type { ParserAnalysis } from '@follo/shared';

export function TechStack({ stack }: { stack: ParserAnalysis['techStack'] }) {
  const [filter, setFilter] = useState('');
  if (!stack) return null;
  const packages = stack.packages.filter((item) =>
    item.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <section aria-label="Tech stack" className="tech-stack">
      <SectionHeader title="Packages & tech stack">
        <span>
          {stack.packages.filter((item) => !item.builtin).length} packages · {stack.manifests}{' '}
          manifests
        </span>
      </SectionHeader>
      <p className="metadata-note">
        Declared dependencies across scanned package.json files and external imports observed in
        source. Versions are declared ranges; installation and runtime usage are not inferred.
      </p>
      <div className="map-toolbar">
        <label>
          Find a package
          <input
            aria-label="Filter packages"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="react, typescript…"
          />
        </label>
      </div>
      <div className="stack-packages">
        {packages.map((item) => (
          <details className="stack-package" key={item.name}>
            <summary>
              <strong>{item.name}</strong>
              <span>
                {item.builtin
                  ? 'Node built-in'
                  : item.declarations.length
                    ? [
                        ...new Set(
                          item.declarations.map((declaration) =>
                            declaration.kind
                              .replace('Dependencies', '')
                              .replace('dependencies', 'runtime'),
                          ),
                        ),
                      ].join(' · ')
                    : 'Imported · undeclared'}{' '}
                · {item.importedBy} importing files
              </span>
            </summary>
            <div>
              {item.declarations.map((declaration, index) => (
                <p className="metadata-note" key={index}>
                  {declaration.version} · {declaration.kind} · {declaration.manifest}
                </p>
              ))}
              {!item.declarations.length && (
                <p className="metadata-note">
                  {item.builtin
                    ? 'Provided by Node.js.'
                    : 'No declaration found in scanned manifests.'}
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
      {!packages.length && <p className="metadata-note">No matching packages in this snapshot.</p>}
    </section>
  );
}
