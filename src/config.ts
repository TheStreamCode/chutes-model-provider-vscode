import * as vscode from 'vscode';

export const DEFAULT_ENDPOINT = 'https://llm.chutes.ai/v1';
/**
 * Auto routes through the same OpenAI-compatible host: Chutes resolves
 * routing natively from the `model` field, so no separate router deployment
 * exists anymore. The setting stays for custom gateways only.
 */
export const DEFAULT_ROUTER_ENDPOINT = 'https://llm.chutes.ai/v1';

export interface ChutesConfig {
  /** Base URL of the OpenAI-compatible API, without a trailing slash. */
  endpoint: string;
  /** Raw user filter expression (comma-separated terms / regex). Empty = no filtering. */
  modelFilter: string;
  /** Timeout in milliseconds for the model-list request. */
  requestTimeoutMs: number;
  /** Whether to expose the virtual "Chutes Auto" model that delegates to the native router. */
  autoRouterEnabled: boolean;
  /** Base URL of Chutes' native model router (OpenAI-compatible), without a trailing slash. */
  routerEndpoint: string;
}

/**
 * Reads the current `chutes.*` settings. Called fresh on each use so changes in
 * the Settings UI take effect without reloading the window.
 */
export function getConfig(): ChutesConfig {
  const cfg = vscode.workspace.getConfiguration('chutes');
  const endpoint = (cfg.get<string>('endpoint') || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  const routerEndpoint = (cfg.get<string>('routerEndpoint') || DEFAULT_ROUTER_ENDPOINT).trim().replace(/\/+$/, '');
  return {
    endpoint: endpoint || DEFAULT_ENDPOINT,
    modelFilter: (cfg.get<string>('modelFilter') || '').trim(),
    requestTimeoutMs: cfg.get<number>('requestTimeoutMs') ?? 15000,
    autoRouterEnabled: cfg.get<boolean>('autoRouterEnabled') ?? true,
    routerEndpoint: routerEndpoint || DEFAULT_ROUTER_ENDPOINT
  };
}
