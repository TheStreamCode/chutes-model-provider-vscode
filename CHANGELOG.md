# Change Log

## [Unreleased]

## 0.4.2

### Changed

- Improved legal documentation, trademark notices, third-party terms references, and metadata cleanup.

## 0.4.1

### Changed

- Upgraded TypeScript from `^6.0.3` to `^7.0.0` (resolved 7.0.2). No source or configuration changes were required.

## 0.4.0

- Added an **Auto (router)** model that delegates model selection and automatic fallback to Chutes' native model router. Pick **Auto (router)** in the model list and your prompt is classified and routed to a suitable model; if that model is cold or unavailable, the router fails over automatically — no manual switching. Controlled by the new `chutes.autoRouterEnabled` (on by default) and `chutes.routerEndpoint` settings.

## 0.3.0

- Added a **`@chutes` chat participant** for usage monitoring inside the chat panel: `@chutes /usage` shows spend for the current billing windows (monthly cap, 4-hour window) and your daily request quota; `@chutes /quota` shows per-model quotas. It reuses the API key already configured for the provider.

## 0.2.1

- Fixed: entering the API key could silently do nothing. Saving the key fired a model-list change event in the middle of resolving models, which discarded the result. The provider no longer fires that event while resolving; the list now refreshes only after the key is managed. Key entry is reliable.
- Added screenshots to the README and Marketplace listing.

## 0.2.0

- Fixed: selecting **Chutes AI** under "Manage Models" now always opens the API-key input box. Previously, if you dismissed the first prompt, the field never reappeared on subsequent clicks.
- The API-key box now opens directly on provider selection (no intermediate notification) and dedupes concurrent prompts.
- Reworked the README and Marketplace copy (Quick Start, Features, Resources) and renamed the title to "Chutes AI Provider for GitHub Copilot Chat".
- Added a Trademarks acknowledgment for the Chutes name and marks.
- Removed the Open VSX badge — the extension targets VS Code's native chat.

## 0.1.0

- Initial release.
- Registers Chutes.ai as a VS Code language model provider.
- Automatic discovery of all chat models from `GET /v1/models`.
- Streaming chat responses, tool calling (agent mode) and image input (vision).
- API key stored securely in SecretStorage; managed via the `Chutes AI: Manage API Key` command.
- Configurable endpoint, model filter and request timeout.
