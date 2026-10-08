# Phase 9 — Decision foundation

The framework-independent decision package defines choice, Boolean, and score questions; trusted registered definitions; a provider abstraction with declared capabilities; a decision engine; canonical finite-JSON state hashes; strict answer/probability validation; and result provenance. Evaluation requires a configured provider supporting every requested question. Unregistered requests, unsupported capabilities, missing providers, malformed responses, and timeouts do not produce guessed decisions. Provider calls have a 30-second deadline and abort signal.

SQLite schema 5 stores definition versions and decision records, preserving analysis/subject, state/hash, definition/version, provider/model, answers/probabilities, latency, and timestamp. Foreign keys tie results to verified file facts and registered definitions. Changing a stored definition without increasing its version is rejected. Credentials do not enter these tables.

The main-process decision service owns registration. The renderer can list summaries, but cannot submit definitions, extractors, or arbitrary decision prompts. No real engineering definition is registered during this phase. Two test-only providers exercise the same contract without installing or configuring an AI provider.

All 39 tests, type checking, linting, production build, and desktop smoke pass. Tests cover canonical hashes, successful provenance, unsupported/unconfigured providers, invalid outcomes/confidence, multiple question types, definition immutability, and SQLite subject ownership. Packaging is checked at this phase boundary.

Next: choose only the decision adapters actually needed, then implement the explicitly approved first decision.
