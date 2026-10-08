# Phase 11 — Structural change risk

The user approved `docs/change-risk-design.md` on October 6, 2026. Definition `change-risk` v1 now registers in trusted main-process code. State extraction contains graph metrics, parser coverage, and skipped/unresolved import counts; source text and unverified test counts are omitted. Unknown LOC, skipped files, syntax diagnostics, unexpected state fields, and invalid metrics are rejected. Reachable-cycle depth stays null.

The inspector exposes the registered definition and saved results with outcome, provider-reported confidence, provider/model, timestamp, analysis ID, and input hash. The action remains disabled and explicitly unconfigured while no decision provider is selected. No deterministic fallback risk label is generated.

All 40 tests, type checking, linting, production build, and desktop smoke pass. New fixtures verify approved state/outcomes, no source fields, cyclic-depth uncertainty, malformed-state rejection, and provider response validation. Packaging is checked before Phase 12. No live decision-model call is claimed.
