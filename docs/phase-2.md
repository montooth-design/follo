# Phase 2 — Repository selection

## Delivered

- Native OS folder picker owned by the Electron main process, with cancellation preserving the current selection.
- Read-only metadata inspection for both Git repositories and ordinary directories.
- Canonical folder path, separate Git root, branch, commit, detached/unborn state, and working-tree status.
- TypeScript/TSX and JavaScript/JSX file counts, and root `package.json`, `tsconfig.json`, and `jsconfig.json` presence.
- Recent repositories stored in SQLite and refreshed on reopen; duplicate paths retain a stable ID.
- Schema 2 migration preserving Phase 1 appearance settings.
- Loading states, inspection warnings, missing-folder errors, and refresh controls. The Analyze button clearly awaits Phase 3.

## Boundaries and decisions

Repository inspection is an application service under `apps/desktop/src/repositories.ts`. It uses Node directory metadata; it does not read source text, parse imports, execute configuration, or write into selected repositories. No new package or dependency was necessary.

Three narrow bridge methods were added: `openRepository`, `getRecentRepositories`, and `reopenRepository`. The renderer cannot supply a path to the opener. Reopening accepts validated IDs already present in local history and rejects saved paths retargeted through symlinks. Only one picker/inspection operation runs at a time.

Git uses an absolute executable from absolute PATH directories outside the selected folder, fixed read-only commands without a shell, disabled optional index locks/writes, disabled fsmonitor hooks, no credential prompts, and five-second/2-MiB limits. Missing Git does not block source-folder inspection. Git failures produce unknown/error state rather than a fabricated clean result.

File counting skips the specification's common vendor/generated directories and nested symlinks. The count has a 100,000-entry and 10-second scan budget; unreadable directories and exhausted budgets make counts explicitly partial. Root configuration checks are independent of the count limit.

## Verification

Fourteen deterministic tests pass, covering Phase 1 behavior, mixed source files, exclusions, links, partial counts, picker cancellation, busy locking, ID rejection, missing folders, history deduplication and restart persistence, schema migration, retargeted saved paths, Git unavailable/error states, and real unborn/clean/modified/detached/nested Git repositories. Real Git tests also verify index bytes and modification time are unchanged and repository fsmonitor hooks do not execute.

Type checking, linting, and production builds pass. The real Electron smoke test exercises selection/cancellation, rendering metadata, recents/reopening, appearance, isolation, and navigation preserving selection. Native dialog responses are stubbed only in that test; no manual OS-picker interaction was performed.

Windows x64 NSIS packaging passed for the final verified build. The output is `release/Follo Setup 0.2.0.exe`. The installer was built but was not installed on the user's machine. Earlier Git fixture cleanup failures were resolved by clearing read-only flags inside disposable test directories; no assertions were weakened, and the leftover fixtures were removed.

## Limitations

No parser, graph, search, decisions, or AI features were added. Inspection counts are metadata estimates within the documented scan scope, not parser coverage. Git status excludes submodule changes; a selected-root `.gitmodules` file triggers a note. Scan budgets are checked between directory entries rather than forcibly interrupting an OS filesystem operation. Only the 20 most recent repositories are displayed. The installer remains unsigned and uses the default Electron icon.

Next phase: TS-Morph parser, deterministic import classification, and parser coverage.
