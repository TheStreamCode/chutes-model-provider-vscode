# Change Log

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
