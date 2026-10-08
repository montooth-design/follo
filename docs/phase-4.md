# Phase 4 — Graph engine

## Delivered

- `packages/graph`, independent of Electron, React, SQLite, AI, and filesystem access.
- Directed file adjacency with importer-to-dependency edges, deduplicated by endpoints and retaining every import fact as evidence.
- Dependencies, dependents, neighbors, bounded breadth-first walks, dependency chain, blast radius, shortest directed path, cycle groups, fan-in, and fan-out.
- Deterministic direct and transitive metrics, LOC, cycle membership, and maximum dependency depth.
- Worker pipeline integration: build graph, calculate direct metrics, and complete. The latest complete graph stays in main-process memory; only its summary crosses the existing IPC bridge.
- Repository-screen graph summary, with file counts, unique edges, cycle groups, and files in cycles.

## Semantics and trust

Only parser-resolved imports whose source and target are parsed files become edges. Missing/skipped endpoints, external packages, skipped imports, and unresolved imports are preserved as gaps with original evidence and reasons. No paths or edges are inferred. Discovered skipped files remain isolated nodes. Repeated imports count once for fan-in/fan-out while their individual import facts remain available in edge evidence.

Traversal uses a single breadth-first implementation in opposite directions: dependencies follow outgoing edges; blast radius follows incoming edges. Each reachable file appears once at its shortest depth, excluding the root even when cycles lead back to it. A depth of zero returns no other files. Unknown IDs, invalid directions, and invalid depths throw. Path queries return a shortest directed route, `[source]` for identical endpoints, or `null` when there is no verified route. Sorting by path and then ID provides stable tie-breaking independent of input order.

Cycles are strongly connected groups, computed with iterative Kosaraju in O(V+E), including single-file self imports. This avoids exponential enumeration of all simple cycles. Group identity derives from sorted member IDs; `cycleCount` is group membership (zero or one), not the number of simple cycle routes. Maximum dependency depth is the longest dependency path for an acyclic reachable subgraph. It is `null` when any reachable cycle makes walks unbounded. Transitive-dependent counts exclude the root. Unknown LOC remains `null`.

The snapshot contains direct metrics for every file. More expensive transitive metrics are calculated on demand through the domain API in O(V+E) per file, avoiding an unconditional all-files quadratic pass. Algorithms use iterative stacks/queues and defensive copies. These metrics describe source imports, including type-only imports, and do not claim runtime execution or change-risk judgments. Parser coverage and exclusions still define the graph's limits.

## Verification

The full suite contains 33 passing tests. Graph fixtures cover evidence deduplication and gap accounting, missing/skipped endpoints, reverse traversal, depth bounds, shortest paths, disconnected files, self loops, overlapping cycles, SCC boundaries, longest DAG depth, unknown LOC, input-order stability, mutation isolation, and real TS/JS parser integration. A 10,000-file chain and cycle verify iterative behavior. Seeded graphs are checked against independent transitive-closure reachability and cycle membership.

Type checking, linting, and the production build pass. The desktop smoke test verifies graph totals in the actual renderer alongside parser coverage and existing isolation checks; native-dialog responses are stubbed only in the test harness. The parser and graph worker also pass from the packaged ASAR archive. The Windows x64 NSIS installer is `release/Follo Setup 0.4.0.exe`.

## Scope

Persistence remains Phase 5; SQLite schema stays at 2. React Flow visualization remains Phase 6 and interactive graph/metric inspection Phase 7. No search, watcher, decisions, or provider integration was added. The existing two-minute analysis deadline and worker memory limit include graph construction. The Windows installer remains unsigned with the default Electron icon.

Next phase: persist analyses, files, edges, metrics, and coverage so analysis can be reloaded.
