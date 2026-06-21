# Chutes AI Provider for GitHub Copilot Chat

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/mikesoft.chutes-model-provider-vscode?label=Marketplace&color=6366F1)](https://marketplace.visualstudio.com/items?itemName=mikesoft.chutes-model-provider-vscode)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/mikesoft.chutes-model-provider-vscode?color=0EA5E9)](https://marketplace.visualstudio.com/items?itemName=mikesoft.chutes-model-provider-vscode)
[![CI](https://github.com/TheStreamCode/chutes-model-provider-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/chutes-model-provider-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-TheStreamCode-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/TheStreamCode)

Leverage [Chutes.ai](https://chutes.ai) open-source models — including DeepSeek, Qwen, GLM and Kimi — directly within VS Code's GitHub Copilot Chat. The full Chutes catalogue is discovered automatically, with streaming, tool calling (agent mode) and vision. **No GitHub Copilot subscription required.**

![Chutes models in the VS Code Language Models editor](https://raw.githubusercontent.com/TheStreamCode/chutes-model-provider-vscode/main/media/screenshot-models.png)

---

## ⚡ Quick Start

1. Install the extension from the VS Code Marketplace.
2. Open VS Code's Chat view.
3. Open the model picker and select **Manage Models…**.
4. Choose **Chutes AI** as the provider.
5. Paste your Chutes API key (starts with `cpk_`, get one at [chutes.ai](https://chutes.ai)).
6. Select the models you want to use. 🎉

You can also set the key anytime via **`Chutes AI: Manage API Key`** in the Command Palette.

## ✨ Features

- **Automatic model discovery** — the full Chutes catalogue is fetched from the API; nothing to maintain by hand.
- **Auto model with fallback** — a virtual **Auto (router)** model delegates selection to Chutes' native router, which picks a model per task and fails over automatically when one is cold or unavailable.
- **Native chat integration** — models appear in **Ask**, **Edit** and **Agent** modes; tool-capable models light up agent mode.
- **Vision** — models that accept image input can read images attached to a chat.
- **Streaming** — responses stream token by token and honour cancellation.
- **Secure key storage** — your API key lives in VS Code SecretStorage (OS keychain), never in settings.
- **Configurable filtering** — narrow the picker to just the models you care about.
- **Usage & spend in chat** — ask `@chutes /usage` in the chat panel to see your Chutes spend and quotas.

![Using a Chutes vision model in VS Code Chat](https://raw.githubusercontent.com/TheStreamCode/chutes-model-provider-vscode/main/media/screenshot-chat.png)

---

## Requirements

- **VS Code 1.104.0 or newer** (the language model provider API). VS Code **1.125+** also lets you discover this extension from the *Language Models* editor via **Install Model Providers**.
- A **Chutes API key** (starts with `cpk_`). Create one at [chutes.ai](https://chutes.ai).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `chutes.endpoint` | `https://llm.chutes.ai/v1` | OpenAI-compatible API base URL. Change only for self-hosted or proxy endpoints. |
| `chutes.modelFilter` | _(empty)_ | Restrict which models appear. Comma-separated terms matched against the model id as a case-insensitive substring or regex (e.g. `deepseek, qwen` or `Qwen3.*TEE`). Empty shows all chat models. |
| `chutes.requestTimeoutMs` | `15000` | Timeout (ms) for fetching the model list. Does not limit streaming responses. |
| `chutes.autoRouterEnabled` | `true` | Show the **Auto (router)** model that delegates selection and automatic cold/unavailable fallback to Chutes' native router. |
| `chutes.routerEndpoint` | `https://model-router-ten.vercel.app/v1` | Base URL of Chutes' native router, used by the **Auto (router)** model. Change only for a self-hosted router. |

## Commands

| Command | Description |
| --- | --- |
| `Chutes AI: Manage API Key` | Set, update or clear your API key. |
| `Chutes AI: Refresh Models` | Re-fetch the model list (e.g. after Chutes adds models). |

## Usage & spend in chat

Type **`@chutes`** in the chat input to check your Chutes account without leaving the editor:

- **`@chutes /usage`** — spend for the current billing windows (monthly cap and 4-hour window) plus your daily request quota.
- **`@chutes /quota`** — per-model quotas.

It uses the same API key you configured for the provider. Note: VS Code does not let third-party providers display live spend inside Copilot's own usage UI, so this surfaces it as an on-demand chat reply.

## Auto model (router)

Pick **Auto (router)** from the model list to stop worrying about which specific model is currently warm. Your prompt is sent to Chutes' native model router, which classifies it (general, reasoning, programming, vision…), routes it to a suitable model, and **fails over automatically** if that model is cold or unavailable. This is handy because models on Chutes warm up and cool down over time, and a cold model can otherwise return an error.

Selection and fallback are performed by Chutes' router, not by this extension. It is enabled by default; turn it off with `chutes.autoRouterEnabled`, or point it at a self-hosted router with `chutes.routerEndpoint`.

## Privacy

Your prompts and attachments are sent to the Chutes API to generate responses — that is the purpose of the extension. The API key is stored in VS Code SecretStorage and is never written to settings or logs. The extension collects no telemetry, analytics, or personal data.

## 🛠️ Development

```bash
git clone https://github.com/TheStreamCode/chutes-model-provider-vscode
cd chutes-model-provider-vscode
npm install
npm run compile
```

Press `F5` to launch an Extension Development Host. Run `npm test` for the unit tests.

## 📚 Resources

- [User guide](docs/user-guide.md) · [Troubleshooting](docs/troubleshooting.md)
- [Chutes documentation](https://chutes.ai/docs)
- [VS Code Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)

## Trademarks

Chutes, the Chutes logo, and related names and marks are trademarks of their respective owner and are used with permission. This extension's own source code is licensed under the MIT License.

## Support & License

- Issues: [GitHub Issues](https://github.com/TheStreamCode/chutes-model-provider-vscode/issues)
- Support the project: [github.com/sponsors/TheStreamCode](https://github.com/sponsors/TheStreamCode)
- MIT License — © 2026 Michael Gasperini (Mikesoft)
