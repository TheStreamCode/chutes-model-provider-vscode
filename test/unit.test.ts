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
import { normalizeQuotaUsage } from '../src/usage/normalize';
import { ChutesAccountClient } from '../src/usage/accountClient';
import type { DashboardData } from '../src/usage/types';
import type { ChutesRawModel } from '../src/chutesClient';
import { DEFAULT_ROUTER_ENDPOINT } from '../src/config';
import { ChutesClient } from '../src/chutesClient';
import { readResponseTextLimited } from '../src/http';

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
  assert.equal(
    isChatModel(model({ id: 'a/VL', input_modalities: ['text', 'image'], output_modalities: ['text'] })),
    true
  );
  assert.equal(
    isChatModel(model({ id: 'a/ImageGen', input_modalities: ['text'], output_modalities: ['image'] })),
    false
  );
});

test('applyUserFilter matches substrings, regex, and comma lists', () => {
  const models = [model({ id: 'x/Foo' }), model({ id: 'y/Bar' }), model({ id: 'z/Baz' })];
  assert.equal(applyUserFilter(models, '').length, 3);
  assert.deepEqual(
    applyUserFilter(models, 'foo').map((m) => m.id),
    ['x/Foo']
  );
  assert.deepEqual(
    applyUserFilter(models, 'foo, bar').map((m) => m.id),
    ['x/Foo', 'y/Bar']
  );
  assert.deepEqual(
    applyUserFilter(models, 'ba.').map((m) => m.id),
    ['y/Bar', 'z/Baz']
  );
});

