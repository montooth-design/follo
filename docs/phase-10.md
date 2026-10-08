# Phase 10 — Decision providers

Status: deferred under the user's instruction to keep both AI capabilities unconfigured.

The specification says "Implement only providers actually needed." No decision provider/model combination has been selected, so no vendor-specific adapter or invented capability declaration is installed. The common provider contract is tested with two test-only implementations. Decision results remain unavailable until a real, verified adapter is selected and configured.

This is not a claim that a live provider connection has been tested. A future selected adapter must translate the registered question schema, declare actual model capabilities, validate response shape, honor timeouts, and keep credentials out of SQLite and renderer reads.
