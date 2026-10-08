# Repositories context

This context owns registered local repositories and their saved scans. Start here for opening a folder, metadata, scan lifecycle, source permissions, package inventory, repository highlights, or repository summaries.

- `application/repository-service.ts`: folder registration, recent repositories, canonical paths and Git inspection.
- `application/analysis-service.ts`: start a scan, track progress, validate the current analysis ID, and read saved source/graph/search data.
- `infrastructure/parser-worker.ts`: execute parsing and graph construction outside the main thread.
- `application/source-permissions.ts`: repository policy, selected paths, source budgets and redaction.
- `application/repository-summary.ts`: the repository-specific AI summary use case and validated persistence.
- `application/readme-service.ts`: bounded, redacted setup evidence and README generation through a separate investigation session; saves new drafts without overwriting files.
- `ui/ReadmeDraft.tsx`: setup evidence review, explicit sharing consent, editable Markdown, save and export.
- `domain/repository-highlights.ts`: pure rules for deriving repository areas from scan facts.
- `ui/`: RepositoriesView and its analysis, permissions, highlights, tech-stack and summary cards.
- `tests/`: registration, permissions, highlights, tech stack and repository summary regression tests.

The main concepts are **Repository** (a registered folder), **Analysis** (one saved snapshot), and **File** (a relative path within an analysis). A repository ID is not a path; an analysis ID is not a live view of disk. A new scan changes the current analysis; permissions belong to the repository and persist across scans. Summary provenance belongs to the scan that supported it.

Parsing, graph algorithms and persistence use framework-independent workspace packages. AI summary execution uses the AI context's investigation engine. Code Intelligence and Search consume validated saved repository facts; they do not own repository registration or scan lifecycle. The UI uses the desktop bridge rather than importing these application services.
