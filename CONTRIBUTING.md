# Contributing

Thanks for your interest in improving Chutes AI — Chat Model Provider.

## Prerequisites

- Node.js 22 or newer
- `npm`
- Visual Studio Code 1.104 or newer

## Development setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the extension:
   ```bash
   npm run compile
   ```
3. Run the unit tests:
   ```bash
   npm test
   ```

## Running the extension locally

1. Open the repository in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. Run `Chutes AI: Manage API Key` and paste a `cpk_…` key, then open Chat and pick a Chutes model.

## Live integration test (optional)

`npm run test:live` exercises the real code against the live Chutes API. It requires a key:

```bash
CHUTES_KEY=cpk_... npm run test:live
```

## Contribution guidelines

- Keep changes focused and minimal; prefer small fixes over broad refactors.
- Match the existing code style (TypeScript strict mode; 2-space indentation, LF).
- Add or update tests for mapping and message-conversion behavior.
- Preserve user privacy. Never log API keys or prompt contents.
- Use `npm` so local development matches the checked-in lockfile and CI.
- Update documentation when user-facing behavior changes.

## Project assets

The Marketplace icon is `media/icon.png` (256x256). The vector source is `media/icon.svg`.

## Pull requests

Before opening a pull request:

1. Run `npm test`.
2. Run `npm run package`.
3. Update `CHANGELOG.md` when the change is user-visible.
4. Update `README.md` or files in `docs/` when setup, behavior, or support guidance changes.
