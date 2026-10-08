# Phase 5 — Persistence

SQLite schema 3 stores analysis metadata and coverage, file facts and hashes, dependency edges with evidence, graph gaps, cycle groups, and direct metrics. Completed snapshots commit in one transaction. Failed writes roll back without replacing earlier snapshots. Existing settings and repository records migrate in place.

Analysis IDs and timestamps identify each saved snapshot. Git commit/branch/working-tree metadata is captured at analysis start when available. Saved facts reload through the registered-repository service after restart. The UI explicitly labels historical snapshots and asks users to rerun after changes; no timestamp or Git state is presented as proof that current files match. Source text and credentials are not stored in this phase.

All 35 tests, type checking, linting, production build, and desktop smoke pass. New tests cover restart round trips, graph evidence/metrics, registered-ID ownership, migration, foreign-key enforcement, and transaction rollback. Unpacked-app packaging is checked before beginning Phase 6.

History is retained locally; automatic cache reuse and incremental updates are not implemented. Transitive metrics remain on-demand domain operations. Next: React Flow code map.
