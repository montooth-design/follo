# Phase 13 — Source permissions

Graph Only is the default for each saved analysis. Selected Source allows bounded snippets only from files selected by the user. Full File permits saved source files subject to the same investigation budgets. A new analysis receives fresh default permissions.

The main process validates permission changes against parsed file IDs and reads source from the matching saved FTS snapshot. A budget enforces 200 lines per snippet, 12 source files and 64 KiB of UTF-8 source. Graph Only refuses source reads before touching storage. Models cannot change permissions.

Validation: 44 tests, type checking, linting, production build, desktop smoke and unpacked package checks. Tests cover rejected selections, Graph Only, selected versus full reads, and byte accounting. Source is historical; permission does not make a saved snapshot current.
