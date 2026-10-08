# Phase 17 — Reference evaluation and observability

Deterministic checks compare cited file IDs and recognizable paths against the saved analysis and successful tool evidence. Decision IDs must have been returned by the registered decision tool. An explicit [decision:ID=OUTCOME] citation must match a saved engine outcome. Missing checkable evidence and uncited risk language are flagged for inspection.

Ask displays supported-reference counts, unsupported references and the evaluator's limits. A reference can be valid while its surrounding sentence is wrong; semantic truth and implied relationships are not automatically verified. A path absent from analysis may be excluded, unsupported or nonexistent.

Observability uses an interface and retains 50 local metadata records. Questions and answers are hashed rather than logged as raw text. Records include provider/model, snapshot, permission, tool successes/failures, evidence, latency, nullable usage and evaluation. No source, credentials or raw tool arguments enter trace storage. Failed investigations retain partial activity and counters. Logging failures are visible.

Validation: 52 tests, type checking, linting and production build pass. Fixtures cover absent/unfetched references, fabricated decisions, mismatched outcomes, uncheckable answers, source-containing questions staying out of traces, and the complete mock compatibility-test → native-tool investigation → evaluation flow. No live provider traffic was used. Final desktop and installer verification is recorded in build-status.md.
