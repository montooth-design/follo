# Phase 16 — Ask interface

Ask selects a saved repository analysis, displays its source permission, streams draft text, exposes tool/decision activity and provides clickable file evidence through the inspector. It preserves an investigation when navigating between views. Cancellation is explicit. Provider setup and source permissions remain human-operated settings.

With both AI capabilities unconfigured, Ask explains that state and links to the deterministic code map and source search. No answer or risk judgment is fabricated. Responses render as text and validated citation buttons, without executable markup or external links.

Validation: 49 tests, type checking, linting, production build, desktop smoke and unpacked packaging. The unconfigured Ask screen and default Graph Only state were checked in Electron, and its screenshot was inspected. Streaming protocol and native-loop behavior use mock providers; live model behavior remains untested.
