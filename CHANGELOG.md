# Change Log

## 0.1.0

- Initial release.
- Registers Chutes.ai as a VS Code language model provider.
- Automatic discovery of all chat models from `GET /v1/models`.
- Streaming chat responses, tool calling (agent mode) and image input (vision).
- API key stored securely in SecretStorage; managed via the `Chutes AI: Manage API Key` command.
- Configurable endpoint, model filter and request timeout.
