# Repository guide for coding agents

## Project overview

This repository contains a TypeScript VS Code extension that exposes Chutes.ai models through the VS Code Language
Model Chat Provider API. It also registers the `@chutes` chat participant for account usage and quota summaries.

The extension is bundled as CommonJS for the desktop extension host. It has no production npm dependencies; VS Code
provides the `vscode` module at runtime.

**Repository visibility: public.** Assume every change is published under the MIT license, ships to the VS Code
Marketplace and Open VSX, and is read by strangers. Nothing private, customer-specific, or credential-bearing may
enter this repository, its history, or the packaged VSIX.

## Stack and runtime

- TypeScript (strict, `module`/`moduleResolution: node16`, target ES2022), bundled with esbuild to CommonJS.
- **npm is mandatory** — the committed `package-lock.json` is the source of truth. Never add a second package
  manager, a second lockfile, or edit the lockfile by hand.
- Node.js 22 or newer for development and CI. The bundle targets `node20` because that is the runtime shipped by
  the supported VS Code extension host.
- `engines.vscode` is `^1.106.0`, the minimum version that provides the image/data chat-part API used by the
  extension.

## Architecture

- `src/extension.ts`: activation, commands, provider registration, and configuration invalidation.
- `src/provider.ts`: VS Code provider implementation, model cache, streaming responses, and tool-call assembly.
- `src/chutesClient.ts`: OpenAI-compatible model and chat-completion HTTP client.
- `src/messageConverter.ts`: VS Code-to-OpenAI message and tool conversion.
- `src/modelMapping.ts`: catalogue filtering and VS Code model metadata.
- `src/config.ts`: typed read of the `chutes.*` settings, re-read on every use.
- `src/secrets.ts`: API-key access through VS Code `SecretStorage`.
- `src/chatParticipant.ts`: `@chutes` usage and quota output.
- `src/usage/`: account API client and normalization of loosely shaped API payloads.
- `test/unit.test.ts`: offline unit and regression tests using `test/vscode-stub.cjs`.
- `test/harness.ts`: optional live integration harness; it requires `CHUTES_KEY` and makes billable-capable
  network requests.
- `esbuild.js`, `test/build.js`: bundling for the extension and for the test file.
- `docs/`: user guide and troubleshooting. `media/`: icon and Marketplace screenshots.

## Commands

Every command below exists in `package.json`; do not invent others.

| Purpose                      | Command                                      |
| ---------------------------- | -------------------------------------------- |
| Install                      | `npm ci`                                     |
| Full quality gate            | `npm run check`                              |
| Type-check                   | `npm run check-types`                        |
| Lint (code only)             | `npm run lint:code`                          |
| Lint (types + code + format) | `npm run lint`                               |
| Dependency audit             | `npm run audit`                              |
| Format / verify              | `npm run format` / `npm run format:check`    |
| Offline tests                | `npm test`                                   |
| Live tests                   | `npm run test:live` (requires `CHUTES_KEY`)  |
| Dev bundle / watch           | `npm run compile` / `npm run watch`          |
| Production bundle            | `npm run package`                            |
| Package a VSIX               | `npm run vsix`                               |
| Run in the editor            | `F5` in VS Code (Extension Development Host) |

`npm run check` is the gate: strict TypeScript, Oxlint with `--deny-warnings`, Prettier verification, a high-severity
dependency audit, the offline test suite, a production bundle, and `vsce ls` to confirm the VSIX contents.

## Release and publishing

Releases are cut manually; there is no auto-publish workflow, and re-adding one is a deliberate decision for the
maintainer, not an agent.

1. Bump `version` with `npm version --no-git-tag-version <patch|minor|major>` so `package.json` and
   `package-lock.json` stay in sync, then update `version` and `date-released` in `CITATION.cff`.
2. Add a dated `CHANGELOG.md` entry. Only describe changes that are actually in the diff.
3. Run `npm run check`, then `npm run vsix`, and inspect the VSIX file list before shipping. It must contain only
   `dist/extension.js`, `media/icon.png`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, and `CITATION.cff`.
