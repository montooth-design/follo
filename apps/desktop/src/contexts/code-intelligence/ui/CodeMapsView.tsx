import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  useReactFlow,
  MarkerType,
  Position,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { RefreshCw, Plus, Minus, Maximize } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import type { GraphSnapshot, RecentRepository, AnalysisSummary } from '@follo/shared';
import { Inspector } from './Inspector';
import { mapLayout } from '../domain/code-map-layout';

const CodeExplorer = lazy(() =>
  import('./CodeExplorer').then((module) => ({ default: module.CodeExplorer })),
);

function MapControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="map-controls">
      <button aria-label="Zoom In" title="Zoom In" onClick={() => void zoomIn()}>
        <Plus />
      </button>
      <button aria-label="Zoom Out" title="Zoom Out" onClick={() => void zoomOut()}>
        <Minus />
      </button>
      <button aria-label="Fit View" title="Fit View" onClick={() => void fitView()}>
        <Maximize />
      </button>
    </div>
  );
}

export function CodeMapsView({
  onSettings,
  onRepository,
}: {
  onSettings: () => void;
  onRepository: (repositoryId: string) => void;
}) {
  const [repositories, setRepositories] = useState<RecentRepository[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [snapshot, setSnapshot] = useState<GraphSnapshot>();
  const [summary, setSummary] = useState<AnalysisSummary>();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const [connections, setConnections] = useState<'focused' | 'all'>('all');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [manualPositions, setManualPositions] = useState<Record<string, XYPosition>>({});

  function moveNodes(changes: NodeChange[]) {
    const moves = changes.filter((change) => change.type === 'position' && change.position);
    if (!moves.length) return;
    setManualPositions((previous) => {
      const next = { ...previous };
      for (const change of moves)
        if (change.type === 'position' && change.position) next[change.id] = change.position;

      return next;
    });
  }

  useEffect(() => {
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
    setSnapshot(undefined);
    setSummary(undefined);
    setSelected('');
    setError('');
    setManualPositions({});
    if (!repositoryId) return;
    setLoading(true);

    void (async () => {
      try {
        const state = await window.engineering!.getAnalysisState(repositoryId);
        if (state.status !== 'complete' || !state.result?.provenance)
          throw new Error('Analyze this repository in the Repository view first.');
        const graph = await window.engineering!.getGraph(
          repositoryId,
          state.result.provenance.analysisId,
        );

        if (active) {
          setSnapshot(graph);
          setSummary(state.result);
        }
      } catch (error) {
        if (active) setError(String(error));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [repositoryId, revision]);
  const view = useMemo(() => {
    const matches =
      snapshot?.nodes.filter((node) => node.path.toLowerCase().includes(filter.toLowerCase())) ??
      [];
    const neighbors = new Set([selected]);

    for (const edge of snapshot?.edges ?? []) {
      if (edge.sourceFileId === selected) neighbors.add(edge.targetFileId);
      if (edge.targetFileId === selected) neighbors.add(edge.sourceFileId);
    }

    const scoped =
      connections === 'focused' && selected
        ? matches.filter((node) => neighbors.has(node.id))
        : matches;
    const visible = scoped.slice(0, 500);
    const ids = new Set(visible.map((node) => node.id));
    const positions = snapshot ? mapLayout(snapshot, ids) : new Map();
    const cyclic = new Set(snapshot?.cycles.flatMap((cycle) => cycle.fileIds));

    return {
      total: scoped.length,
      nodes: visible.map((node) => ({
        id: node.id,
        position: positions.get(node.id)!,
        data: { label: node.path },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: [
          cyclic.has(node.id) ? 'cycle-node' : node.status === 'skipped' ? 'skipped-node' : '',
          selected === node.id
            ? 'map-selected'
            : selected && neighbors.has(node.id)
              ? 'map-connected'
              : selected
                ? 'map-muted'
                : '',
        ].join(' '),
        selected: selected === node.id,
      })),
      edges: [
        ...new Map(
          (snapshot?.edges ?? [])
            .filter(
              (edge) =>
                ids.has(edge.sourceFileId) &&
                ids.has(edge.targetFileId) &&
                (connections === 'all' ||
                  !selected ||
                  edge.sourceFileId === selected ||
                  edge.targetFileId === selected),
            )
            .map((edge) => [`${edge.sourceFileId}:${edge.targetFileId}`, edge]),
        ).values(),
      ].map((edge) => ({
        id: `${edge.sourceFileId}:${edge.targetFileId}`,
        source: edge.sourceFileId,
        target: edge.targetFileId,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            edge.sourceFileId === selected || edge.targetFileId === selected
              ? '#aeedbc'
              : '#66717d',
        },
        type: 'smoothstep',
        className:
          edge.sourceFileId === selected || edge.targetFileId === selected
            ? 'map-highlighted-edge'
            : selected
              ? 'map-muted-edge'
              : '',
        style: {
          strokeWidth: edge.sourceFileId === selected || edge.targetFileId === selected ? 2.5 : 1.3,
        },
      })),
    };
  }, [snapshot, filter, selected, connections]);
  const nodes = useMemo(
    () =>
      view.nodes.map((node) => ({ ...node, position: manualPositions[node.id] ?? node.position })),
    [view.nodes, manualPositions],
  );

  return (
    <section aria-label="Code Maps">
      <div className="map-toolbar">
        <label>
          Repository
          <select
            aria-label="Map repository"
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
          File path
          <input
            aria-label="Filter graph files"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label>
          Connections
          <select
            aria-label="Map connections"
            value={connections}
            onChange={(event) => setConnections(event.target.value as 'focused' | 'all')}
          >
            <option value="focused">Selected file connections</option>
            <option value="all">All relationships</option>
          </select>
        </label>
        <button className="secondary" onClick={() => setSelected('')}>
          Clear Selection
        </button>
        <button
          className="secondary map-reload"
          aria-label="Reload Snapshot"
          title="Reload Snapshot"
          disabled={loading || !repositoryId}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw />
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading saved graph…</p>}
      {snapshot && (
        <>
          <p
            className="metadata-note"
            title={`Saved snapshot: ${summary?.completedAt ?? ''}. Current source may differ.`}
          >
            {view.nodes.length} files · {view.edges.length} connections
          </p>
          {view.total > 500 && (
            <p className="inspection-warnings">
              The map displays the first 500 matching files. Filter by path to explore the
              remainder; hidden edges are omitted from this view only.
            </p>
          )}
          <div className={`map-workbench${selected ? ' has-inspector' : ''}`}>
            <div className="code-map">
              <ReactFlow
                key={`${repositoryId}:${revision}:${filter}:${connections}:${Boolean(selected)}:${connections === 'focused' ? selected : ''}`}
                nodes={nodes}
                edges={view.edges}
                fitView
                fitViewOptions={{ maxZoom: 1 }}
                nodesDraggable
                nodesConnectable={false}
                onNodesChange={moveNodes}
                colorMode="dark"
                onNodeClick={(_event, node) => setSelected(node.id)}
              >
                <Background />
                <MapControls />
              </ReactFlow>
            </div>
            {selected && summary?.provenance && (
              <aside className="map-inspector-panel" aria-label="Map file inspector">
                <div className="map-inspector-heading">
                  <strong>File Inspector</strong>
                  <button
                    className="secondary"
                    aria-label="Close File Inspector"
                    onClick={() => setSelected('')}
                  >
                    Close
                  </button>
                </div>
                <Inspector
                  key={`${summary.provenance.analysisId}:${selected}`}
                  repositoryId={repositoryId}
                  analysisId={summary.provenance.analysisId}
                  fileId={selected}
                  graph={snapshot}
                  onSelect={setSelected}
                />
              </aside>
            )}
          </div>
          <div className="map-toolbar map-layout-actions">
            <button
              className="secondary"
              title="Restore Dependency Layout"
              onClick={() => setManualPositions({})}
            >
              Reset Layout
            </button>
          </div>
          <label className="map-toolbar code-file-picker">
            Inspect File
            <select
              aria-label="Inspect file"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Select a file</option>
              {snapshot.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.path}
                </option>
              ))}
            </select>
          </label>
          {summary?.provenance && (
            <Suspense
              fallback={
                <p role="status" className="metadata-note">
                  Loading code viewer…
                </p>
              }
            >
              <CodeExplorer
                key={`${summary.provenance.analysisId}:${selected}`}
                repositoryId={repositoryId}
                analysisId={summary.provenance.analysisId}
                fileId={selected}
                onSettings={onSettings}
                onSourceSettings={() => onRepository(repositoryId)}
              />
            </Suspense>
          )}
          {!view.nodes.length && <p className="metadata-note">No files match this view.</p>}
        </>
      )}
    </section>
  );
}
