# Desktop bounded contexts

Code is grouped by the capability and business concepts it owns. A context may contain its view, application services, pure domain rules, infrastructure adapters and tests. Layers are created only where they are useful; there is no requirement to add entities, repositories or interfaces for their own sake.

| Context | Owns | Start here |
| --- | --- | --- |
| `contexts/repositories/` | Registered folders, Git metadata, scan lifecycle, saved snapshots, source permissions, packages, highlights, repository summaries | [Repositories map](contexts/repositories/README.md), `ui/RepositoriesView.tsx` |
| `contexts/code-intelligence/` | Exploring dependencies, code-map layout, File Inspector, saved-code viewing and selection explanations | `ui/CodeMapsView.tsx`, `application/code-explanation.ts` |
| `contexts/search/` | Keyword/concept search interaction and AI-ranked search results | `ui/SearchView.tsx`, `application/concept-search.ts` |
| `contexts/conversations/` | Asking questions and presenting an investigation conversation | `ui/AskView.tsx` |
| `contexts/ai/` | Provider configuration, encrypted credentials, compatible transports, shared investigation engine, tools, reference evaluation and decision orchestration | [AI map](contexts/ai/README.md) |
| `contexts/settings/` | Theme preference and settings page composition | `ui/SettingsView.tsx` |
| `contexts/overview/` | Overview and opening the repository workflow | `ui/OverviewView.tsx` |

`desktop/` is the composition root and Electron infrastructure: startup, IPC security, and preload. `renderer/` is the React shell: startup, navigation, global declarations, view copy, and layout styles. `shared/` contains genuinely reusable UI and branding, without dependencies on contexts.

## Collaborations

Repositories supplies current, validated saved facts to Code Intelligence, Search and AI tools. Domain-specific AI features stay in their owning context: repository summaries in Repositories, concept search in Search, and code explanations in Code Intelligence. The AI context supplies the investigation engine and providers used by those features. These are typed collaborations, not isolated services or a promise of a strict dependency DAG.

UI code communicates through the bridge in `packages/shared`; it cannot import application services. The desktop composition root constructs services and validates IPC. Shared UI cannot depend on a context, and pure domain helpers cannot import UI or infrastructure. ESLint checks these static import boundaries. Runtime isolation and source permissions remain enforced independently.

Framework-independent algorithms and persistence remain in workspace packages (`parser`, `graph`, `database`, `search`, `llm`, `decisions`, and `shared`). They are reused infrastructure/contracts, not duplicated inside each desktop context. Package-wide and cross-cutting regression suites remain in the workspace `tests/` directory; context-specific suites are alongside their context and registered in `scripts/test.mjs`.

Edit page text in `renderer/view-copy.ts` and shared typography/cards/verification styles in `shared/ui/ui.css`. See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for common edits and checks.

`scripts/build-main.mjs` preserves flat `dist/main.cjs`, `dist/preload.cjs`, and `dist/parser-worker.cjs` names. Source organization does not change runtime paths or the installer layout.
