# User guide

## 1. Get a Chutes API key

Create an account at [chutes.ai](https://chutes.ai) and generate an API key. Chutes keys start with `cpk_`.

## 2. Configure the extension

Run **`Chutes AI: Manage API Key`** from the Command Palette and paste your key. It is stored in VS Code SecretStorage (the OS keychain) — never in `settings.json`.

You can also reach this from the chat model picker: open the picker, choose **Manage Language Models**, select **Chutes AI**, then **Manage**.

To change or remove the key later, run the same command and choose *Update* or *Clear*.

## 3. Pick a model

Open Chat, click the model dropdown, and select a Chutes model. The list is fetched live from `GET /v1/models` and cached briefly. Run **`Chutes AI: Refresh Models`** to force a refresh.

## Chat modes

- **Ask / Edit** — any Chutes chat model works.
- **Agent mode** — VS Code only offers models that support tool calling. The extension marks each model's capability from the Chutes API, so tool-capable models (most of them) appear automatically.

## Vision

Models that accept image input (the picker marks them via their capabilities) can read images you attach to a chat message.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `chutes.endpoint` | `https://llm.chutes.ai/v1` | OpenAI-compatible API base URL. |
| `chutes.modelFilter` | _(empty)_ | Comma-separated terms (substring or regex) matched against model ids to narrow the picker. Example: `deepseek, qwen` or `Qwen3.*TEE`. |
| `chutes.requestTimeoutMs` | `15000` | Timeout for fetching the model list. |

## Example: limit the picker

If you only want DeepSeek and Qwen models:

```jsonc
// settings.json
"chutes.modelFilter": "deepseek, qwen"
```
