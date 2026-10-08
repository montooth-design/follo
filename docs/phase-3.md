# Phase 3 — Deterministic source parser

## Delivered

- New framework-independent `packages/parser` with TS-Morph 28 and TypeScript's module resolver.
- Bounded discovery and parsing for `.ts`, `.tsx`, `.js`, and `.jsx`, with configurable directory exclusions and mandatory `.git` exclusion.
- Stable path-based file IDs, SHA-256 byte hashes, physical LOC, syntax diagnostics, and visible file-read failures.
- Static imports, reexports, literal dynamic imports, import types, TypeScript import-equals, and CommonJS require facts. Computed expressions and locally declared require functions remain explicitly skipped.
- Resolved internal paths, external package specifiers, skipped relationships, and unresolved relationships with reasons.
- Nearest project config selection, JSONC/local inheritance, path aliases, `.js`-to-`.ts` substitution, and NodeNext import/require package conditions.
- Worker-backed Analyze Repository, discover/parse/resolve progress, coverage totals, filtered/paginated files, and per-file classified imports.
- Narrow validated IPC for starting registered repositories, reading progress/summary, and looking up verified file IDs.

## Architecture and trust

The parser reads a bounded snapshot into a TS-Morph in-memory project. TypeScript resolution uses only discovered file and directory metadata and loaded local configuration/manifests. It does not read real filesystem paths supplied by imports or configs, execute source/configuration, or emit output. Symlinks, retargeted roots, changed/replaced files, invalid UTF-8, malformed configurations, unsupported assets, and excluded targets produce explicit uncertainty rather than guessed internal edges.

The worker keeps the Electron UI responsive and has a two-minute deadline plus a 768-MiB old-generation heap limit. Discovery is capped at 200,000 entries and 10,000 source files; reads are capped at 2 MiB per file and 64 MiB total. Read-byte accounting includes files whose decoding fails. Only the latest fact result is retained in main-process memory; source text is never sent to the renderer or stored in SQLite. SQLite schema remains 2.

Coverage invariants are enforced in fixtures: discovered files equal parsed plus skipped; discovered imports equal resolved plus external plus skipped plus unresolved. Syntax-recovered files count as parsed with syntax errors, and imports from those files are skipped because the relationships are not verified. Partial discovery is labeled explicitly. Every relationship remains available through paginated file/import views. External status identifies a nonlocal specifier; it does not assert that a package is installed.

The default resolver is Bundler/ESNext when no project config exists. Nearest standard configs configure resolution for discovered files; compiler include/exclude globs do not hide source from the analysis scope. Nonstandard config names can supply local inheritance but are not automatically chosen as the owning config. Configs/manifests outside the selected folder or inside excluded directories are unavailable, with resulting uncertainty reported. Windows file lookup is case-insensitive; other supported development platforms use case-sensitive lookup. No full semantic type checking is claimed.

## Verification

Twenty-five deterministic tests cover the earlier phases plus hashes/LOC, mixed JS/TS, nested/circular imports, reexports, literal/computed dynamic imports, import types, CommonJS/shadowed require, aliases and config inheritance, NodeNext conditions and import-equals, unresolved/external/excluded/unsupported/outside targets, symlinks, syntax errors, encoding/read-size limits, partial discovery, byte budgets, Windows case handling, invalid manifests, absolute-path boundaries, and registered-ID worker orchestration.

Type checking, linting, all 25 tests, and production build checks pass. Desktop smoke verifies analysis coverage, per-file import classifications, and renderer isolation; native-dialog responses are stubbed only in the test harness. The parser worker also passes from the packaged application's ASAR archive. The Windows x64 NSIS installer is `release/Follo Setup 0.3.0.exe`.

## Scope and limitations

No graph algorithms, graph metrics, React Flow map, search index, analysis persistence/cache, watchers, decisions, or AI providers were introduced. Results are per-file snapshots, not an atomic checkout transaction, and must be rerun after source changes. Source decoding supports UTF-8. Absolute compiler-config paths are unsupported and reported as unresolved; absolute source imports are accepted only within the selected repository. Unsupported config/package resolutions stay unresolved instead of guessing. The Windows installer remains unsigned with the default Electron icon.

Next phase: the framework-independent graph engine and its deterministic algorithms.
