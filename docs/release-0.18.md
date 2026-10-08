# Follo 0.18.0

Repository scans now save a package inventory across discovered package.json files, including runtime, development, peer and optional declarations and their version ranges. External imports provide distinct importing-file counts; Node built-ins are separate from third-party packages. The Repository view displays searchable package cards and per-manifest details. Installation and runtime use are not inferred. Old snapshots require reanalysis.

The code map removes the mini-map and replaces the fixed grid with dependency layers, keeping cycle groups in the same layer. Selected-file connections are the default: the overview shows files until a file is selected, then displays that file with its direct dependencies and dependents. All relationships remains available explicitly. Edges are deduplicated defensively and drawn once per directed file pair, without repeated-import labels. Stored graph facts are unchanged.

Validation: 54 tests, type checking, linting, production build and Electron smoke pass. Tests cover workspace package declarations, declared versus observed usage, built-in normalization, snapshot persistence and cycle-aware layout. Smoke verifies zero overview edges, focused edges after selection, no mini-map and package inventory rendering. Installer and packaged-worker verification accompany the release.

Dense graphs can still overlap in All relationships mode; the focused view is intended for tracing individual files. The existing 500-file display limit remains explicit.
