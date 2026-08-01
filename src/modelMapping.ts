import * as vscode from 'vscode';
import { ChutesRawModel } from './chutesClient';

const FALLBACK_CONTEXT = 32768;

/** Reserved model id of Chutes' native router; selecting it delegates routing + fallback. */
export const AUTO_MODEL_ID = 'model-router';

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
    detail: 'Auto · routing + fallback nativo',
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
    try {
      const re = new RegExp(term, 'i');
      return (id: string) => re.test(id);
    } catch {
      const lower = term.toLowerCase();
      return (id: string) => id.toLowerCase().includes(lower);
    }
  });
  return models.filter((m) => matchers.some((match) => match(m.id)));
}

/** Maps a Chutes model to the VS Code chat model descriptor. */
export function toChatInformation(m: ChutesRawModel): vscode.LanguageModelChatInformation {
  const features = stringArrayOrDefault(m.supported_features, []);
  const context = positiveInteger(m.context_length) ?? positiveInteger(m.max_model_len) ?? FALLBACK_CONTEXT;
  const maxOutput = Math.min(positiveInteger(m.max_output_length) ?? context, context);

  const slash = m.id.lastIndexOf('/');
  const family = slash > 0 ? m.id.slice(0, slash) : 'chutes';
  const name = slash > 0 ? m.id.slice(slash + 1) : m.id;

  const detail: string[] = [`${Math.round(context / 1000)}k ctx`];
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
      toolCalling: features.includes('tools'),
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
