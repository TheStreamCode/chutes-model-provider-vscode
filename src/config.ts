import * as vscode from 'vscode';

export const DEFAULT_ENDPOINT = 'https://llm.chutes.ai/v1';

export interface ChutesConfig {
  /** Base URL of the OpenAI-compatible API, without a trailing slash. */
  endpoint: string;
  /** Raw user filter expression (comma-separated terms / regex). Empty = no filtering. */
  modelFilter: string;
  /** Timeout in milliseconds for the model-list request. */
  requestTimeoutMs: number;
}

/**
 * Reads the current `chutes.*` settings. Called fresh on each use so changes in
 * the Settings UI take effect without reloading the window.
 */
export function getConfig(): ChutesConfig {
  const cfg = vscode.workspace.getConfiguration('chutes');
  const endpoint = (cfg.get<string>('endpoint') || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  return {
    endpoint: endpoint || DEFAULT_ENDPOINT,
    modelFilter: (cfg.get<string>('modelFilter') || '').trim(),
    requestTimeoutMs: cfg.get<number>('requestTimeoutMs') ?? 15000
  };
}
