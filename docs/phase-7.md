# Phase 7 — Inspector

Selecting a graph file or choosing it from the full file dropdown shows saved file facts, hash and LOC, fan-in/fan-out, transitive dependent count, maximum dependency depth, cycle membership, direct dependencies/dependents, bounded dependency chains and blast radius, cycle members, imports/diagnostics, and shortest directed paths to an exact saved file path. Related file links navigate the inspector. Traversal depth is 0–50. Relationship lists scroll without discarding results.

The three-argument IPC verifies registered repository, current analysis ID, request shape, depth, and file membership. It cannot read arbitrary paths or execute code. Snapshot changes produce a reload error. Graph operations remain in the framework-independent graph package and have no AI dependency.

All 35 tests, type checking, linting, production build, and desktop smoke pass. Ownership, invalid-depth, unknown-file, blast-radius, cycle-depth, and path queries are exercised through the application service. The real desktop test selects a graph node and verifies inspector metrics; its screenshot was inspected. Unpacked packaging is checked before Phase 8.

The graph instance is currently reconstructed for each inspector request. Domain work is linear in the selected snapshot; a future worker/query cache can reduce latency for very dense repositories. Saved snapshots and parser coverage remain explicitly labeled. Next: SQLite FTS5 search.
