# Change Log

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
