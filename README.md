# Chutes AI — Chat Model Provider for VS Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/mikesoft.chutes-model-provider-vscode?label=Marketplace&color=6366F1)](https://marketplace.visualstudio.com/items?itemName=mikesoft.chutes-model-provider-vscode)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/mikesoft.chutes-model-provider-vscode?color=0EA5E9)](https://marketplace.visualstudio.com/items?itemName=mikesoft.chutes-model-provider-vscode)
[![CI](https://github.com/TheStreamCode/chutes-model-provider-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/chutes-model-provider-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-TheStreamCode-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/TheStreamCode)

Bring [Chutes.ai](https://chutes.ai) models — DeepSeek, Qwen, GLM, Kimi and many more — into **VS Code Chat**. The extension registers Chutes as a native language model provider: the full model catalogue is discovered automatically and appears in the chat model picker, with streaming, tool calling (agent mode) and vision.

> Unofficial, community-built extension. Not affiliated with or endorsed by Chutes.

## Features

- **Automatic model discovery** — the model list is fetched from the Chutes API; nothing to maintain by hand.
- **Native chat integration** — models appear in the picker for **Ask**, **Edit** and **Agent** modes. Works without a GitHub Copilot plan.
- **Tool calling / agent mode** — tool-capable models are usable in agent mode (VS Code only offers tool-capable models there).
- **Vision** — models that accept image input can read images attached to a chat.
- **Streaming** — responses stream token by token and honour cancellation.
- **Secure key storage** — your API key lives in VS Code SecretStorage (OS keychain), never in settings.
- **Configurable filtering** — narrow the picker to just the models you care about.

## Requirements

- **VS Code 1.104 or newer** (the language model provider API). VS Code **1.125+** additionally lets you discover this extension from the *Language Models* editor via **Install Model Providers**.
- A **Chutes API key** (starts with `cpk_`). Create one at [chutes.ai](https://chutes.ai).

## Installation

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=mikesoft.chutes-model-provider-vscode), or from the Extensions view:

```
ext install mikesoft.chutes-model-provider-vscode
```

## Getting started

1. Install the extension.
2. Run **`Chutes AI: Manage API Key`** from the Command Palette (or open the chat model picker → *Manage Language Models* → **Chutes AI** → Manage) and paste your `cpk_…` key.
3. Open Chat, click the model picker, and pick a Chutes model.

## Commands

| Command | Description |
| --- | --- |
| `Chutes AI: Manage API Key` | Set, update or clear your API key. |
| `Chutes AI: Refresh Models` | Re-fetch the model list (e.g. after Chutes adds models). |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `chutes.endpoint` | `https://llm.chutes.ai/v1` | OpenAI-compatible API base URL. Change only for self-hosted or proxy endpoints. |
| `chutes.modelFilter` | _(empty)_ | Restrict which models appear. Comma-separated terms matched against the model id as a case-insensitive substring or regex (e.g. `deepseek, qwen` or `Qwen3.*TEE`). Empty shows all chat models. |
| `chutes.requestTimeoutMs` | `15000` | Timeout (ms) for fetching the model list. Does not limit streaming responses. |

## How it works

The extension implements VS Code's finalized `LanguageModelChatProvider` API and talks to the Chutes OpenAI-compatible endpoints (`GET /v1/models`, `POST /v1/chat/completions`). Capabilities (tool calling, image input, context window) are mapped per model from the API metadata. It does not require or bundle GitHub Copilot.

## Known limitations

- **Chat models only.** Image-generation, embedding and audio models are filtered out because VS Code Chat uses text chat/completions.
- **Agent mode shows tool-capable models only.** This is enforced by VS Code, not the extension.
- **Reasoning models.** Models that emit chain-of-thought (e.g. some DeepSeek/Qwen variants) stream their `<think>…</think>` text inline; it is passed through as-is.

## Privacy

Your prompts and attachments are sent to the Chutes API to generate responses — that is the purpose of the extension. The API key is stored in VS Code SecretStorage and is never written to settings or logs. The extension collects no telemetry, analytics, or personal data.

## Documentation

- [User guide](docs/user-guide.md)
- [Troubleshooting](docs/troubleshooting.md)

## Support the project

If this extension is useful to you, consider sponsoring development: [github.com/sponsors/TheStreamCode](https://github.com/sponsors/TheStreamCode).

## License

MIT
