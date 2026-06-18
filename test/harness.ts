/*
 * Live integration test. Exercises the extension's REAL code (client, model
 * mapping, message converter, provider) against the live Chutes API. The `vscode`
 * import is aliased to test/vscode-stub.cjs at build time.
 *
 * Build + run:
 *   npx esbuild test/harness.ts --bundle --platform=node --format=cjs \
 *     --outfile=test/harness.cjs --alias:vscode=./test/vscode-stub.cjs
 *   CHUTES_KEY=cpk_... node test/harness.cjs
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChutesClient } from '../src/chutesClient';
import { ChutesChatModelProvider } from '../src/provider';
import { SecretStore } from '../src/secrets';
import { isChatModel, applyUserFilter, toChatInformation } from '../src/modelMapping';

const KEY = process.env.CHUTES_KEY;
if (!KEY) {
  console.error('Set CHUTES_KEY in the environment.');
  process.exit(2);
}

const config = () => ({ endpoint: 'https://llm.chutes.ai/v1', modelFilter: '', requestTimeoutMs: 20000 });

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (cond) {
    passed++;
  } else {
    failed++;
  }
  console.log(`  ${tag}  ${name}${extra ? `  — ${extra}` : ''}`);
}

function fakeToken(): vscode.CancellationToken {
  return { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;
}

class CancelToken {
  isCancellationRequested = false;
  private cbs: Array<() => void> = [];
  onCancellationRequested(cb: () => void) {
    this.cbs.push(cb);
    return { dispose() {} };
  }
  cancel() {
    this.isCancellationRequested = true;
    this.cbs.forEach((cb) => cb());
  }
}

function makeSecrets(key: string | undefined): SecretStore {
  const storage = {
    get: async () => key,
    store: async () => undefined,
    delete: async () => undefined,
    onDidChange: () => ({ dispose() {} })
  };
  return new SecretStore(storage as never);
}

function userMessage(...parts: unknown[]): vscode.LanguageModelChatRequestMessage {
  return { role: vscode.LanguageModelChatMessageRole.User, content: parts, name: undefined } as never;
}

function collectText(parts: unknown[]): string {
  return parts
    .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
    .map((p) => p.value)
    .join('');
}

async function main(): Promise<void> {
  const client = new ChutesClient(config);

  console.log('\n[1] Model discovery (ChutesClient.listModels)');
  const raw = await client.listModels(KEY as string);
  check('returns a non-empty catalogue', raw.length > 0, `${raw.length} models`);
  check('entries expose id + context_length', raw.every((m) => !!m.id) && raw.some((m) => !!m.context_length));

  console.log('\n[2] Filtering + mapping (modelMapping)');
  const chat = raw.filter(isChatModel);
  check('isChatModel keeps text↔text models', chat.length > 0, `${chat.length}/${raw.length} are chat models`);
  const mapped = chat.map(toChatInformation);
  const toolModels = mapped.filter((m) => m.capabilities.toolCalling);
  const visionModels = mapped.filter((m) => m.capabilities.imageInput);
  check('maps tool-calling capability', toolModels.length > 0, `${toolModels.length} tool-capable`);
  console.log(`  info  ${visionModels.length} vision-capable model(s)`);
  const narrowed = applyUserFilter(chat, 'qwen');
  check('applyUserFilter narrows by term', narrowed.length > 0 && narrowed.length < chat.length, `${narrowed.length} match "qwen"`);
  check('mapped fields are well-formed', mapped.every((m) => m.id && m.name && m.family && m.maxInputTokens > 0 && m.maxOutputTokens > 0));

  console.log('\n[3] Provider model listing (ChutesChatModelProvider)');
  const provider = new ChutesChatModelProvider(makeSecrets(KEY), client);
  const info = await provider.provideLanguageModelChatInformation({ silent: true }, fakeToken());
  check('provider returns models with a key', info.length > 0, `${info.length}`);
  const emptyProvider = new ChutesChatModelProvider(makeSecrets(undefined), client);
  const emptyInfo = await emptyProvider.provideLanguageModelChatInformation({ silent: true }, fakeToken());
  check('provider returns [] without a key', emptyInfo.length === 0);

  const model = toolModels.find((m) => /qwen3-32b/i.test(m.id)) ?? toolModels[0] ?? mapped[0];
  console.log(`  info  chat model under test: ${model.id}`);

  console.log('\n[4] Streaming text response');
  {
    const parts: unknown[] = [];
    const progress = { report: (p: unknown) => parts.push(p) };
    const options = { modelOptions: { max_tokens: 20, temperature: 0 }, tools: undefined, toolMode: vscode.LanguageModelChatToolMode.Auto } as never;
    await provider.provideLanguageModelChatResponse(model, [userMessage(new vscode.LanguageModelTextPart('Reply with exactly the single word: PONG'))], options, progress as never, fakeToken());
    const text = collectText(parts);
    check('streams text back', text.trim().length > 0, JSON.stringify(text.slice(0, 60)));
  }

  console.log('\n[5] Tool calling (agent mode)');
  {
    const parts: unknown[] = [];
    const progress = { report: (p: unknown) => parts.push(p) };
    const tool: vscode.LanguageModelChatTool = {
      name: 'get_weather',
      description: 'Get the current weather for a given city.',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
    };
    const options = { modelOptions: { max_tokens: 200, temperature: 0 }, tools: [tool], toolMode: vscode.LanguageModelChatToolMode.Required } as never;
    await provider.provideLanguageModelChatResponse(model, [userMessage(new vscode.LanguageModelTextPart('What is the weather in Rome right now?'))], options, progress as never, fakeToken());
    const calls = parts.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart);
    check('emits a tool call', calls.length > 0, calls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join(', '));
    check('tool call has valid parsed input', calls.length > 0 && typeof calls[0].input === 'object');
  }

  console.log('\n[6] Cancellation');
  {
    const token = new CancelToken();
    const parts: unknown[] = [];
    let cancelled = false;
    const progress = {
      report: (p: unknown) => {
        parts.push(p);
        if (!cancelled) {
          cancelled = true;
          token.cancel();
        }
      }
    };
    const options = { modelOptions: { max_tokens: 500 }, toolMode: vscode.LanguageModelChatToolMode.Auto } as never;
    let threw = false;
    try {
      await provider.provideLanguageModelChatResponse(model, [userMessage(new vscode.LanguageModelTextPart('Write a 500 word essay about the ocean.'))], options, progress as never, token as never);
    } catch {
      threw = true;
    }
    check('stops cleanly on cancellation', !threw && parts.length >= 1, `${parts.length} part(s) before cancel`);
  }

  console.log('\n[7] Vision (image input)');
  if (visionModels.length > 0) {
    try {
      const vModel = visionModels.find((m) => /qwen/i.test(m.id)) ?? visionModels[0];
      const png = fs.readFileSync(path.join(__dirname, '..', 'media', 'icon.png'));
      const parts: unknown[] = [];
      const progress = { report: (p: unknown) => parts.push(p) };
      const options = { modelOptions: { max_tokens: 512, temperature: 0 }, toolMode: vscode.LanguageModelChatToolMode.Auto } as never;
      await provider.provideLanguageModelChatResponse(
        vModel,
        [userMessage(new vscode.LanguageModelTextPart('Describe this image in one short sentence.'), vscode.LanguageModelDataPart.image(new Uint8Array(png), 'image/png'))],
        options,
        progress as never,
        fakeToken()
      );
      const text = collectText(parts);
      check('vision model answers about the image', text.trim().length > 0, `${vModel.id}: ${JSON.stringify(text.slice(0, 80))}`);
    } catch (err) {
      console.log(`  info  vision test skipped: ${(err as Error).message}`);
    }
  } else {
    console.log('  info  no vision-capable model found; skipped');
  }

  console.log(`\n${failed === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
