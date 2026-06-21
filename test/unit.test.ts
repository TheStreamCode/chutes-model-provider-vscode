/*
 * Unit tests for the pure logic (model mapping + message conversion). The `vscode`
 * import is aliased to test/vscode-stub.cjs at build time, so these run under
 * `node --test` with no editor and no network. Build + run via `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { isChatModel, applyUserFilter, toChatInformation, autoRouterInfo, AUTO_MODEL_ID } from '../src/modelMapping';
import { convertMessages, convertTools, convertToolMode } from '../src/messageConverter';
import { ChutesChatModelProvider } from '../src/provider';
import { SecretStore } from '../src/secrets';
import { formatUsageMarkdown, formatQuotasMarkdown } from '../src/chatParticipant';
import { normalizeDashboardData } from '../src/usage/normalize';
import type { DashboardData } from '../src/usage/types';
import type { ChutesRawModel } from '../src/chutesClient';
import { DEFAULT_ROUTER_ENDPOINT } from '../src/config';

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

test('autoRouterInfo describes the virtual router model', () => {
  const info = autoRouterInfo();
  assert.equal(info.id, AUTO_MODEL_ID);
  assert.equal(info.id, 'model-router');
  assert.equal(info.capabilities.toolCalling, true);
  assert.equal(info.capabilities.imageInput, true);
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

// --- provider: virtual "Auto" router model (injection + routing) ---

test('provider: lists the Auto model first when enabled (default)', async () => {
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), fakeClient(RAW));
  const info = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  assert.equal(info[0].id, AUTO_MODEL_ID);
  assert.equal(info.length, RAW.length + 1);
});

test('provider: omits the Auto model when autoRouterEnabled is false', async () => {
  const original = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = (() => ({
    get: (key: string) => (key === 'autoRouterEnabled' ? false : undefined)
  })) as never;
  try {
    const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), fakeClient(RAW));
    const info = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
    assert.ok(info.every((m) => m.id !== AUTO_MODEL_ID));
    assert.equal(info.length, RAW.length);
  } finally {
    vscode.workspace.getConfiguration = original;
  }
});

test('provider: Auto model streams via the router endpoint; normal models do not', async () => {
  const captured: Array<string | undefined> = [];
  const client = {
    listModels: async () => RAW,
    async *streamChatCompletion(_k: string, _b: unknown, _s: unknown, endpointOverride?: string) {
      captured.push(endpointOverride);
    }
  } as never;
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), client);
  const progress = { report() {} } as never;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;
  const msgs = [userMsg(new vscode.LanguageModelTextPart('hi'))];

  await provider.provideLanguageModelChatResponse(autoRouterInfo(), msgs, {} as never, progress, token);
  await provider.provideLanguageModelChatResponse(
    toChatInformation(model({ id: 'a/Chat-One' })),
    msgs,
    {} as never,
    progress,
    token
  );

  assert.equal(captured[0], DEFAULT_ROUTER_ENDPOINT);
  assert.equal(captured[1], undefined);
});

// --- usage chat participant: markdown formatting + normalization ---

test('formatUsageMarkdown renders plan and windows table', () => {
  const data: DashboardData = {
    plan: {
      planName: 'Pro',
      monthlyPriceUsd: 20,
      monthlyCapUsd: 100,
      fourHourCapUsd: 8.33,
      dailyRequestLimit: 5000,
      paygDiscountPercent: 10
    },
    windows: [
      { id: 'b', kind: 'billing-cycle', label: 'Billing Cycle Cap', unit: 'usd', used: 55.339, limit: 100, remaining: 44.661, percentUsed: 55.339, resetLabel: null },
      { id: 'd', kind: 'daily-requests', label: 'Daily Quota', unit: 'requests', used: 12, limit: 5000, remaining: 4988, percentUsed: 0.24, resetLabel: null }
    ],
    quotas: []
  };
  const md = formatUsageMarkdown(data);
  assert.match(md, /Chutes usage/);
  assert.match(md, /\*\*Plan:\*\* Pro · \$20\/mo/);
  assert.match(md, /\$55\.34/); // USD formatted to 2 decimals
  assert.match(md, /5,000/); // requests with thousands separator
});

test('formatUsageMarkdown handles empty data and unlimited limits', () => {
  assert.match(formatUsageMarkdown({ plan: null, windows: [], quotas: [] }), /No usage data/);
  const unlimited = formatUsageMarkdown({
    plan: null,
    quotas: [],
    windows: [{ id: 'd', kind: 'daily-requests', label: 'Daily Quota', unit: 'requests', used: 0, limit: 0, remaining: null, percentUsed: null, resetLabel: null }]
  });
  assert.match(unlimited, /Unlimited/);
});

test('formatQuotasMarkdown renders rows, unlimited, and empty state', () => {
  const md = formatQuotasMarkdown({
    plan: null,
    windows: [],
    quotas: [
      { modelLabel: 'All Models', quota: 5000, lastUpdated: null },
      { modelLabel: 'deepseek-ai/DeepSeek-V3', quota: 0, lastUpdated: null }
    ]
  });
  assert.match(md, /All Models/);
  assert.match(md, /5,000/);
  assert.match(md, /Unlimited/);
  assert.match(formatQuotasMarkdown({ plan: null, windows: [], quotas: [] }), /No quota data/);
});

test('normalizeDashboardData parses spend windows and derives the plan', () => {
  const subscriptionUsage = {
    subscription: true,
    custom: false,
    monthly_price: 20,
    billing_cycle_cap: { used: 55.339, limit: 100, remaining: 44.661 },
    four_hour_window: { used: 0, limit: 8.3333, remaining: 8.3333 },
    daily_quota_usage: { used: 0, limit: 5000, remaining: 5000 }
  };
  const quotas = [{ chute_id: '*', quota: 5000, model: 'All Models' }];
  const data = normalizeDashboardData(subscriptionUsage as never, quotas as never, null, null, null);
  assert.equal(data.plan?.planName, 'Pro');
  const billing = data.windows.find((w) => w.kind === 'billing-cycle');
  assert.ok(billing && billing.unit === 'usd');
  assert.ok(Math.abs((billing?.used ?? 0) - 55.339) < 0.001);
  assert.equal(billing?.limit, 100);
  assert.ok(data.windows.some((w) => w.kind === 'daily-requests'));
});
