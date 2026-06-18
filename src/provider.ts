import * as vscode from 'vscode';
import { SecretStore } from './secrets';
import { ChutesClient, ChutesApiError } from './chutesClient';
import { getConfig } from './config';
import { isChatModel, applyUserFilter, toChatInformation } from './modelMapping';
import { convertMessages, convertTools, convertToolMode, messageToText } from './messageConverter';

const CACHE_TTL_MS = 5 * 60 * 1000;

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
  private prompted = false;

  constructor(
    private readonly secrets: SecretStore,
    private readonly client: ChutesClient
  ) {}

  /** Drops the cached model list and asks VS Code to re-query. */
  invalidate(): void {
    this.cache = undefined;
    this.prompted = false;
    this.changed.fire();
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = await this.secrets.get();
    if (!apiKey) {
      if (!options.silent && !this.prompted) {
        this.prompted = true;
        void this.promptForKey();
      }
      return [];
    }

    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.models;
    }

    try {
      const raw = await this.client.listModels(apiKey);
      const filter = getConfig().modelFilter;
      const models = applyUserFilter(raw.filter(isChatModel), filter)
        .map(toChatInformation)
        .sort((a, b) => a.id.localeCompare(b.id));
      this.cache = { at: Date.now(), models };
      return models;
    } catch (err) {
      if (!options.silent) {
        const msg = err instanceof ChutesApiError ? err.message : String(err);
        void vscode.window.showErrorMessage(`Chutes AI: could not load models. ${msg}`);
      }
      return [];
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await this.secrets.get();
    if (!apiKey) {
      throw new Error('Chutes AI: no API key configured. Run "Chutes AI: Manage API Key".');
    }

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
    const cancel = token.onCancellationRequested(() => controller.abort());

    // Tool-call fragments arrive split across deltas, keyed by index; assemble then emit.
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    try {
      for await (const delta of this.client.streamChatCompletion(apiKey, body, controller.signal)) {
        if (token.isCancellationRequested) {
          break;
        }
        if (delta.content) {
          progress.report(new vscode.LanguageModelTextPart(delta.content));
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const current = toolCalls.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) {
              current.id = tc.id;
            }
            if (tc.function?.name) {
              current.name = tc.function.name;
            }
            if (tc.function?.arguments) {
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

    for (const call of toolCalls.values()) {
      if (!call.name) {
        continue;
      }
      let input: object = {};
      try {
        input = call.args ? JSON.parse(call.args) : {};
      } catch {
        input = {};
      }
      progress.report(new vscode.LanguageModelToolCallPart(call.id || call.name, call.name, input));
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

  private async promptForKey(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'Chutes AI: configure your API key to use Chutes models in chat.',
      'Configure'
    );
    if (choice === 'Configure') {
      await vscode.commands.executeCommand('chutes.manage');
    }
  }
}
