# Phase 6 — Code map

The React Flow view renders real nodes and directed edges from the latest saved analysis. Repository selection, path filtering, fit/zoom controls, a mini-map, file selection, and cycle borders are available. Imports cannot be created or edited in the map. The graph IPC requires a registered repository and the current saved analysis ID; stale IDs are rejected.

For readability and bounded rendering, the canvas shows up to 500 matching files, with an explicit notice when more match. Filtering makes the rest accessible. Edges to hidden files are omitted only from the displayed view; stored facts are unchanged. Layout is a stable grid; structural inspection follows in Phase 7.

All 35 tests, type checking, linting, production build, and real desktop smoke pass. The smoke checks two real source nodes and their directed edge; the screenshot was inspected. Graph lookup ownership/stale-ID tests extend the persistence suite. Unpacked packaging is checked at this phase boundary. Vite reports an ignored library `use client` directive; it does not affect this desktop renderer.

React Flow integration follows its [official documentation](https://reactflow.dev/learn/concepts/building-a-flow). Its current package places TypeScript exports under the node condition; the workspace type resolver enables that condition without changing Vite's browser bundle.
