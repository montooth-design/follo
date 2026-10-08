# Phase 12 — Generative foundation

Completed October 6, 2026. Both AI systems remain unconfigured. The main process owns an optional OpenAI-compatible Chat Completions adapter, explicit endpoint/model selection, a streaming native-tool compatibility test, and OS-protected credentials. SQLite stores only nonsecret configuration. Credentials are bound to their endpoint and never returned to the renderer.

The adapter follows the [official function-calling format](https://developers.openai.com/api/docs/guides/function-calling). Credential protection uses [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage); insecure Linux basic_text storage is rejected. Model capabilities require a successful explicit test; no model or vendor is preselected. Test traffic contains no repository information.

Validation: 43 tests, type checking, linting, production build, desktop smoke and unpacked packaging. Mock transport tests cover native calls, streaming, malformed responses, endpoint restrictions and secret redaction. No live model connection has been tested. Windows OS protection does not isolate credentials from other applications running under the same account.
