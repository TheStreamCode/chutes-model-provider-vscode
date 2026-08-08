import * as vscode from 'vscode';
import { SecretStore } from './secrets';
import { ChutesClient, ChutesApiError } from './chutesClient';
import { getConfig } from './config';
import { isChatModel, applyUserFilter, toChatInformation, autoRouterInfo, AUTO_MODEL_ID } from './modelMapping';
import { convertMessages, convertTools, convertToolMode, messageToText } from './messageConverter';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TOOL_CALLS = 64;
const MAX_TOOL_CALL_ID_CHARS = 512;
const MAX_TOOL_NAME_CHARS = 256;
const MAX_TOOL_ARGUMENT_CHARS = 1024 * 1024;

/** Sampling parameters we forward from VS Code's modelOptions to the Chutes API. */
const PASSTHROUGH_OPTIONS = [
  'temperature',
  'top_p',
  'top_k',
  'max_tokens',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'stop',
  'seed'
];

export class ChutesChatModelProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changed.event;

  private cache?: { at: number; models: vscode.LanguageModelChatInformation[] };
  private cacheGeneration = 0;
  private pendingKeyPrompt?: Thenable<string | undefined>;

  constructor(
    private readonly secrets: SecretStore,
    private readonly client: ChutesClient
  ) {}

  /** Drops the cached model list and asks VS Code to re-query. */
  invalidate(): void {
    this.cacheGeneration++;
    this.cache = undefined;
    this.changed.fire();
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) {
      return [];
    }
    let apiKey = await this.secrets.get();
    if (!apiKey) {
      if (options.silent) {
        return [];
      }
      // User-initiated (e.g. the user picked Chutes in "Manage Models"): let them
      // enter a key right now. This opens every time it is needed — never suppressed.
      apiKey = await this.requestApiKey();
      if (!apiKey) {
        return [];
      }
    }

    if (token.isCancellationRequested) {
      return [];
    }

    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.models;
    }

    const generation = this.cacheGeneration;
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const cfg = getConfig();
      const raw = await this.client.listModels(apiKey, controller.signal);
      if (token.isCancellationRequested || generation !== this.cacheGeneration) {
        return [];
      }
      const models = applyUserFilter(
        raw.filter((candidate) => candidate.id !== AUTO_MODEL_ID).filter(isChatModel),
        cfg.modelFilter
      )
        .map(toChatInformation)
        .sort((a, b) => a.id.localeCompare(b.id));
      // Pin the virtual "Auto" entry at the top so it is easy to find in the picker.
      const withAuto = cfg.autoRouterEnabled ? [autoRouterInfo(), ...models] : models;
      this.cache = { at: Date.now(), models: withAuto };
      return withAuto;
    } catch (err) {
      if (controller.signal.aborted || token.isCancellationRequested || generation !== this.cacheGeneration) {
        return [];
      }
      if (!options.silent) {
        const msg = err instanceof ChutesApiError ? err.message : String(err);
        void vscode.window.showErrorMessage(`Chutes AI: could not load models. ${msg}`);
      }
      return [];
    } finally {
      cancellation.dispose();
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (token.isCancellationRequested) {
      return;
    }
    const apiKey = await this.secrets.get();
    if (!apiKey) {
      throw new Error('Chutes AI: no API key configured. Run "Chutes AI: Manage API Key".');
    }
    if (token.isCancellationRequested) {
      return;
    }

    // The virtual "Auto" model routes to Chutes' native router endpoint instead of
    // the configured one; everything else (OpenAI-compatible body, SSE) is identical.
    const isAuto = model.id === AUTO_MODEL_ID;
    const endpointOverride = isAuto ? getConfig().routerEndpoint : undefined;

    const body: Record<string, unknown> = {
      model: model.id,
      messages: convertMessages(messages)
    };

    const tools = convertTools(options.tools);
    if (tools) {
      body.tools = tools;
      body.tool_choice = convertToolMode(options.toolMode);
    }

    if (options.modelOptions) {
      for (const key of PASSTHROUGH_OPTIONS) {
        if (key in options.modelOptions) {
          body[key] = options.modelOptions[key];
        }
      }
    }

    const controller = new AbortController();
    if (token.isCancellationRequested) {
      controller.abort();
    }
    const cancel = token.onCancellationRequested(() => controller.abort());

    // Tool-call fragments arrive split across deltas, keyed by index; assemble then emit.
    const toolCalls = new Map<number, { id?: string; type?: string; name?: string; args: string }>();
    const availableToolNames = new Set(options.tools?.map((tool) => tool.name) ?? []);

    try {
      for await (const delta of this.client.streamChatCompletion(apiKey, body, controller.signal, endpointOverride)) {
        if (token.isCancellationRequested) {
          break;
        }
        if (delta.toolCallError) {
          throw new Error(`Chutes AI: ${delta.toolCallError} returned by the model.`);
        }
        if (delta.content) {
          progress.report(new vscode.LanguageModelTextPart(delta.content));
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index >= MAX_TOOL_CALLS || (!toolCalls.has(tc.index) && toolCalls.size >= MAX_TOOL_CALLS)) {
              throw new Error(`Chutes AI: response exceeded the ${MAX_TOOL_CALLS}-tool-call limit.`);
            }
            const current = toolCalls.get(tc.index) ?? { args: '' };
            if (tc.id !== undefined) {
              if (!tc.id || tc.id.length > MAX_TOOL_CALL_ID_CHARS || (current.id && current.id !== tc.id)) {
                throw new Error('Chutes AI: malformed tool call id returned by the model.');
              }
              current.id = tc.id;
            }
            if (tc.type !== undefined) {
              if (tc.type !== 'function' || (current.type && current.type !== tc.type)) {
                throw new Error('Chutes AI: unsupported tool call type returned by the model.');
              }
              current.type = tc.type;
            }
            if (tc.function?.name !== undefined) {
              if (
                !tc.function.name ||
                tc.function.name.length > MAX_TOOL_NAME_CHARS ||
                (current.name && current.name !== tc.function.name)
              ) {
                throw new Error('Chutes AI: malformed tool name returned by the model.');
              }
              current.name = tc.function.name;
            }
            if (tc.function?.arguments !== undefined) {
              if (current.args.length + tc.function.arguments.length > MAX_TOOL_ARGUMENT_CHARS) {
                throw new Error('Chutes AI: tool arguments exceeded the supported size limit.');
              }
              current.args += tc.function.arguments;
            }
            toolCalls.set(tc.index, current);
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted || token.isCancellationRequested) {
        return; // user-initiated cancellation
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      cancel.dispose();
    }

    // A cancelled stream leaves tool-call fragments half-assembled. Emitting them would
    // either throw on truncated JSON or ask VS Code to run a tool the user just stopped.
    if (token.isCancellationRequested || controller.signal.aborted) {
      return;
    }

    for (const [index, call] of Array.from(toolCalls.entries()).sort(([a], [b]) => a - b)) {
      if (!call.id || call.type !== 'function' || !call.name) {
        throw new Error(`Chutes AI: incomplete tool call returned at index ${index}.`);
      }
      if (!availableToolNames.has(call.name)) {
        throw new Error(`Chutes AI: unavailable tool "${call.name}" requested by the model.`);
      }
      let input: unknown = {};
      try {
        input = call.args ? JSON.parse(call.args) : {};
      } catch {
        throw new Error(`Chutes AI: invalid arguments returned for tool "${call.name}".`);
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error(`Chutes AI: non-object arguments returned for tool "${call.name}".`);
      }
      progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, input));
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const str = typeof text === 'string' ? text : messageToText(text);
    // Heuristic estimate (~4 characters per token); sufficient for context budgeting.
    return Math.ceil(str.length / 4);
  }

  dispose(): void {
    this.changed.dispose();
  }

  /** Opens the API-key input box, deduping concurrent calls, and stores a valid key. */
  private async requestApiKey(): Promise<string | undefined> {
    if (!this.pendingKeyPrompt) {
      this.pendingKeyPrompt = vscode.window.showInputBox({
        title: 'Chutes AI API key',
        prompt: 'Paste your Chutes API key (starts with "cpk_"). Get one at https://chutes.ai',
        placeHolder: 'cpk_...',
        password: true,
        ignoreFocusOut: true
      });
    }
    let value: string | undefined;
    try {
      value = await this.pendingKeyPrompt;
    } finally {
      this.pendingKeyPrompt = undefined;
    }
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    await this.secrets.set(trimmed);
    return trimmed;
  }
}
