# Follo 0.19.0

Clicking a code-map node opens its File Inspector in a scrollable panel on the right. The panel includes the existing facts, graph metrics, registered decisions, dependencies, dependents, traversals, cycles, path queries and import diagnostics. Close or Clear selection returns to the full-width map. Inspector file links update the map selection.

The selected node and its incident dependency arrows are emphasized. Direct neighbors have a distinct border; unrelated nodes and arrows are muted in All relationships mode. Focused mode remains available.

Nodes can be dragged individually. Controlled positions survive selection, filtering, inspector open/close and connection-mode changes while the map remains open. Reset layout restores the calculated dependency layout. Reloading or leaving the map resets the session arrangement; positions are not persisted to disk.

Validation: 54 tests, type checking, linting and production build pass. Desktop smoke checks right-side panel placement, node/edge highlights, native mouse dragging, position retention across connection modes and closing/reopening the inspector. The panel and focused-map screenshot was visually inspected. Installer and packaged worker checks are recorded in build-status.md.
