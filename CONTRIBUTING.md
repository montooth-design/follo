# Working on Follo

## Find the owning context

Start with the [bounded-context map](apps/desktop/src/README.md). Repository behavior—including UI, scans, source permissions and summaries—is together under `apps/desktop/src/contexts/repositories`. Code Intelligence, Search, Conversations, AI, Settings and Overview have their own context folders.

Use `ui/` for a view or feature component, `application/` for a use case/service, `domain/` for pure rules, `infrastructure/` for a worker/adapter, and `tests/` for context regressions. Not every context needs every layer. Shared presentation is under `src/shared`; Electron bootstrap and IPC are under `src/desktop`; React startup/navigation are under `src/renderer`.

## Make a first UI change

Top-level headings and subheadings live in [view-copy.ts](apps/desktop/src/renderer/view-copy.ts). Edit `VIEW_COPY.Search.heading` to change the Search heading; sidebar labels are separate in `renderer/App.tsx`. Overview renders its heading inside the green card. A selected repository uses its folder name as its view heading.

| Change                                                | Where to go under `apps/desktop/src/`                    |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Page heading text                                     | `renderer/view-copy.ts`                                  |
| Sidebar/navigation                                    | `renderer/App.tsx`                                       |
| Heading fonts/sizes, card styles, verification styles | `shared/ui/ui.css`                                       |
| Overview                                              | `contexts/overview/ui/OverviewView.tsx`                  |
| Repository list/details                               | `contexts/repositories/ui/RepositoriesView.tsx`          |
| Scan controls and files                               | `contexts/repositories/ui/AnalysisPanel.tsx`             |
| Source Permissions                                    | `contexts/repositories/ui/PrivacySettings.tsx`           |
| Packages, highlights, summary cards                   | Corresponding component in `contexts/repositories/ui/`   |
| Code map and inspector                                | `contexts/code-intelligence/ui/`                         |
| Keyword/concept search                                | `contexts/search/ui/SearchView.tsx`                      |
| Ask                                                   | `contexts/conversations/ui/AskView.tsx`                  |
| Settings layout/theme                                 | `contexts/settings/ui/SettingsView.tsx`                  |
| AI connection fields                                  | `contexts/ai/ui/AiSettings.tsx`                          |
| Logo                                                  | `shared/branding/Logo.tsx` and `shared/branding/assets/` |
| Feature-specific layout and theme colors              | `renderer/style.css`                                     |

Card headings and button labels live beside their feature's JSX. Search for visible text with `rg -n 'Repository details' apps/desktop/src`. Do not edit generated `dist`/`release` files or dependencies in `node_modules`.

## Reuse presentation

Import Heading, ViewHeader, SectionHeader, SectionCard, VerificationBadge and VerificationButton from `shared/ui`. They accept typed props and share styles. Semantic heading levels are separate from visual variants. The `--heading-*` tokens in `shared/ui/ui.css` change typography across contexts.

```tsx
<ViewHeader title="Search" subtitle="Find related files." />
<SectionCard variant="settings" aria-label="Theme settings">
  <SectionHeader title="Theme" headingLevel="h2" />
  {/* Feature controls go here. */}
</SectionCard>
```

Shared components do not own provider calls, repository state or permissions. A Saved badge is not proof of a tested connection. Avoid context-specific typography overrides that defeat shared tokens.

## Follow the data safely

Views use `window.engineering`, whose contract is in `packages/shared`. `desktop/preload.ts` forwards operations; `desktop/main.ts` validates senders/arguments and constructs the context services. Do not import application services into UI or put filesystem/provider calls in React. ESLint checks the static UI/application, pure-domain and shared/context boundaries.

For example, keyword search goes from SearchView through the bridge to `repositories/application/analysis-service.ts` and `packages/database`. Concept search belongs to Search and uses the AI investigation engine to consume saved Repository facts. See the [AI map](apps/desktop/src/contexts/ai/README.md) for the full flow.

A `repositoryId` identifies a registered folder; `analysisId` identifies a saved scan; `fileId` identifies a relative path within the scan. A saved scan is historical. Keep current-analysis validation, source permissions, effect cleanup, cancellation and stale-response guards intact.

## Run and validate

Use Node 22.12 or newer. Run `npm install`, then `npm run dev`. Renderer edits reload automatically; desktop/preload/worker changes require restarting. Reanalyze a repository to see changed source in the saved code viewer.

`npm run format` formats source; `npm run format:check` checks it. For UI edits, use type checking, lint and a visual check. `npm run check` runs type checking, lint, tests and build. `npm run smoke` exercises the real desktop with isolated fixture storage and saves screenshots in `dist/smoke`. Update intentional UI text expectations in `tests/desktop-smoke.cjs`.

Context tests live under `contexts/<name>/tests`; package-wide and cross-cutting tests remain under workspace `tests`. Add suites to `scripts/test.mjs` and their context path to `contextTests`. Backend operations generally involve the shared contract, preload, main handler, owning application service and behavior tests. Test boundaries and meaningful outcomes, not implementation details.

Never commit real credentials or log provider headers. Run `npm run security:secrets` and `npm run security:audit` for provider/dependency changes. Existing unresolved packaging advisories and sweep limits are in `docs/security-review-2026-10-07.md`.
