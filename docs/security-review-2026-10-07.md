# Security review — October 7, 2026

Reviewed the current checkout's Electron boundaries, repository scanning, AI transport, credential storage, source permissions, investigation traces, packaging configuration, and installed dependency advisories. This is a code review and targeted regression sweep, not a penetration test or a guarantee that all secrets or vulnerabilities can be detected.

## Changes

- Added outbound redaction for recognizable provider/GitHub/AWS keys, bearer tokens, long literal credential assignments, and PEM private keys. Source is redacted before snippet selection so a snippet from the middle of a private key is also protected. Newlines and character counts are preserved for code references. Local source viewing remains unchanged.
- Applied the same redaction to chat message contents, including pasted questions. Authentication credentials remain only in the request's Authorization header, separate from model context.
- Added `npm run security:secrets` and `npm run security:audit`. The scanner reports paths and line numbers, never matching secret values. Use `npm run security:secrets -- --include-build` to include textual build/release artifacts. It skips dependencies, Git internals, symlinks and binary installers.
- Added Git and installer exclusions for environment files, credential vault files and private-key files. `.env.example` remains eligible for version control and should contain placeholders only.

## Existing controls confirmed

Keys are stored using Electron's OS-backed encryption, bound to the configured endpoint, and absent from SQLite configuration and renderer status responses. Plaintext Linux storage is rejected. Password fields clear after save/test attempts. Provider requests require HTTPS except explicit loopback HTTP, forbid URL credentials/query parameters, block redirects, and sanitize provider failures. Model tools cannot access credentials, change settings or execute shell commands.

The renderer has context isolation, sandboxing, no Node integration, strict production CSP and no outbound network access. IPC validates the owned window, exact main-frame URL, argument counts and request bounds. New windows, navigation, webviews and permissions are denied. Repository operations accept registered IDs, validate current analysis IDs, and constrain paths/symlinks. AI defaults to Graph Only; source-enabled access is bounded and repository-specific. Stored investigation traces contain hashes and metadata rather than prompt/source/answer text.

These controls were checked against the [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security/).

## Results and remaining limits

No recognized key tokens, literal credential assignments or private keys were found in scanned project files or textual build artifacts. There is no `.git` directory in this checkout, so commit history was not inspected. User credential vaults and other repositories were not read. Pattern-based scanning/redaction cannot detect every custom secret, encoded value, dynamically assembled credential or sensitive business datum; source-enabled permissions still authorize sending other source text to the selected provider. Graph Only remains the option for withholding source.

The npm advisory audit reports eight **moderate** findings, all in the development packaging dependency chain (`electron-builder` → `@electron/get` → `global-agent` → `roarr` → `sprintf-js`). The underlying advisory is [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), an unbounded-precision denial of service. A compatible `npm audit fix` made no dependency changes and left these warnings unresolved. No forced upgrades or unverified dependency overrides were applied. This chain is distinct from the shipped application's declared runtime dependencies; the audit remains nonzero and must not be presented as clean.

Validation: 67 tests, type checking, lint, formatting, production build, secret scanning and isolated desktop smoke. No live provider calls or user keys were used. Installer signing and adversarial network/OS testing were outside this sweep.
