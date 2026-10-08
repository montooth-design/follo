import { SectionHeader, Heading } from '../../../shared/ui';
import { useEffect, useState } from 'react';
import type { FileInspection, GraphSnapshot, GraphNode } from '@follo/shared';

export function Inspector({
  repositoryId,
  analysisId,
  fileId,
  graph,
  onSelect,
}: {
  repositoryId: string;
  analysisId: string;
  fileId: string;
  graph: GraphSnapshot;
  onSelect: (id: string) => void;
}) {
  const [result, setResult] = useState<FileInspection>();
  const [depth, setDepth] = useState(5);
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [decisionConfigured, setDecisionConfigured] = useState(false);
  const [decisions, setDecisions] = useState<import('@follo/decisions').DecisionResult[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      window.engineering!.getDecisionDefinitions(),
      window.engineering!.getDecisionResults(repositoryId, analysisId),
    ])
      .then(([definitions, records]) => {
        if (active) {
          setDecisionConfigured(
            Boolean(definitions.find((definition) => definition.id === 'change-risk')?.configured),
          );
          setDecisions(records.filter((record) => record.subjectId === fileId));
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, [repositoryId, analysisId, fileId]);

  async function evaluate() {
    setEvaluating(true);
    setError('');

    try {
      const decision = await window.engineering!.evaluateChangeRisk(
        repositoryId,
        analysisId,
        fileId,
      );
      setDecisions((records) => [decision, ...records]);
    } catch (error) {
      setError(String(error));
    } finally {
      setEvaluating(false);
    }
  }

  const targetFileId = graph.nodes.find((node) => node.path === target)?.id ?? null;
  useEffect(() => {
    let active = true;
    setError('');
    setResult(undefined);
    window
      .engineering!.inspectFile(repositoryId, analysisId, { fileId, maxDepth: depth, targetFileId })
      .then((result) => {
        if (active) setResult(result);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, [repositoryId, analysisId, fileId, depth, targetFileId]);
  const names = new Map(graph.nodes.map((node) => [node.id, node]));

  function fileList(label: string, items: GraphNode[]) {
    return (
      <details className="inspector-list" open={items.length < 10}>
        <summary>
          {label} ({items.length})
        </summary>
        <div>
          {items.map((node) => (
            <button className="file-link" key={node.id} onClick={() => onSelect(node.id)}>
              {node.path}
            </button>
          ))}
        </div>
        {!items.length && <p className="metadata-note">None in this snapshot.</p>}
      </details>
    );
  }

  return (
    <article className="inspector" aria-label="File inspector">
      <SectionHeader title="File inspector">
        <span>Saved evidence</span>
      </SectionHeader>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!result && !error && <p role="status">Loading file relationships…</p>}
      <div className="map-toolbar">
        <label>
          Traversal depth
          <input
            aria-label="Traversal depth"
            type="number"
            min="0"
            max="50"
            value={depth}
            onChange={(event) =>
              setDepth(Math.min(50, Math.max(0, Number(event.target.value) || 0)))
            }
          />
        </label>
        <label>
          Path target
          <input
            aria-label="Path target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Exact file path, e.g. src/index.ts"
          />
        </label>
      </div>
      {target && !targetFileId && (
        <p className="metadata-note">Enter a file path present in this saved analysis.</p>
      )}
      {result && (
        <>
          <Heading as="h2" variant="section">
            {result.file.path}
          </Heading>
          <p className="metadata-note">
            {result.file.status} · SHA-256 {result.file.hash ?? 'unknown'} ·{' '}
            {result.file.linesOfCode ?? 'Unknown'} LOC
          </p>
          <dl className="coverage-grid">
            {(
              [
                ['Fan-in / direct dependents', result.metrics.fanIn],
                ['Fan-out / direct dependencies', result.metrics.fanOut],
                ['All transitive dependents', result.metrics.downstreamDependents],
                [
                  'Maximum dependency depth',
                  result.metrics.maxDependencyDepth ?? 'Unbounded (reachable cycle)',
                ],
                ['Cycle group membership', result.metrics.cycleCount],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <section className="inspector-list">
            <Heading as="h3" variant="detail">
              Structural change risk
            </Heading>
            <p className="metadata-note">
              Registered definition v1 · Graph facts only. Confidence is provider-reported and is
              not a measured probability of breakage.
            </p>
            <button
              className="secondary"
              disabled={
                !decisionConfigured ||
                evaluating ||
                result.file.status !== 'parsed' ||
                result.file.diagnostics.length > 0
              }
              onClick={() => void evaluate()}
            >
              {evaluating ? 'Evaluating…' : 'Evaluate Change Risk'}
            </button>
            {!decisionConfigured && (
              <p className="metadata-note">
                Decision provider not configured. No risk classification has been generated.
              </p>
            )}
            {decisions.map((record) => (
              <p className="metadata-note" key={record.decisionId}>
                {record.answers[0]?.value} · Confidence{' '}
                {Math.round(
                  (record.answers[0]?.probabilities?.[String(record.answers[0]?.value)] ?? 0) * 100,
                )}
                % · {record.provider}/{record.model} · {new Date(record.createdAt).toLocaleString()}{' '}
                · Saved analysis {record.analysisId.slice(0, 8)} · Input hash{' '}
                {record.inputStateHash}
              </p>
            ))}
          </section>
          {fileList('Dependencies', result.dependencies)}
          {fileList('Dependents', result.dependents)}
          {fileList(
            `Dependency chain within depth ${depth}`,
            result.dependencyChain.map((entry) => entry.file),
          )}
          {fileList(
            `Blast radius within depth ${depth}`,
            result.blastRadius.map((entry) => entry.file),
          )}
          {fileList(
            'Cycle members',
            result.cycles.flatMap((cycle) => cycle.fileIds).map((id) => names.get(id)!),
          )}
          {targetFileId && (
            <div>
              <Heading as="h3" variant="detail">
                Shortest directed path
              </Heading>
              {result.path ? (
                <ol>
                  {result.path.map((node) => (
                    <li key={node.id}>
                      <button className="file-link" onClick={() => onSelect(node.id)}>
                        {node.path}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="metadata-note">No verified directed path in this snapshot.</p>
              )}
            </div>
          )}
          <details className="inspector-list">
            <summary>
              Imports ({result.file.imports.length}) and diagnostics (
              {result.file.diagnostics.length})
            </summary>
            {result.file.diagnostics.map((item, index) => (
              <p className="metadata-note" key={index}>
                Line {item.line ?? 'unknown'}: {item.message}
              </p>
            ))}
            {result.file.imports.map((fact, index) => (
              <p className="metadata-note" key={index}>
                Line {fact.line} · {fact.kind} · {fact.specifier ?? '[computed]'} ·{' '}
                {fact.resolution.status}:{' '}
                {fact.resolution.status === 'resolved'
                  ? fact.resolution.targetPath
                  : fact.resolution.status === 'external'
                    ? fact.resolution.packageName
                    : fact.resolution.reason}
              </p>
            ))}
          </details>
          <p className="metadata-note">
            These are verified source-import relationships within parser coverage. Type-only imports
            are included. This is not a runtime prediction or a risk decision.
          </p>
        </>
      )}
    </article>
  );
}