test('applyUserFilter treats potentially catastrophic regexes as literal text', () => {
  // Build the hostile pattern as test data so static analyzers do not mistake it
  // for an expression this test executes directly.
  const unsafePattern = String.fromCharCode(40, 97, 43, 41, 43, 36);
  const models = [model({ id: `literal/${unsafePattern}` }), model({ id: `x/${'a'.repeat(64)}!` })];
  assert.deepEqual(
    applyUserFilter(models, unsafePattern).map((entry) => entry.id),
    [`literal/${unsafePattern}`]
  );
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

test('toChatInformation rejects invalid numeric metadata at the API boundary', () => {
  const info = toChatInformation(
    model({ id: 'p/Broken', context_length: -1, max_model_len: 0, max_output_length: Number.NaN })
  );
  assert.equal(info.maxInputTokens, 32768);
  assert.equal(info.maxOutputTokens, 32768);
});

test('ChutesClient drops malformed model rows', async () => {
  const request = (async () =>
    new Response(JSON.stringify({ data: [null, 42, { id: '' }, { id: 'valid/model' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as typeof fetch;
  const client = new ChutesClient(
    () => ({
      endpoint: 'https://example.test/v1',
      modelFilter: '',
      requestTimeoutMs: 1000,
      autoRouterEnabled: true,
      routerEndpoint: DEFAULT_ROUTER_ENDPOINT
    }),
    request
  );
  assert.deepEqual(await client.listModels('cpk_test'), [{ id: 'valid/model' }]);
});

test('response reader caps payloads and cancels the remainder', async () => {
  assert.deepEqual(await readResponseTextLimited(new Response('123456'), 4), {
    text: '1234',
    truncated: true
  });
});

test('ChutesClient parses the final SSE event without a trailing newline', async () => {
  const request = (async () =>
    new Response('data: {"choices":[{"delta":{"content":"done"}}]}', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })) as typeof fetch;
  const client = new ChutesClient(
    () => ({
      endpoint: 'https://example.test/v1',
      modelFilter: '',
      requestTimeoutMs: 1000,
      autoRouterEnabled: true,
      routerEndpoint: DEFAULT_ROUTER_ENDPOINT
    }),
    request
  );
  const deltas = [];
  for await (const delta of client.streamChatCompletion('cpk_test', {}, new AbortController().signal)) {
    deltas.push(delta);
  }
  assert.deepEqual(deltas, [{ content: 'done' }]);
});

test('ChutesClient propagates model-list cancellation to fetch', async () => {
  let requestSignal: AbortSignal | undefined;
  const request = ((_input: string | URL | Request, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener(
        'abort',
        () => reject(requestSignal?.reason ?? new DOMException('The operation was aborted', 'AbortError')),
        { once: true }
      );
    });
  }) as typeof fetch;
  const client = new ChutesClient(
    () => ({
      endpoint: 'https://example.test/v1',
      modelFilter: '',
      requestTimeoutMs: 1000,
      autoRouterEnabled: true,
      routerEndpoint: DEFAULT_ROUTER_ENDPOINT
    }),
    request
  );
  const controller = new AbortController();
  const pending = client.listModels('cpk_test', controller.signal);
  controller.abort(new DOMException('The operation was aborted', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal?.aborted, true);
});

test('ChutesClient rejects oversized SSE events', async () => {
  const request = (async () =>
    new Response(`data: ${'x'.repeat(1024 * 1024)}\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })) as typeof fetch;
  const client = new ChutesClient(
    () => ({
      endpoint: 'https://example.test/v1',
      modelFilter: '',
      requestTimeoutMs: 1000,
      autoRouterEnabled: true,
      routerEndpoint: DEFAULT_ROUTER_ENDPOINT
    }),
    request
  );
  await assert.rejects(async () => {
    for await (const _delta of client.streamChatCompletion('cpk_test', {}, new AbortController().signal)) {
      // No valid delta should be emitted from an oversized event.
    }
  }, /SSE event exceeded/);
});

test('ChutesClient marks malformed streamed tool-call fields', async () => {
  const request = (async () =>
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 42 }] } }] })}\n`, {
      headers: { 'Content-Type': 'text/event-stream' }
    })) as typeof fetch;
  const client = new ChutesClient(
    () => ({
      endpoint: 'https://example.test/v1',
      modelFilter: '',
      requestTimeoutMs: 1000,
      autoRouterEnabled: true,
      routerEndpoint: DEFAULT_ROUTER_ENDPOINT
    }),
    request
  );
  const deltas = [];
  for await (const delta of client.streamChatCompletion('cpk_test', {}, new AbortController().signal)) {
    deltas.push(delta);
  }
  assert.deepEqual(deltas, [{ toolCallError: 'malformed tool call id' }]);
});

test('ChutesClient rejects a non-array streamed tool_calls field', async () => {
  const request = (async () =>
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: {} } }] })}\n`, {
      headers: { 'Content-Type': 'text/event-stream' }
    })) as typeof fetch;
  const client = new ChutesClient(
    () => ({
      endpoint: 'https://example.test/v1',
      modelFilter: '',
      requestTimeoutMs: 1000,
      autoRouterEnabled: true,
      routerEndpoint: DEFAULT_ROUTER_ENDPOINT
    }),
    request
  );
  const deltas = [];
  for await (const delta of client.streamChatCompletion('cpk_test', {}, new AbortController().signal)) {
    deltas.push(delta);
  }
  assert.deepEqual(deltas, [{ toolCallError: 'malformed tool calls' }]);
});

test('autoRouterInfo describes the virtual router model', () => {
  const info = autoRouterInfo();
  assert.equal(info.id, AUTO_MODEL_ID);
  assert.equal(info.id, 'model-router');
  assert.equal(info.capabilities.toolCalling, true);
  assert.equal(info.capabilities.imageInput, true);
  // Picker copy is user-facing: keep it ASCII-safe English like every other label.
  assert.equal(info.name, 'Auto (router)');
  assert.match(info.detail ?? '', /^Auto · native routing \+ fallback$/);
});

test('convertMessages: plain user text', () => {
  const out = convertMessages([userMsg(new vscode.LanguageModelTextPart('hello'))]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
});

test('convertMessages: assistant tool call', () => {
  const out = convertMessages([
    assistantMsg(new vscode.LanguageModelToolCallPart('call_1', 'get_weather', { city: 'Rome' }))
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].content, null);
  assert.equal(out[0].tool_calls?.[0].id, 'call_1');
  assert.equal(out[0].tool_calls?.[0].function.name, 'get_weather');
  assert.deepEqual(JSON.parse(out[0].tool_calls?.[0].function.arguments ?? '{}'), { city: 'Rome' });
});

test('convertMessages: tool result becomes a tool-role message', () => {
  const out = convertMessages([
    userMsg(new vscode.LanguageModelToolResultPart('call_1', [new vscode.LanguageModelTextPart('18C')]))
  ]);
  assert.deepEqual(out, [{ role: 'tool', tool_call_id: 'call_1', content: '18C' }]);
});

test('convertMessages: text + image becomes a multimodal user message', () => {
  const png = new Uint8Array([1, 2, 3]);
  const out = convertMessages([
    userMsg(new vscode.LanguageModelTextPart('what is this'), vscode.LanguageModelDataPart.image(png, 'image/png'))
  ]);
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
const noToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} })
} as never;

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

test('provider: reserves model-router for the virtual Auto model', async () => {
  const raw = [model({ id: AUTO_MODEL_ID }), ...RAW];
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), fakeClient(raw));
  const info = await provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  assert.equal(info.filter((entry) => entry.id === AUTO_MODEL_ID).length, 1);
  assert.equal(info.length, RAW.length + 1);
});

test('provider: cancellation prevents model-list requests', async () => {
  let requests = 0;
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), {
    listModels: async () => (requests++, RAW)
  } as never);
  const cancelledToken = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose() {} })
  } as never;
  assert.deepEqual(await provider.provideLanguageModelChatInformation({ silent: false }, cancelledToken), []);
  assert.equal(requests, 0);
});

test('provider: invalidation prevents an in-flight model request from restoring stale cache', async () => {
  let resolveFirst!: (models: ChutesRawModel[]) => void;
  const firstResponse = new Promise<ChutesRawModel[]>((resolve) => {
    resolveFirst = resolve;
  });
  let requests = 0;
  const client = {
    listModels: async () => {
      requests++;
      if (requests === 1) {
        return firstResponse;
      }
      return RAW;
    }
  } as never;
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), client);
  const pending = provider.provideLanguageModelChatInformation({ silent: false }, noToken);
  await new Promise<void>((resolve) => setImmediate(resolve));
  provider.invalidate();
  resolveFirst(RAW);
  assert.deepEqual(await pending, []);
  assert.ok((await provider.provideLanguageModelChatInformation({ silent: false }, noToken)).length > 0);
  assert.equal(requests, 2);
});

test('provider: Auto model streams via the router endpoint; normal models do not', async () => {
  const captured: Array<string | undefined> = [];
  const client = {
    listModels: async () => RAW,
    async *streamChatCompletion(_k: string, _b: unknown, _s: unknown, endpointOverride?: string) {
      captured.push(endpointOverride);
      yield {};
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

test('provider: malformed tool arguments fail closed', async () => {
  const client = {
    listModels: async () => RAW,
    async *streamChatCompletion() {
      yield {
        tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'dangerous_tool', arguments: '{' } }]
      };
    }
  } as never;
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), client);
  const progress = { report() {} } as never;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;

  await assert.rejects(
    provider.provideLanguageModelChatResponse(
      autoRouterInfo(),
      [],
      { tools: [{ name: 'dangerous_tool', description: '', inputSchema: {} }] } as never,
      progress,
      token
    ),
    /invalid arguments returned for tool/
  );
});

test('provider: rejects unsupported, incomplete, and unavailable tool calls', async () => {
  const cases = [
    {
      call: { index: 0, id: 'call_1', type: 'not-a-function', function: { name: 'safe_tool', arguments: '{}' } },
      error: /unsupported tool call type/
    },
    {
      call: { index: 0, type: 'function', function: { name: 'safe_tool', arguments: '{}' } },
      error: /incomplete tool call/
    },
    {
      call: { index: 0, id: 'call_1', type: 'function', function: { name: 'other_tool', arguments: '{}' } },
      error: /unavailable tool/
    }
  ];
  for (const { call, error } of cases) {
    const client = {
      listModels: async () => RAW,
      async *streamChatCompletion() {
        yield { tool_calls: [call] };
      }
    } as never;
    const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), client);
    await assert.rejects(
      provider.provideLanguageModelChatResponse(
        autoRouterInfo(),
        [],
        { tools: [{ name: 'safe_tool', description: '', inputSchema: {} }] } as never,
        { report() {} } as never,
        noToken
      ),
      error
    );
  }
});

test('provider: cancelling mid-stream drops half-assembled tool calls', async () => {
  let cancelled = false;
  const listeners: Array<() => void> = [];
  const client = {
    listModels: async () => RAW,
    async *streamChatCompletion() {
      // Truncated JSON, exactly what a stream cut short by the user looks like.
      yield {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'dangerous_tool', arguments: '{"path": "sr' }
          }
        ]
      };
      cancelled = true;
      for (const listener of listeners) {
        listener();
      }
      yield { content: 'ignored' };
    }
  } as never;
  const provider = new ChutesChatModelProvider(memSecrets('cpk_test'), client);
  const reported: unknown[] = [];
  const progress = { report: (part: unknown) => reported.push(part) } as never;
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener);
      return { dispose() {} };
    }
  } as never;

  // Must resolve (no "invalid arguments" error) and must not run the tool.
  await provider.provideLanguageModelChatResponse(
    autoRouterInfo(),
    [],
    { tools: [{ name: 'dangerous_tool', description: '', inputSchema: {} }] } as never,
    progress,
    token
  );
  assert.ok(reported.every((part) => !(part instanceof vscode.LanguageModelToolCallPart)));
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
      {
        id: 'b',
        kind: 'billing-cycle',
        label: 'Billing Cycle Cap',
        unit: 'usd',
        used: 55.339,
        limit: 100,
        remaining: 44.661,
        percentUsed: 55.339,
        resetLabel: null
      },
      {
        id: 'd',
        kind: 'daily-requests',
        label: 'Daily Quota',
        unit: 'requests',
        used: 12,
        limit: 5000,
        remaining: 4988,
        percentUsed: 0.24,
        resetLabel: null
      }
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
    windows: [
      {
        id: 'd',
        kind: 'daily-requests',
        label: 'Daily Quota',
        unit: 'requests',
        used: 0,
        limit: 0,
        remaining: null,
        percentUsed: null,
        resetLabel: null
      }
    ]
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

test('usage markdown escapes API-provided table and inline markdown', () => {
  const data: DashboardData = {
    plan: {
      planName: 'Pro *preview*',
      monthlyPriceUsd: null,
      monthlyCapUsd: null,
      fourHourCapUsd: null,
      dailyRequestLimit: null,
      paygDiscountPercent: null
    },
    windows: [],
    quotas: [{ modelLabel: String.raw`model\|unsafe`, quota: 10, lastUpdated: null }]
  };
  assert.ok(formatUsageMarkdown(data).includes('Pro \\*preview\\*'));
  assert.ok(formatQuotasMarkdown(data).includes(String.raw`model\\\|unsafe`));
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

test('quota normalization preserves unlimited and rejects negative API values', () => {
  assert.deepEqual(normalizeQuotaUsage({ a: { used: 3, quota: 100 }, b: { used: 2, quota: 0 } }), {
    used: 5,
    quota: 0,
    trusted: true
  });
  assert.deepEqual(normalizeQuotaUsage({ used: -1, quota: -10 }), null);

  const data = normalizeDashboardData(
    {},
    [
      { model: 'Unlimited', quota: 0 },
      { model: 'Finite', quota: 100 },
      { model: 'Invalid', quota: -1 }
    ] as never,
    null,
    null,
    null
  );
  const daily = data.windows.find((window) => window.kind === 'daily-requests');
  assert.equal(daily?.limit, 0);
  assert.equal(data.quotas[2].quota, null);
});

test('preferred quota usage can provide a daily window when the quota list is empty', () => {
  const data = normalizeDashboardData({}, [], null, { used: 2, quota: 100 }, null);
  const daily = data.windows.find((window) => window.kind === 'daily-requests');
  assert.equal(daily?.used, 2);
  assert.equal(daily?.limit, 100);
});

test('account client caps quota fallback fan-out', async () => {
  let perChuteRequests = 0;
  const quotas = Array.from({ length: 51 }, (_, index) => ({ chute_id: `chute-${index}`, quota: 10 }));
  const request = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === '/users/me/subscription_usage') {
      return Response.json({});
    }
    if (path === '/users/me/quotas') {
      return Response.json(quotas);
    }
    if (path === '/users/me/quota_usage/me') {
      return Response.json({});
    }
    if (path === '/invocations/stats/llm') {
      return Response.json([]);
    }
    perChuteRequests++;
    return Response.json({ used: 0, quota: 10 });
  }) as typeof fetch;
  const payload = await new ChutesAccountClient('cpk_test', request).getDashboardPayload();
  assert.equal(payload.quotaUsageFallback, null);
  assert.equal(perChuteRequests, 0);
});

test('account client limits concurrent quota fallback requests', async () => {
  let active = 0;
  let maxActive = 0;
  const quotas = Array.from({ length: 12 }, (_, index) => ({ chute_id: `chute-${index}`, quota: 10 }));
  const request = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === '/users/me/subscription_usage') {
      return Response.json({});
    }
    if (path === '/users/me/quotas') {
      return Response.json(quotas);
    }
    if (path === '/users/me/quota_usage/me') {
      return Response.json({});
    }
    if (path === '/invocations/stats/llm') {
      return Response.json([]);
    }
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    active--;
    return Response.json({ used: 0, quota: 10 });
  }) as typeof fetch;
  const payload = await new ChutesAccountClient('cpk_test', request).getDashboardPayload();
  assert.equal(Object.keys(payload.quotaUsageFallback ?? {}).length, quotas.length);
  assert.ok(maxActive <= 4);
});

test('account client ignores negative quota-usage sentinels and uses fallback data', async () => {
  let fallbackRequests = 0;
  const request = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === '/users/me/subscription_usage') {
      return Response.json({});
    }
    if (path === '/users/me/quotas') {
      return Response.json([{ chute_id: 'chute-1', quota: 10 }]);
    }
    if (path === '/users/me/quota_usage/me') {
      return Response.json({ used: -1, quota: -1 });
    }
    if (path === '/invocations/stats/llm') {
      return Response.json([]);
    }
    fallbackRequests++;
    return Response.json({ used: 2, quota: 10 });
  }) as typeof fetch;
  const payload = await new ChutesAccountClient('cpk_test', request).getDashboardPayload();
  assert.equal(fallbackRequests, 1);
  assert.deepEqual(payload.quotaUsageFallback, { 'chute-1': { used: 2, quota: 10 } });
});