4. Tag `vX.Y.Z` and create the GitHub release.
5. Publish to both registries with the same VSIX: `npx vsce publish` (publisher `mikesoft`, needs a Marketplace
   PAT via `vsce login` or `VSCE_PAT`) and `npx ovsx publish <file>.vsix -p <token>` (`ovsx` is intentionally not
   a project dependency).

Keep the git tag, the GitHub release, the Marketplace version, and the Open VSX version identical. Do not tag,
release, or publish unless the maintainer explicitly asks for it, and never with credentials you created yourself.

`main` is protected: pull request with one approving review, the `build` status check, and linear history. Work on
a branch and open a PR; never force-push and never rewrite history.

## Code and test standards

- Keep strict TypeScript types at network boundaries; treat all API payloads as untrusted runtime data.
- Preserve cancellation from VS Code through every network request and stream, and emit nothing — text or tool
  calls — after cancellation.
- Fail closed on malformed tool calls instead of invoking a tool with guessed arguments.
- Add an offline regression test for every correctness fix or parser edge case, and confirm it fails without the
  fix before committing.
- Keep provider/model logic independent where practical so it remains testable without launching VS Code.
- User-facing strings (commands, settings, picker labels, chat output) are English.
- Match the existing 2-space, LF, single-quote, 120-column style and run `npm run format` after edits.

## Compatibility rules

- No breaking changes without an explicit request: setting ids and defaults, command ids, the `chutes` vendor id,
  the `chutes.usage` participant id, and the `model-router` id for the virtual Auto model are part of the public
  contract and appear in user configuration.
- Do not raise `engines.vscode` unless a newer API is genuinely required, and record the reason in the changelog.
- Removing or renaming a setting requires a major bump and a migration note.

## Generated files and assets

- Never edit `dist/`, `out/`, `test/harness.cjs`, `test/unit.test.cjs`, `*.vsix`, or `package-lock.json` by hand.
  All of them are gitignored or regenerated by the toolchain.
- Do not modify, recolor, resize, re-encode, or rename `media/icon.png` (256x256), `media/icon.svg`, or the
  `media/screenshot-*.png` files. The icon incorporates a third-party mark under the terms described in
  `THIRD_PARTY_NOTICES.md`; the README links the screenshots by absolute raw URL, so paths must stay stable.

## Environment variables and secrets

- The extension itself reads no environment variables. Its only credential is the user's Chutes API key, held in
  VS Code `SecretStorage` through `SecretStore`.
- `CHUTES_KEY` is used exclusively by `npm run test:live`. Never hardcode it, never echo it, and do not run that
  script unless the maintainer asks and the variable is already present in the environment.
- Publishing tokens (`VSCE_PAT`, an Open VSX token) live outside the repository. Never commit them, print them, or
  add them to workflows without an explicit request.

## Security and privacy

- Never log or persist API keys, prompt content, attachments, account payloads, or tool arguments.
- Escape API-provided values before rendering them as Markdown in chat.
- Document every new outbound endpoint and explain when prompts, attachments, or credentials are sent to it.
  Today those are `chutes.endpoint`, `chutes.routerEndpoint`, and `https://api.chutes.ai`.
- Treat custom endpoints as a deliberate trust-boundary change and keep their behavior visible in the README and
  settings copy.
- Keep GitHub Actions permissions minimal and pin third-party actions to full commit SHAs.

## Documentation

When behavior or settings change, update `README.md`, the relevant file under `docs/`, and `CHANGELOG.md`. The
settings tables in `package.json`, `README.md`, and `docs/user-guide.md` must agree. Every documented command must
exist in `package.json`, and every documented link must resolve.

## Definition of done

A change is finished when `npm run check` passes, new behavior has an offline test, documentation and changelog
match the diff, no secret or generated artifact is staged, and the commit subject follows Conventional Commits.
Keep changes focused and preserve unrelated work in a dirty tree.
