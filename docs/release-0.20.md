# Follo 0.20.0

The code map displays all visible relationships by default. Focused mode also displays relationships whenever no file is selected, so clearing selection cannot produce a misleading disconnected overview. Selected-node highlights, the inspector side panel and node dragging remain available.

Overview contains the repository-opening hero without the foundation cards. The text logo replaces the avatar. A menu toggle switches between full navigation labels and an icon-only sidebar; icons retain accessible names and tooltips.

Repository shows its introductory picker only after confirming that history is empty. Once a repository has been opened, Choose Folder moves beside the Repository heading, aligned right and vertically centered. Opening, reopening and analysis controls keep their existing busy-state validation.

Verbose map explanations are replaced with short file/connection counts. Snapshot provenance remains available through the count tooltip and the existing repository/inspector details. Warnings and errors remain visible.

Validation: 54 tests, type checking, linting, production build and desktop smoke pass. Smoke starts with fresh isolated storage and checks the empty-history picker, its transition to the header button, header alignment, sidebar collapse/expand, absence of avatar/foundation cards, initial graph connections, connections after deselection, inspector highlights and real dragging. Screenshots are inspected; installer and packaged-worker verification are recorded in build-status.md.
