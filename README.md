# Follo — Engineering Intelligence Desktop

Follo 0.21.0 implements the local engineering graph, saved analyses, package inventory, code map, inspector, FTS5 search, approved change-risk definition, optional generative connection, source permissions, controlled investigation tools, Ask interface and reference evaluation. Work followed the [product specification](docs/product-spec.md) sequentially; phase reports are in `docs/phase-*.md`. Both AI capabilities remain unconfigured as requested. The development checkout now supports native Decisions API configuration and optional OpenRouter setup for both AI roles; live connections remain untested.

## Contributing

For a first change, start with [the contributor guide](CONTRIBUTING.md). The [desktop source map](apps/desktop/src/README.md) and [AI source map](apps/desktop/src/contexts/ai/README.md) explain the functional folders. Page headings and subheadings live in [view-copy.ts](apps/desktop/src/renderer/view-copy.ts); the guide maps other common changes to their components.

## Run

Use Node.js 22.12+ and npm. Electron ships its own Node runtime, including SQLite.

```powershell
npm install
npm run dev
```

The development script starts a loopback Vite server for renderer assets and hot reload. There is no local application HTTP API. Main/preload edits require restarting the development command.

## Validate and package

```powershell
npm run check
npm run smoke
npm run package
npm run dist
npm run test:packaged
```

`package` produces an unpacked application in `release/win-unpacked`. `dist` produces a Windows x64 NSIS installer in `release`. Installers are unsigned until a signing certificate is configured. Tests run with Electron's Node runtime so they exercise the same SQLite implementation as the app.

`smoke` briefly opens the actual desktop app with separate storage under `dist/smoke`, verifies IPC, renderer isolation, folder selection/cancellation, recent-history reopening, worker analysis, parser coverage, and per-file import classifications. It saves screenshots under `dist/smoke`. Native dialog responses are stubbed in this automated test; the production app uses Electron's OS folder picker. It does not touch normal application settings. After smoke and packaging, `test:packaged` verifies that the worker runs from the packaged ASAR using the unpacked Windows executable.

## Code viewer and explanations

Code Maps includes a split code and explanation panel beneath the graph. Click a node or use the centered Inspect File dropdown to load its saved source. The read-only viewer highlights TypeScript, TSX, JavaScript and JSX, displays line numbers, supports folding, and follows the theme. Select text to explain its line range, optionally enter a question, and choose Explain Selection. With no selection, Explain File covers files up to 200 lines; larger files offer Explain First 200 Lines. Click a line citation in the answer to select that code.

Local viewing works with Graph Only. AI explanation requires a verified LLM and Selected Source permission for that file, or Full File permission. Permission and byte-budget checks happen before any provider request. Explanations receive the selected saved lines, with additional source requests restricted to that same range; relationship metadata is available for context. They use an independent cancellable investigation, and switching files cancels the current explanation. Source is never edited. Explanations remain in memory and can be inaccurate even when citations are valid.

## AI repository summary

After a completed scan, use Generate Repository Summary in Repositories. The verified LLM investigates the saved snapshot using the same read-only evidence tools and source budgets as Ask, then returns purpose/value, core features, workflow, file citations and limitations. Native decision calls are disabled for summaries. Graph Only claims are marked as inferences. The validated summary is saved locally against its analysis ID; a new scan marks it outdated and disables links to historical files until regeneration. Regeneration is explicit; cancellation or invalid output preserves the previous summary.

This version uses scanned JavaScript/TypeScript files and does not read README or other unscanned documentation. Generated summaries explicitly report that limit. Supporting citations are checked against fetched evidence; this does not prove the semantic accuracy of every product claim. No source permission is automatically broadened.

## Repository highlights

Completed scans show area cards for authentication, payments, database access, schema/validation, APIs, jobs, storage, email, security, UI entry points, and tests when naming or package evidence exists. Cards link matching parsed files to their saved source inspection. Package-only matches and declared-but-unobserved dependencies are labeled separately. These are heuristic signals, not runtime guarantees or a complete architecture analysis. Test/fixture paths are excluded from production-area path matching; skipped files are excluded. No AI requests or additional source access are required.

## AI setup and source permissions

Settings has two full-width cards: Theme and AI. Each repository page has its own Source Permissions card. Choose separate providers for an OpenAI-compatible streaming/tool-calling LLM and a native Decisions API model, or use one OpenRouter key and choose both roles in the same setup. Load models explicitly to fetch the current catalog; LLM suggestions require tool calling, and decision suggestions require the decisions modality. Save connections, then test each role. Tests use sample data only. The decision adapter supports choice questions with validated probabilities and connects to structural change-risk v1; it never substitutes chat completions for native decisions. Blank keys in an existing separate connection preserve the stored key for the same endpoint.

