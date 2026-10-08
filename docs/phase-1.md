# Phase 1 — Desktop foundation

Implemented the first phase of the supplied product specification. The folder began empty.

## Delivered

- npm workspace monorepo with Electron, React, and strict TypeScript.
- Overview, repository, map, search, insights, Ask, and settings navigation. Later-phase views explicitly state that functionality is not implemented.
- Sandboxed preload bridge exposing only application status and appearance settings.
- Main-process IPC checks for owned window, exact renderer URL, main frame, argument count, and settings shape.
- SQLite schema migration and persisted appearance settings at the application data path.
- Explicit startup/storage errors, denied navigation/new windows/webviews/permissions, and production CSP without network access.
- Production bundles and Windows x64 NSIS installer.

## Architecture choices

Electron 44.5.1 is pinned for reproducible packaging. Its built-in `node:sqlite` avoids native-addon rebuilds. The database package has no Electron or React dependencies. Shared contracts contain no filesystem or credential APIs. SQLite currently stores only appearance; repository and analysis schemas belong to later phases.

esbuild bundles main and preload code; Vite builds the renderer and serves development assets on loopback. Application services communicate through IPC, with no HTTP API. Node.js 22.12+ is required for development; verification used bundled Node 24. Future packages will be introduced in their respective phases.

## Verification

- Type checking: passed.
- Linting: passed.
- Five deterministic tests in Electron's runtime: passed. These cover persistence/reopening, invalid settings rejection, IPC sender validation, future-schema rejection, and SQLite FTS5 support.
- Production main/preload/renderer build: passed.
- Real desktop smoke test: passed. It exercises the actual bridge and storage, checks renderer isolation and window security preferences, and captures the rendered UI.
- Windows NSIS installer build: passed; output is `release/Follo Setup 0.1.0.exe`.

Earlier dependency installation attempts left incomplete packages. A fresh dependency tree and lockfile resolved those failures. The workspace packager also required an explicit Electron version. Final checks ran after those repairs; temporary dependency backups were removed.

## Limitations and next phase

The installer is unsigned and uses Electron's default application icon. The installer was built but not installed on the user's machine. This phase contains no repository selection, analysis, graph engine, search, or AI providers. Phase 2 adds the native folder picker, recent repositories, and repository metadata. The first engineering decision remains subject to explicit design before Phase 11, as required by the specification.
