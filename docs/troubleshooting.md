# Troubleshooting

## No Chutes models in the picker

- Make sure an API key is set: run **`Chutes AI: Manage API Key`**.
- Run **`Chutes AI: Refresh Models`** to re-fetch the list.
- Check `chutes.modelFilter` — an over-strict filter can hide everything. Clear it to show all chat models.
- Confirm you are on **VS Code 1.106+**.

## "Could not load models" error

- Verify the key is valid and starts with `cpk_`.
- Verify network access to `https://llm.chutes.ai`.
- If you set a custom `chutes.endpoint`, confirm it is an OpenAI-compatible base URL ending in `/v1`.

## A model is missing from Agent mode

VS Code only lists tool-calling models in agent mode. If a model does not advertise tool support in the Chutes API, it appears only in Ask/Edit modes.

## Auto (router) fails with DEPLOYMENT_NOT_FOUND or "model not found"

Chutes retired the standalone router at `model-router-ten.vercel.app`. Auto now
sends the native alias `default` to `https://llm.chutes.ai/v1` and, if the
account has no routing pool saved at [chutes.ai/app](https://chutes.ai/app)
(Model Routing), steps down once to a live inline pool from the current
catalogue (fastest warm model first).

- If `chutes.routerEndpoint` still points at the old Vercel host, clear the
  setting so it uses the new default (`https://llm.chutes.ai/v1`).
- Update to extension 0.4.6 or later. 0.4.5 and earlier always hit the dead
  deployment.

## Requests fail with HTTP 401 / 403

The API key is missing, invalid, or lacks access to the selected model. Re-run **`Chutes AI: Manage API Key`** and paste a current key.

## Responses include `<think>` text

Some reasoning models stream their chain-of-thought inline. This is the raw model output and is passed through unchanged.

## Image attachments are ignored

Only models with image input support can read images. Pick a vision-capable model.

## A custom endpoint response is rejected

The extension rejects malformed catalogue rows, invalid tool calls and excessively large API or streaming payloads
instead of guessing or processing unbounded data. Check that the endpoint follows the OpenAI-compatible response and
SSE formats, emits valid JSON tool arguments, and terminates each SSE event with a blank line.
