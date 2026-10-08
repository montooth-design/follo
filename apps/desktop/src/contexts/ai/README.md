# AI context

This context owns provider connections and the reusable investigation machinery. Feature-specific AI behavior belongs to the context that owns the feature.

| Folder | Intent |
| --- | --- |
| `configuration/` | `ai-service.ts` configures models and verifies compatibility; `credential-vault.ts` protects endpoint-bound credentials |
| `providers/` | Native Decisions API transport; compatible chat/stream transport is in `packages/llm` |
| `investigation/` | `ask-service.ts` owns a cancellable session; `agent.ts` runs bounded model/tool rounds; `tools.ts` exposes validated evidence; `evaluation.ts` checks references; `observability.ts` records hashes and metadata |
| `decisions/` | Registers change-risk definitions, collects verified facts and saves validated provider judgments |
| `ui/` | Provider settings and verification controls (`AiSettings.tsx`), composed into the Settings view |
| `tests/` | Provider, investigation, evidence, reference, observation and secret-redaction regressions |

## Feature ownership

- Repository summaries: `contexts/repositories/application/repository-summary.ts`.
- Per-repository source policy: `contexts/repositories/application/source-permissions.ts`.
- Concept search: `contexts/search/application/concept-search.ts`.
- Selected-code explanations: `contexts/code-intelligence/application/code-explanation.ts`.
- Conversation UI: `contexts/conversations/ui/AskView.tsx`.

These features use separate AskService instances, so their results and cancellation cannot overwrite each other's sessions. Provider protocol and secret-redaction helpers remain in `packages/llm`; decision definitions and validation remain in `packages/decisions`.

## Follow a request

A context's view calls `window.engineering`. `desktop/preload.ts` sends IPC, and `desktop/main.ts` validates it and selects the application service. The service validates the current repository snapshot, verified provider connection and repository source policy. AskService supplies controlled EngineeringTools to the agent loop. Tools consume saved Repository facts, while SourceBudget enforces source permissions, ranges, byte limits and redaction. The feature validates the completed output before presenting or saving it.

Keys are never available to model tools or returned through the bridge. Changing a provider, policy or scan cancels affected investigations. Native decisions follow their own provider contract; a chat explanation is not a substitute for a decision. Redaction is defense in depth, while permissions remain the authorization boundary.
