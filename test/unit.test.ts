/*
 * Unit tests for the pure logic (model mapping + message conversion). The `vscode`
 * import is aliased to test/vscode-stub.cjs at build time, so these run under
 * `node --test` with no editor and no network. Build + run via `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { isChatModel, applyUserFilter, toChatInformation } from '../src/modelMapping';
import { convertMessages, convertTools, convertToolMode } from '../src/messageConverter';
import { ChutesChatModelProvider } from '../src/provider';
import { SecretStore } from '../src/secrets';
import type { ChutesRawModel } from '../src/chutesClient';

function model(partial: Partial<ChutesRawModel> & { id: string }): ChutesRawModel {
  return { input_modalities: ['text'], output_modalities: ['text'], ...partial };
}

function userMsg(...parts: unknown[]): vscode.LanguageModelChatRequestMessage {
  return { role: vscode.LanguageModelChatMessageRole.User, content: parts, name: undefined } as never;
}
function assistantMsg(...parts: unknown[]): vscode.LanguageModelChatRequestMessage {
  return { role: vscode.LanguageModelChatMessageRole.Assistant, content: parts, name: undefined } as never;
}

test('isChatModel keeps text↔text, drops image output', () => {
  assert.equal(isChatModel(model({ id: 'a/Chat' })), true);
  assert.equal(isChatModel(model({ id: 'a/VL', input_modalities: ['text', 'image'], output_modalities: ['text'] })), true);
  assert.equal(isChatModel(model({ id: 'a/ImageGen', input_modalities: ['text'], output_modalities: ['image'] })), false);
});

test('applyUserFilter matches substrings, regex, and comma lists', () => {
  const models = [model({ id: 'x/Foo' }), model({ id: 'y/Bar' }), model({ id: 'z/Baz' })];
  assert.equal(applyUserFilter(models, '').length, 3);
  assert.deepEqual(applyUserFilter(models, 'foo').map((m) => m.id), ['x/Foo']);
  assert.deepEqual(applyUserFilter(models, 'foo, bar').map((m) => m.id), ['x/Foo', 'y/Bar']);
  assert.deepEqual(applyUserFilter(models, 'ba.').map((m) => m.id), ['y/Bar', 'z/Baz']);
});

test('toChatInformation maps fields and capabilities', () => {
  const info = toChatInformation(
    model({
      id: 'deepseek-ai/DeepSeek-V3.2-TEE',
      context_length: 131072,
      max_output_length: 65536,
      supported_features: ['tools', 'reasoning'],
      input_modalities: ['text', 'image'],
      confidential_compute: true,
      pricing: { prompt: 1, completion: 1 }
    })
  );
  assert.equal(info.id, 'deepseek-ai/DeepSeek-V3.2-TEE');
  assert.equal(info.name, 'DeepSeek-V3.2-TEE');
  assert.equal(info.family, 'deepseek-ai');
  assert.equal(info.maxInputTokens, 131072);
  assert.equal(info.maxOutputTokens, 65536);
  assert.equal(info.capabilities.toolCalling, true);
  assert.equal(info.capabilities.imageInput, true);
  assert.match(info.detail ?? '', /ctx/);
});

test('toChatInformation caps output at context and tolerates missing metadata', () => {
  const info = toChatInformation(model({ id: 'p/Tiny', context_length: 8000, max_output_length: 99999 }));
  assert.equal(info.maxOutputTokens, 8000);
  assert.equal(info.capabilities.toolCalling, false);
  assert.equal(info.capabilities.imageInput, false);
});

test('convertMessages: plain user text', () => {
  const out = convertMessages([userMsg(new vscode.LanguageModelTextPart('hello'))]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
});

test('convertMessages: assistant tool call', () => {
  const out = convertMessages([assistantMsg(new vscode.LanguageModelToolCallPart('call_1', 'get_weather', { city: 'Rome' }))]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].content, null);
  assert.equal(out[0].tool_calls?.[0].id, 'call_1');
  assert.equal(out[0].tool_calls?.[0].function.name, 'get_weather');
  assert.deepEqual(JSON.parse(out[0].tool_calls?.[0].function.arguments ?? '{}'), { city: 'Rome' });
});

test('convertMessages: tool result becomes a tool-role message', () => {
  const out = convertMessages([userMsg(new vscode.LanguageModelToolResultPart('call_1', [new vscode.LanguageModelTextPart('18C')]))]);
  assert.deepEqual(out, [{ role: 'tool', tool_call_id: 'call_1', content: '18C' }]);
});

test('convertMessages: text + image becomes a multimodal user message', () => {
  const png = new Uint8Array([1, 2, 3]);
  const out = convertMessages([userMsg(new vscode.LanguageModelTextPart('what is this'), vscode.LanguageModelDataPart.image(png, 'image/png'))]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'user');
  assert.ok(Array.isArray(out[0].content));
  const parts = out[0].content as Array<{ type: string }>;
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].type, 'image_url');
});

test('convertTools maps name/description/schema; empty -> undefined', () => {
  assert.equal(convertTools(undefined), undefined);
  assert.equal(convertTools([]), undefined);
  const tools = convertTools([{ name: 't', description: 'd', inputSchema: { type: 'object' } }]);
  assert.equal(tools?.[0].type, 'function');
  assert.equal(tools?.[0].function.name, 't');
  assert.deepEqual(tools?.[0].function.parameters, { type: 'object' });
});

test('convertToolMode maps Auto/Required', () => {
  assert.equal(convertToolMode(vscode.LanguageModelChatToolMode.Auto), 'auto');
  assert.equal(convertToolMode(vscode.LanguageModelChatToolMode.Required), 'required');
});

// --- provider: API-key prompt behavior (regression for the "prompt only once" bug) ---

function fakeClient(models: ChutesRawModel[]): never {
  return { listModels: async () => models } as never;
}

function memSecrets(initial?: string): SecretStore {
  let value = initial;
  const storage = {
    get: async () => value,
    store: async (_k: string, v: string) => {
      value = v;
    },
    delete: async () => {
      value = undefined;
    },
    onDidChange: () => ({ dispose() {} })
  };
  return new SecretStore(storage as never);
}

const RAW: ChutesRawModel[] = [model({ id: 'a/Chat-One', supported_features: ['tools'], context_length: 8000 })];
const noToken = {} as never;

test('provider: silent + no key returns [] and never prompts', async () => {
  let prompts = 0;
  vscode.window.showInputBox = (async () => {
    prompts++;
    return undefined;
  }) as never;
  const provider = new ChutesChatModelProvider(memSecrets(undefined), fakeClient(RAW));
  const info = await provider.provideLanguageModelChatInformation({ silent: true }, noToken);
  assert.equal(info.length, 0);
  assert.equal(prompts, 0);
});

test('provider: non-silent + no key prompts and loads models, and keeps working on repeated selection', async () => {
  let prompts = 0;
  vscode.window.showInputBox = (async () => {
    prompts++;
    return 'cpk_test';
  }) as never;
  const provider = new ChutesChatModelProvider(memSecrets(undefined), fakeClient(RAW));

  const first = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  assert.ok(first.length > 0);
  assert.equal(prompts, 1);

  // The key is now stored: selecting again must not re-prompt and must still work
  // (this is the regression the "prompt only once" bug broke).
  provider.invalidate();
  const second = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  assert.ok(second.length > 0);
  assert.equal(prompts, 1);
});

test('provider: non-silent + no key prompts AGAIN if the user dismissed the box before', async () => {
  let prompts = 0;
  // First selection: user dismisses the input box (returns undefined).
  vscode.window.showInputBox = (async () => {
    prompts++;
    return undefined;
  }) as never;
  const provider = new ChutesChatModelProvider(memSecrets(undefined), fakeClient(RAW));

  const dismissed = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  assert.equal(dismissed.length, 0);
  assert.equal(prompts, 1);

  // Second selection: the box must open again (the bug suppressed it forever).
  vscode.window.showInputBox = (async () => {
    prompts++;
    return 'cpk_test';
  }) as never;
  const recovered = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  assert.ok(recovered.length > 0);
  assert.equal(prompts, 2);
});

test('provider: concurrent selections are deduped to a single input box', async () => {
  let prompts = 0;
  vscode.window.showInputBox = (async () => {
    prompts++;
    await new Promise((r) => setTimeout(r, 10));
    return 'cpk_test';
  }) as never;
  const provider = new ChutesChatModelProvider(memSecrets(undefined), fakeClient(RAW));
  const [a, b] = await Promise.all([
    provider.provideLanguageModelChatInformation({ silent: false }, noToken),
    provider.provideLanguageModelChatInformation({ silent: false }, noToken)
  ]);
  assert.ok(a.length > 0 && b.length > 0);
  assert.equal(prompts, 1);
});
