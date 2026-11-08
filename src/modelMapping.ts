import * as vscode from 'vscode';
import { ChutesRawModel } from './chutesClient';

const FALLBACK_CONTEXT = 32768;
const MAX_FILTER_TERM_CHARS = 128;

/** Reserved model id of Chutes' native router; selecting it delegates routing + fallback. */
export const AUTO_MODEL_ID = 'model-router';

/**
 * Model string sent to the API when Auto is selected: Chutes' saved-routing-pool
 * alias, resolved server-side against the pool configured at chutes.ai/app.
 */
export const AUTO_ROUTING_MODEL = 'default';

/**
 * Live inline pool sent when the saved-pool alias does not resolve.
 * Chat-capable catalogue ids, picked by lowest time-to-first-token.
 */
export function liveAutoPoolModel(models: ChutesRawModel[]): string | undefined {
  const ids = models
    .filter(isChatModel)
    .map((entry) => entry.id.trim())
    .filter((id) => id.length > 0 && id !== AUTO_MODEL_ID && id !== AUTO_ROUTING_MODEL && !id.includes(','));
  if (ids.length === 0) {
    return undefined;
  }
  return `${ids.join(',')}:latency`;
}

/**
 * Synthetic descriptor for the virtual "Chutes Auto" model. Selecting it sends the
 * request to Chutes' native router, which classifies the prompt and fails over
 * automatically when a model is cold/unavailable. Context limits are a conservative
 * estimate since the routed target varies per request.
 */
export function autoRouterInfo(): vscode.LanguageModelChatInformation {
  return {
    id: AUTO_MODEL_ID,
    name: 'Auto (router)',
    family: 'Chutes',
    version: '1.0',
    maxInputTokens: 131072,
    maxOutputTokens: FALLBACK_CONTEXT,
    tooltip: 'Chutes native router — automatic model selection + cold/unavailable fallback',
    detail: 'Auto · native routing + fallback',
    capabilities: {
      toolCalling: true,
      imageInput: true
    }
  };
}

/**
 * Keeps only models usable in VS Code chat: text in, text out. Excludes
 * image-generation, embedding and audio models. Since we already query the
 * `llm.chutes.ai` endpoint the list is mostly LLMs — this is a safety net.
 */
export function isChatModel(m: ChutesRawModel): boolean {
  const input = stringArrayOrDefault(m.input_modalities, ['text']);
  const output = stringArrayOrDefault(m.output_modalities, ['text']);
  return input.includes('text') && output.includes('text');
}

/**
 * Applies the user's `chutes.modelFilter`. Each comma-separated term matches the
 * model id as a case-insensitive regex (falling back to substring). A model passes
 * if any term matches. Empty filter = keep all.
 */
export function applyUserFilter(models: ChutesRawModel[], filter: string): ChutesRawModel[] {
  const terms = filter
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) {
    return models;
  }
  const matchers = terms.map((term) => {
    if (isSafeRegex(term)) {
      try {
        const re = new RegExp(term, 'i');
        return (id: string) => re.test(id);
      } catch {
        // Invalid expressions retain the documented substring fallback.
      }
    }
    const lower = term.toLowerCase();
    return (id: string) => id.toLowerCase().includes(lower);
  });
  return models.filter((m) => matchers.some((match) => match(m.id)));
}

/** Conservatively excludes regex constructs that can cause excessive backtracking. */
function isSafeRegex(pattern: string): boolean {
  if (pattern.length > MAX_FILTER_TERM_CHARS || /\\[1-9]/.test(pattern) || pattern.includes('(?')) {
    return false;
  }

  const groups: Array<{ riskyContent: boolean }> = [];
  let escaped = false;
  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      continue;
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) {
      continue;
    }
    if (char === '(') {
      groups.push({ riskyContent: false });
      continue;
    }
    if (char === '|' || char === '*' || char === '+' || char === '{') {
      for (const group of groups) {
        group.riskyContent = true;
      }
      continue;
    }
    if (char === ')' && groups.length > 0) {
      const group = groups.pop();
      const next = pattern[index + 1];
      if (group?.riskyContent && (next === '*' || next === '+' || next === '?' || next === '{')) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Chutes omits supported_features for non-TEE models even though they accept
 * tool calls. Treat unknown metadata as tool-capable and exclude only an
 * explicit feature list that does not include tools.
 */
function supportsToolCalling(m: ChutesRawModel): boolean {
  return !Array.isArray(m.supported_features) || m.supported_features.includes('tools');
}

/**
 * Chutes omits context_length for the PAYG non-TEE rows. These values come from
 * the vendor and models.dev canonical entries (verified 2026-10-31), matching
 * the Chutes Build curated table. Extend only with a checkable source.
 */
function curatedContextWindow(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  if (id.includes('deepseek-v4.1-flash') || id.includes('deepseek-v4-pro-0813')) {
    return 1_048_576;
  }
  if (id.includes('qwen3.8-max')) {
    return 1_000_000;
  }
  if (id.includes('qwen3.8-2.4t')) {
    return 262_144;
  }
  if (id.includes('glm-5.3') || id.includes('glm-5.2-fast')) {
    return 1_000_000;
  }
  if (id.includes('kimi-k2.7')) {
    return 262_144;
  }
  if (id.includes('tencent/hy4') || id.includes('hy4-preview')) {
    return 1_048_576;
  }
  return undefined;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Math.round(tokens / 100_000) / 10}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/** Maps a Chutes model to the VS Code chat model descriptor. */
export function toChatInformation(m: ChutesRawModel): vscode.LanguageModelChatInformation {
  const context =
    positiveInteger(m.context_length) ??
    positiveInteger(m.max_model_len) ??
    curatedContextWindow(m.id) ??
    FALLBACK_CONTEXT;
  const maxOutput = Math.min(positiveInteger(m.max_output_length) ?? FALLBACK_CONTEXT, context);

  const slash = m.id.lastIndexOf('/');
  const family = slash > 0 ? m.id.slice(0, slash) : 'chutes';
  const name = slash > 0 ? m.id.slice(slash + 1) : m.id;

  const detail: string[] = [`${formatContextWindow(context)} ctx`];
  const promptPrice = nonNegativeNumber(m.pricing?.prompt);
  if (promptPrice !== undefined) {
    const completion = nonNegativeNumber(m.pricing?.completion) ?? promptPrice;
    detail.push(`$${promptPrice}/$${completion} per 1M`);
  }
  if (m.confidential_compute) {
    detail.push('TEE');
  }

  return {
    id: m.id,
    name,
    family,
    version: typeof m.quantization === 'string' && m.quantization ? m.quantization : '1.0',
    maxInputTokens: context,
    maxOutputTokens: maxOutput,
    tooltip: m.id,
    detail: detail.join(' · '),
    capabilities: {
      toolCalling: supportsToolCalling(m),
      imageInput: stringArrayOrDefault(m.input_modalities, []).includes('image')
    }
  };
}

function stringArrayOrDefault(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