Graph Only exposes graph/search metadata without source text. Selected Source permits snippets from explicitly selected files (up to 50 selected files, 200 lines per snippet). Full File permits snippets or complete files anywhere in the saved analysis. Both source-enabled modes have a per-investigation budget of 12 files and 64 KiB. Policies are stored per repository and survive rescans and restarts. Selected Source retains chosen relative paths; missing or skipped files are excluded from access in the current scan. New repositories default to Graph Only. Existing saved-analysis permissions migrate to the repository. Local scanning and inspection are independent of AI source permissions.

OpenRouter protocol references: [model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) and [native Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request). Decision provider requests use the complete request URL; custom providers must implement the same native choice protocol.

## Boundaries

- `apps/desktop`: Electron main, sandboxed preload, and React renderer.
- `packages/shared`: explicit bridge contracts and runtime input validation.
- `packages/database`: framework-independent SQLite storage and schema migration.
- `packages/parser`: framework-independent discovery, TS-Morph parsing, and TypeScript module resolution.
- `packages/graph`: directed adjacency, traversal, shortest paths, cycle groups, and deterministic metrics.
- `packages/search`: literal bounded FTS query construction.
- `packages/decisions`: trusted definitions, provider contracts, validated evaluation, and provenance.
- `packages/llm`: provider-neutral chat/tool/stream contracts and an optional compatible protocol adapter.

Explicit desktop operations cross a validated bridge. Folder access begins with the main-process OS picker; reopening and analysis accept registered repository IDs instead of arbitrary paths. Graph, inspection, search, permissions and Ask are bound to saved analysis IDs. IPC validates the window, main frame, exact renderer URL, argument count and request bounds. Node integration is disabled; context isolation and sandboxing are enabled. New windows, navigation, webviews and permission requests are denied. Production renderer CSP disallows network connections. Optional model requests occur only in the main process. Source text remains in the local FTS5 index; generative tools withhold it by default. API keys use an OS-protected, endpoint-bound credential vault outside SQLite and are never returned to the renderer.

SQLite is created at Electron's `userData` path (typically `%APPDATA%/Follo/follo.sqlite` in a packaged Windows app). Schema 5 migrates prior settings and repositories in place and adds transactional analysis snapshots, graph facts/metrics, local source indexes, and decision provenance. Startup, inspection, and persistence failures are surfaced to the user.

## Current scope

Choose **Repositories → Open New Repository** to inspect a checkout or ordinary source folder. The screen shows its canonical path, Git root/branch/commit/working-tree state when available, TS/TSX and JS/JSX counts, and root package/TypeScript/JavaScript configuration detection. Recents survive restart; choosing a recent or refreshing recomputes metadata. Selection remains visible when navigating between views during the session.

Counts exclude `node_modules`, `dist`, `build`, `coverage`, `.git`, and `.next`, and do not follow nested symlinks. Scans are bounded to 100,000 directory entries and a 10-second scan budget; partial counts and unreadable directories are reported. Root configuration detection checks regular files without parsing or executing their contents. Git is optional on PATH; commands have five-second timeouts and capped output, disable optional index writes and fsmonitor hooks, and ignore submodules (noted when `.gitmodules` exists at the selected root).

Click **Analyze Repository** to discover `.ts`, `.tsx`, `.js`, and `.jsx` files, parse them with TS-Morph, and classify static imports, reexports, literal dynamic imports, import types, CommonJS calls, and TypeScript import-equals declarations. The UI shows discover/parse/resolve progress, file hashes and LOC, syntax diagnostics, and resolved/external/skipped/unresolved counts. Select a file to inspect each relationship and its target or reason; **Needs review** finds uncertain relationships and diagnostics.

Parser directory exclusions are configurable; `.git` remains excluded. Parsing runs in a worker with a two-minute timeout, 768-MiB old-generation heap limit, up to 10,000 source files and 200,000 discovered entries, 2 MiB per file, and 64 MiB total read bytes. Every discovered file and import remains accounted for. Computed imports and shadowed require calls are marked skipped. Syntax-recovered files retain diagnostics and their imports are not treated as verified relationships. LOC counts all physical text lines, including blanks/comments, without counting a final newline as another line.

Compiler settings come from the nearest `tsconfig.json` or `jsconfig.json`, with readable local config inheritance, aliases, NodeNext package conditions, and JS-to-TS substitution. Resolution reads only the discovered in-memory snapshot. Configurations outside scope or in excluded directories cannot be loaded and are reported; package installation is not inferred from an external import. External libraries are classified from their specifiers, not parsed. Analysis scans all supported discovered files regardless of compiler include/exclude globs; configurable directory exclusions determine analysis scope.

Source decoding supports UTF-8. Absolute compiler-config paths are unsupported and reported as unresolved; absolute source imports resolve only within the selected repository.

