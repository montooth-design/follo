# Approved first decision — Change risk

Status: approved by the user on October 6, 2026; implemented in Phase 11.

Definition ID: `change-risk`, version 1. Subject: one parsed source file in one saved analysis.

Question: "Classify the structural change risk associated with modifying this file, using only the supplied verified dependency facts."

Allowed outcomes: LOW, MODERATE, HIGH, CRITICAL. These are model judgments, not graph facts or measured failure probabilities. No numerical thresholds or deterministic fallback classification are proposed.

Input state: fan-in, fan-out, direct dependents, transitive dependents, cycle-group membership, maximum dependency depth, LOC, parser coverage, and unresolved/skipped import counts. Dependency depth remains null when a reachable cycle makes walks unbounded. The file's LOC must be known and the file must have parsed without syntax diagnostics. No source text is sent. Related-test count is omitted because the current parser does not establish tests or their coverage reliably.

Expected provider response: exactly one allowed outcome, a probability for each of the four outcomes (finite numbers in [0,1], sum within 0.001 of 1), and no free-form engineering claims. Probabilities are provider-reported confidence, not calibrated estimates of breakage. The outcome must have maximum reported probability; ties may select any tied maximum.

Validation: reject extra fields, unknown outcomes, missing/invalid probabilities, malformed state, unverified subjects, unsupported provider capabilities, and mismatched analysis IDs. Do not guess on provider failure.

Presentation: outcome and reported confidence, definition/version, analysis/file, provider/model, creation time, and a link to the verified input facts. Keep historical results labeled by their saved analysis. If no decision provider is configured, display "Decision provider not configured"; graph metrics remain usable and no risk label is fabricated.

Persistence: save definition/version, analysis ID, subject ID, input-state hash, provider/model, validated result, latency, and timestamp. Keep provider credentials outside SQLite.
