# Phase 14 — Controlled tools

The registered tools are search_code, get_file, get_neighbors, get_dependencies, get_dependents, get_blast_radius, find_path, get_repository_summary and get_decision. Exact schemas reject unexpected fields, arbitrary paths, unregistered decisions and excessive depths. Calls are bound to one registered repository and saved analysis.

Search returns metadata without source snippets. get_file applies the captured source permission and byte budget. Relationships are paged at 50 files with visible truncation, path traversal is bounded to 10 edges, and evidence records files and decisions actually returned. Decision errors remain errors when its provider is unconfigured.

Validation: 45 tests, type checking, linting, production build, desktop smoke and unpacked packaging. Integration fixtures cover source withholding, explicit selection, stale analysis rejection, fixed tool schemas and missing decision providers. These tools do not expose network, filesystem mutation, credentials, settings or permission changes.