Analysis builds a directed graph in the same worker. Each edge points from importer to dependency; repeated imports retain their evidence on one edge. Only resolved relationships between parsed files become internal edges. Every other import remains a graph gap, including external imports. Discovered skipped files remain isolated nodes with unknown LOC. The repository view shows file/edge counts and strongly connected cycle groups. The code map renders up to 500 matching files with filtering and visible scope limits. Selecting any saved file opens its facts, dependencies/dependents, metrics, bounded traversals, cycles, and shortest directed paths.

`EngineeringGraph` exposes dependencies, dependents, neighbors, bounded walks, dependency chains, blast radius, shortest directed paths, cycle groups, fan-in/fan-out, and per-file metrics. Traversals are stable breadth-first searches with the root excluded from results. Cycle groups are strongly connected components, including self loops; they do not enumerate every simple cycle. Maximum dependency depth is the longest DAG path, or `null` if a reachable cycle makes dependency walks unbounded. These are source-import relationships, including type-only imports, not runtime execution predictions. Direct metrics are included in the snapshot; transitive metrics are calculated on demand by the domain API.

Completed analyses commit atomically and reload after restart. Git metadata is captured at analysis start; saved snapshots are explicitly historical, so rerun after source changes. Search indexes paths, declaration names, and parsed source; it uses prefix keywords combined with AND and pages of 50 files. Older snapshots without search indexes require reanalysis. Search also offers Concept · AI: describe behavior in plain language, and the verified LLM expands search terms, explores the saved graph, and ranks up to 20 files with explanations. Results reference only files returned by successful tools. Concept search follows repository source permissions, reports metadata-only matches under Graph Only, supports cancellation, and requires the configured LLM to pass its connection test. It does not use embeddings. Source can leave the machine only through an explicitly configured generative connection with source permissions enabled; Graph Only withholds source.

Decision definitions register only in trusted application code. The engine validates capabilities, finite state, outcomes/probabilities, deadlines and provenance. The [approved change-risk definition](docs/change-risk-design.md) uses verified structural metrics and returns LOW/MODERATE/HIGH/CRITICAL only when its independent decision provider is configured. No provider is configured and no fallback judgment is fabricated.

In the code map, clicking a node opens its File Inspector on the right and highlights that node, its direct neighbors and its incident arrows. Individual nodes can be dragged; positions survive selection, filtering and connection-view changes while the map is open. Reset layout restores dependency layers. Reloading or leaving the map discards the temporary arrangement.

## Optional investigation

To generate a README, scan a repository, configure and verify your LLM in Settings, then use the **README draft** card in Repositories. Choose **Read Setup Files**, inspect the redacted files, approve sharing them, and choose **Generate README Draft**. Edit the Markdown before saving to `README.follo.md` or exporting to a new filename. Existing files are never overwritten. Setup collection reads a fixed list of root configuration and CI files, replaces example environment values with placeholders, and reports lockfile presence without sharing its contents. Source tools follow the repository's source permissions. Draft edits remain in memory until saved or exported. Follo does not execute the documented setup commands; review uncertain instructions before use.

Settings allows an explicit compatible endpoint, model and BYOK credential. Saving configuration makes no network call. Test Connection sends a small streaming native-tool compatibility request with no repository data; actual provider/model compatibility requires this test to pass. No vendor or model is preselected, and no live model connection has been tested during development.

Source permissions are stored per repository: **Graph Only** (default), **Selected Source** (snippets from chosen files), or **Full File**. Reanalysis preserves the repository permission choice. Each investigation permits at most 12 source files, 64 KiB of source, 200 lines per snippet, 200 evidence files, 24 calls, 8 rounds, 128 KiB context, 32 KiB response text and 120 seconds. Tools expose read-only engineering queries and registered decisions; models cannot change credentials, endpoints or permissions. Configuration, permission and analysis changes cancel active investigations.

Ask streams draft text, displays tool/decision activity and links returned file evidence to the inspector. Reference checks flag absent or unfetched files, unreturned decisions and mismatched explicit decision outcomes. They do not prove the semantics of every sentence or implied relationship. Paths outside the parsed snapshot may exist but be excluded or unsupported. Uncited risk language receives a conservative warning.

Local observability retains the last 50 investigation metadata records through an interface: provider/model, permission, question/answer hashes and lengths, activity, evidence, timings, token usage and evaluation. Raw question, answer, source and tool arguments are not logged. Trace-save failures are visible. Active conversation text is held in memory and is not restored after restart.




Source formatting: run `npm run format` to apply consistent spacing and Prettier formatting, or `npm run format:check` to check formatting. The source uses two-space indentation, a 100-column target and blank lines around logical blocks. Generated build output remains optimized. Reanalyze a repository to refresh code displayed from an older saved scan.
