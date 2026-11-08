# User guide

## 1. Get a Chutes API key

Create an account at [chutes.ai](https://chutes.ai) and generate an API key. Chutes keys start with `cpk_`.

## 2. Add the provider and enter your key

Open VS Code's Chat view, open the model picker, and choose **Manage Models…** → **Chutes AI**. You are prompted to paste your API key directly. If you dismiss the box, just select **Chutes AI** again — it reopens every time until a key is saved.

You can also run **`Chutes AI: Manage API Key`** from the Command Palette at any time to set, update, or clear the key. The key is stored in VS Code SecretStorage (the OS keychain) — never in `settings.json`.

## 3. Pick a model

Open Chat, click the model dropdown, and select a Chutes model. The list is fetched live from `GET /v1/models` and cached briefly. Run **`Chutes AI: Refresh Models`** to force a refresh.

**Auto (router)** is the first entry. It sends Chutes' native routing alias
`default` (the pool saved at chutes.ai/app → Model Routing). If that alias
cannot resolve, the extension retries once with a live inline pool from the
current catalogue (fastest warm model first) so Auto works without a dashboard
setup. Pick a concrete catalogue id to pin one model.

## Chat modes

- **Ask / Edit** — any Chutes chat model works.
- **Agent mode** — VS Code only offers models that support tool calling. The extension marks each model's capability from the Chutes API; when Chutes omits `supported_features` (non-TEE models), the model is treated as tool-capable, so tool-capable models appear automatically.

## Context windows

Chutes publishes context metadata for TEE models but omits it for some PAYG non-TEE rows. The extension uses curated vendor values for DeepSeek V4.1 Flash and V4 Pro (1M), Qwen3.8 Max, GLM-5.3 and GLM-5.2 Fast (1M), Tencent Hy4 (1M, from the `tencent/Hy4-preview` Hugging Face model card), Qwen3.8-2.4T and Kimi-K2.7 (262k). Other rows without metadata fall back to 32k. A `context_length` returned by the catalogue always wins.

## Vision

Models that accept image input (the picker marks them via their capabilities) can read images you attach to a chat message.

## Usage and billing

Chutes currently bills usage pay-as-you-go and does not offer monthly plans. Run **`Chutes AI: Show Usage`** from the Command Palette to see the 4-hour rate-limit window, the daily request quota, the pay-as-you-go balance, and per-model daily quotas. In agent mode, Copilot can call the `#chutesUsage` and `#chutesQuota` tools for the same data. A pay-as-you-go account does not show a monthly plan price or a monthly cap.

## Request paths and data

| Feature                                       | Destination             | Data sent                                                    |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------ |
| Selected Chutes model                         | `chutes.endpoint`       | API key, conversation, attachments and advertised tool data. |
| **Auto (router)**                             | `chutes.routerEndpoint` | API key, conversation, attachments and advertised tool data. |
| **Chutes AI: Show Usage** and the usage tools | `https://api.chutes.ai` | API key and account usage request.                           |

The API key remains in VS Code SecretStorage. The extension does not log prompts, attachments, account responses or
tool arguments, and it collects no telemetry. Custom endpoints receive the same request data, so configure only
services you trust.

## Settings

| Setting                    | Default                    | Description                                                                                                                                                            |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chutes.endpoint`          | `https://llm.chutes.ai/v1` | OpenAI-compatible API base URL.                                                                                                                                        |
| `chutes.modelFilter`       | _(empty)_                  | Comma-separated terms (substring or safe regex) matched against model ids. Unsafe or invalid regexes are treated literally. Example: `deepseek, qwen` or `Qwen3.*TEE`. |
| `chutes.requestTimeoutMs`  | `15000`                    | Timeout for fetching the model list.                                                                                                                                   |
| `chutes.autoRouterEnabled` | `true`                     | Show the **Auto (router)** model with automatic model selection and fallback.                                                                                          |
| `chutes.routerEndpoint`    | `https://llm.chutes.ai/v1` | OpenAI-compatible endpoint used only by **Auto (router)**; Chutes resolves routing natively on this host.                                                              |

Setting changes refresh the model list immediately. A custom model or router endpoint receives your API key and request content; configure only services you trust.

## Example: limit the picker

If you only want DeepSeek and Qwen models:

```jsonc
// settings.json
"chutes.modelFilter": "deepseek, qwen"
```
