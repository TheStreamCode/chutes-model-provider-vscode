# Repository guide for coding agents

## Project overview

This repository contains a TypeScript VS Code extension that exposes Chutes.ai models through the VS Code Language Model Chat Provider API. It also registers the `@chutes` chat participant for account usage and quota summaries.

The extension is bundled as CommonJS for the desktop extension host. It has no production npm dependencies; VS Code provides the `vscode` module at runtime.

## Architecture

- `src/extension.ts`: activation, commands, provider registration, and configuration invalidation.
- `src/provider.ts`: VS Code provider implementation, model cache, streaming responses, and tool-call assembly.
- `src/chutesClient.ts`: OpenAI-compatible model and chat-completion HTTP client.
- `src/messageConverter.ts`: VS Code-to-OpenAI message and tool conversion.
- `src/modelMapping.ts`: catalogue filtering and VS Code model metadata.
- `src/secrets.ts`: API-key access through VS Code `SecretStorage`.
- `src/chatParticipant.ts`: `@chutes` usage and quota output.
- `src/usage/`: account API client and normalization of loosely shaped API payloads.
- `test/unit.test.ts`: offline unit and regression tests using `test/vscode-stub.cjs`.
- `test/harness.ts`: optional live integration harness; it requires `CHUTES_KEY` and makes billable-capable network requests.

## Required workflow

Use Node.js 22 or newer and npm with the committed `package-lock.json`.

```bash
npm ci
npm run check
```

Useful focused commands:

- `npm test`: offline unit tests.
- `npm run lint`: strict TypeScript, Oxlint, and formatting validation.
- `npm run check-types`: focused strict TypeScript validation.
- `npm run format:check`: formatting verification.
- `npm run format`: apply formatting.
- `npm run compile`: development bundle with source maps.
- `npm run package`: production bundle.
- `npm run vsix`: build an installable VSIX.

Do not edit generated `dist/`, `out/`, `test/*.cjs`, or `*.vsix` files. Do not run `npm run test:live` unless the user explicitly wants a live Chutes test and `CHUTES_KEY` is already available in the environment.

## Code and test standards

- Keep strict TypeScript types at network boundaries; treat all API payloads as untrusted runtime data.
- Preserve cancellation from VS Code through every network request and stream.
- Fail closed on malformed tool calls instead of invoking a tool with guessed arguments.
- Add an offline regression test for every correctness fix or parser edge case.
- Keep provider/model logic independent where practical so it remains testable without launching VS Code.
- Match the existing 2-space, LF, single-quote style and run `npm run format` after edits.

## Security and privacy

- Never log or persist API keys, prompt content, attachments, account payloads, or tool arguments.
- Store credentials only through `SecretStore`/VS Code `SecretStorage`.
- Document every new outbound endpoint and explain when prompts, attachments, or credentials are sent to it.
- Treat custom endpoints as a deliberate trust-boundary change and keep their behavior visible in the README and settings copy.
- Keep GitHub Actions permissions minimal and pin third-party actions to full commit SHAs.

## Documentation and releases

When behavior or settings change, update `README.md`, the relevant file under `docs/`, and `CHANGELOG.md`. For a release, keep the version synchronized in `package.json`, `package-lock.json`, and `CITATION.cff`, then verify the VSIX contents before tagging. Do not publish, push, tag, or create a GitHub release unless the user explicitly requests it.

Keep changes focused, preserve unrelated work in a dirty tree, and use Conventional Commit-style subjects when a commit is requested.
