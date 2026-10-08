# Phase 15 — Native investigation loop

The main process runs native provider tool calls against a fixed registry, feeds each result back with its tool-call ID, and streams draft text until a validated completion. There is no agent framework or multi-agent execution.

Hard limits: 8 rounds, 24 tool calls, 200 evidence files, 128 KiB context, 32 KiB response text and 120 seconds. Source has its separate 12-file/64-KiB budget. Cancellation and deadlines stop even a provider that ignores AbortSignal. Permission, configuration and analysis changes cancel active investigations.

Validation: 48 tests at the phase boundary, type checking, linting, production build, desktop smoke and unpacked packaging. Tests cover native tool IDs, failures, budgets, prompt-injection text remaining tool data and cancellation. No live model was called. The system prompt provides behavioral instructions; the registry, source gate and budgets provide enforced boundaries. Freeform explanations still require the deterministic evaluation in Phase 17.
