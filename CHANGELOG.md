# Change Log

## Unreleased

### Fixed

- Propagated model-list cancellation and prevented invalidated in-flight requests from restoring stale cache data.
- Reserved `model-router` for the virtual **Auto (router)** entry so a catalogue collision cannot create duplicate
  models or route a normal model through the router endpoint.
- Corrected daily quota normalization for mixed unlimited/finite entries, negative API values, and account payloads
  that provide quota usage without a separate quota list.
- Raised the minimum supported VS Code version to 1.106 because image attachments use `LanguageModelDataPart`, which
  is not present in the previously declared 1.104 API.

### Changed

- Bounded model, account, error, streaming-event, tool-call, and quota-fallback payload processing; quota fallback
  requests now use limited concurrency.
- Potentially expensive model-filter regular expressions now fall back to literal substring matching.
- Pinned the VS Code API types to the declared minimum and added a high-severity dependency audit to the quality gate.

### Security

- Tool calls now fail closed unless their streamed id, type, name, arguments, and advertised availability are valid;
  missing ids are no longer synthesized.
- Updated vulnerable transitive development dependencies used by VSIX packaging (`brace-expansion`, `fast-uri`,
  `js-yaml`, and `undici`).

## 0.4.4 - 2026-08-01

### Fixed

- Cancelling a response mid-stream no longer emits half-assembled tool calls. Stopping the model while it was
  writing tool arguments could surface an `invalid arguments returned for tool …` error, or ask VS Code to run a
  tool the user had just stopped; both are now dropped together with the cancelled stream.
- Restored English copy for the **Auto (router)** entry in the model picker, which still carried an
  Italian description.

### Changed

- Documented the Open VSX distribution channel, which already serves the same published build, so VSCodium and
  other Open VSX editors have a supported install path.
- Recorded the historical release dates in this changelog and expanded the agent guide with the release,
  packaging, and publishing procedure.

### Security

- Escaped Markdown metacharacters, including backslashes and table separators, in one pass so API-provided usage
  labels cannot create ambiguous escaping sequences.

## 0.4.3 - 2026-08-01

### Fixed

- Validated model-catalogue and streaming payloads before exposing them to VS Code.
- Preserved the final SSE event when a compatible server closes a stream without a trailing newline.
- Rejected malformed or non-object tool arguments instead of invoking a tool with guessed input.
- Propagated chat cancellation to every Chutes account request and refreshed the model cache immediately after configuration changes.

### Changed

- Added a reproducible quality gate with TypeScript, Oxlint, Prettier, offline regression tests, production bundling, and VSIX-content verification.
- Hardened GitHub Actions with minimal permissions, immutable action revisions, concurrency control, timeouts, and deterministic packaging.
- Made the test bundle step portable across Windows and Linux runners by using esbuild's JavaScript API.
- Added repository guidance, code ownership, improved contribution templates, and synchronized development, privacy, security, and user documentation.
- Clarified the model, router, and account API trust boundaries and removed an unused account API request.

### Security

- Enabled private vulnerability reporting and Dependabot security updates while keeping routine version-update PRs disabled.
- Escaped API-provided Markdown values before rendering account and quota information in chat.

## 0.4.2 - 2026-07-13

### Changed

- Improved legal documentation, trademark notices, third-party terms references, and metadata cleanup.

## 0.4.1 - 2026-07-10

### Changed

- Upgraded TypeScript from `^6.0.3` to `^7.0.0` (resolved 7.0.2). No source or configuration changes were required.

## 0.4.0 - 2026-06-21

- Added an **Auto (router)** model that delegates model selection and automatic fallback to Chutes' native model router. Pick **Auto (router)** in the model list and your prompt is classified and routed to a suitable model; if that model is cold or unavailable, the router fails over automatically — no manual switching. Controlled by the new `chutes.autoRouterEnabled` (on by default) and `chutes.routerEndpoint` settings.

## 0.3.0 - 2026-06-18

- Added a **`@chutes` chat participant** for usage monitoring inside the chat panel: `@chutes /usage` shows spend for the current billing windows (monthly cap, 4-hour window) and your daily request quota; `@chutes /quota` shows per-model quotas. It reuses the API key already configured for the provider.

## 0.2.1 - 2026-06-18

- Fixed: entering the API key could silently do nothing. Saving the key fired a model-list change event in the middle of resolving models, which discarded the result. The provider no longer fires that event while resolving; the list now refreshes only after the key is managed. Key entry is reliable.
- Added screenshots to the README and Marketplace listing.

## 0.2.0 - 2026-06-18

- Fixed: selecting **Chutes AI** under "Manage Models" now always opens the API-key input box. Previously, if you dismissed the first prompt, the field never reappeared on subsequent clicks.
- The API-key box now opens directly on provider selection (no intermediate notification) and dedupes concurrent prompts.
- Reworked the README and Marketplace copy (Quick Start, Features, Resources) and renamed the title to "Chutes AI Provider for GitHub Copilot Chat".
- Added a Trademarks acknowledgment for the Chutes name and marks.
- Removed the Open VSX badge — the extension targets VS Code's native chat.

## 0.1.0 - 2026-06-18

- Initial release.
- Registers Chutes.ai as a VS Code language model provider.
- Automatic discovery of all chat models from `GET /v1/models`.
- Streaming chat responses, tool calling (agent mode) and image input (vision).
- API key stored securely in SecretStorage; managed via the `Chutes AI: Manage API Key` command.
- Configurable endpoint, model filter and request timeout.
