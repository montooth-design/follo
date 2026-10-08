# Phase 8 — Search

SQLite schema 4 adds an FTS5 index scoped by saved analysis. Parsed source text, file paths, and declaration names (including camel-case split names) are indexed transactionally with facts. Results include bounded text snippets and navigate to the saved file inspector. Search uses literal prefix keywords combined with AND, a 200-character/20-token bound, and pages of 50 results. SQL is parameterized and input cannot supply FTS operators.

Source text now remains in the local SQLite search index, as required by this phase. It is not included in analysis summaries or graph IPC. Search snippets are shown as text, never HTML. Nothing is sent to a provider. No embeddings or vector services were added. Older snapshots without indexes prompt for reanalysis.

All 37 tests, type checking, linting, production build, and desktop smoke pass. Tests cover paths, declaration names, source matches, pagination, restart, literal query validation, stale ownership, and index isolation across successive snapshots. The real desktop search produces two matching fixture files and its screenshot was inspected. Unpacked packaging is checked before Phase 9.

Keyword search is not semantic search. Unsupported/skipped files are not source-indexed. Historical source indexes are retained with historical analyses. Next: provider-independent decision foundation.
