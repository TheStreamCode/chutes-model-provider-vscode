import { ChutesConfig } from './config';
import { readResponseTextLimited } from './http';

const MAX_MODEL_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 8 * 1024;
const MAX_SSE_LINE_CHARS = 1024 * 1024;
const MAX_MODEL_ID_CHARS = 512;

/** Shape of a single entry returned by `GET /v1/models` (only fields we use). */
export interface ChutesRawModel {
  id: string;
  owned_by?: string;
  context_length?: number;
  max_model_len?: number;
  max_output_length?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_features?: string[];
  quantization?: string;
  confidential_compute?: boolean;
  pricing?: { prompt?: number; completion?: number; input_cache_read?: number };
}

/** A streamed delta from `POST /v1/chat/completions` (OpenAI-compatible shape). */
export interface ChatCompletionDelta {
  content?: string;
  toolCallError?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export class ChutesApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ChutesApiError';
  }
}

export class ChutesClient {
  constructor(
    private readonly config: () => ChutesConfig,
    private readonly request: typeof fetch = globalThis.fetch
  ) {}

  /** Fetches the full model catalogue. Aborts after the configured timeout. */
  async listModels(apiKey: string, signal?: AbortSignal): Promise<ChutesRawModel[]> {
    const { endpoint, requestTimeoutMs } = this.config();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await this.request(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new ChutesApiError(await describeError(res, 'GET /models'), res.status);
      }
      const payload = await readResponseTextLimited(res, MAX_MODEL_RESPONSE_BYTES);
      if (payload.truncated) {
        throw new ChutesApiError(`Chutes: GET /models response exceeded ${MAX_MODEL_RESPONSE_BYTES} bytes`);
      }
      let json: unknown;
      try {
        json = JSON.parse(payload.text) as unknown;
      } catch {
        throw new ChutesApiError('Chutes: GET /models returned invalid JSON');
      }
      return isRecord(json) && Array.isArray(json.data) ? json.data.filter(isRawModel) : [];
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  /**
   * Streams a chat completion as OpenAI-style SSE, yielding each delta.
   * The caller's AbortSignal (wired to the VS Code CancellationToken) stops the request.
   * `endpointOverride` targets a different base URL (e.g. the native model router).
   */
  async *streamChatCompletion(
    apiKey: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    endpointOverride?: string
  ): AsyncGenerator<ChatCompletionDelta> {
    const endpoint = endpointOverride ?? this.config().endpoint;
    const res = await this.request(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal
    });

    if (!res.ok || !res.body) {
      throw new ChutesApiError(await describeError(res, 'chat/completions'), res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly partial) line in the buffer.
        buffer = lines.pop() ?? '';
        if (buffer.length > MAX_SSE_LINE_CHARS) {
          throw new ChutesApiError(`Chutes: SSE event exceeded ${MAX_SSE_LINE_CHARS} characters`);
        }
        for (const rawLine of lines) {
          if (rawLine.length > MAX_SSE_LINE_CHARS) {
            throw new ChutesApiError(`Chutes: SSE event exceeded ${MAX_SSE_LINE_CHARS} characters`);
          }
          const event = parseStreamLine(rawLine);
          if (event?.done) {
            try {
              await reader.cancel();
            } catch {
              /* the response may already be closed */
            }
            return;
          }
          if (event?.delta) {
            yield event.delta;
          }
        }
      }

      // Flush the decoder and process a final event even when the server closes
      // the stream without a trailing newline.
      buffer += decoder.decode();
      if (buffer.length > MAX_SSE_LINE_CHARS) {
        throw new ChutesApiError(`Chutes: SSE event exceeded ${MAX_SSE_LINE_CHARS} characters`);
      }
      const finalEvent = parseStreamLine(buffer);
      if (finalEvent?.delta) {
        yield finalEvent.delta;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function isRawModel(value: unknown): value is ChutesRawModel {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    value.id.length <= MAX_MODEL_ID_CHARS
  );
}

function parseStreamLine(
  rawLine: string
): { done: true; delta?: never } | { done: false; delta: ChatCompletionDelta } | undefined {
  const line = rawLine.trim();
  if (!line || line.startsWith(':') || !line.startsWith('data:')) {
    return undefined;
  }

  const data = line.slice('data:'.length).trim();
  if (data === '[DONE]') {
    return { done: true };
  }

  try {
    const payload = JSON.parse(data) as unknown;
    if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
      return undefined;
    }
    const delta = normalizeDelta(payload.choices[0].delta);
    return delta ? { done: false, delta } : undefined;
  } catch {
    return undefined; // ignore keep-alives and malformed fragments
  }
}

function normalizeDelta(value: unknown): ChatCompletionDelta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const delta: ChatCompletionDelta = {};
  if (typeof value.content === 'string') {
    delta.content = value.content;
  }
  if (value.tool_calls !== undefined && !Array.isArray(value.tool_calls)) {
    delta.toolCallError = 'malformed tool calls';
  } else if (Array.isArray(value.tool_calls)) {
    const toolCalls: NonNullable<ChatCompletionDelta['tool_calls']> = [];
    for (const item of value.tool_calls) {
      if (!isRecord(item) || typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0) {
        delta.toolCallError = 'malformed tool call metadata';
        continue;
      }
      if (item.id !== undefined && typeof item.id !== 'string') {
        delta.toolCallError = 'malformed tool call id';
        continue;
      }
      if (item.type !== undefined && typeof item.type !== 'string') {
        delta.toolCallError = 'malformed tool call type';
        continue;
      }
      if (item.function !== undefined && !isRecord(item.function)) {
        delta.toolCallError = 'malformed tool call function';
        continue;
      }
      const fn = isRecord(item.function) ? item.function : undefined;
      if (fn?.name !== undefined && typeof fn.name !== 'string') {
        delta.toolCallError = 'malformed tool call name';
        continue;
      }
      if (fn?.arguments !== undefined && typeof fn.arguments !== 'string') {
        delta.toolCallError = 'malformed tool call arguments';
        continue;
      }
      toolCalls.push({
        index: item.index,
        id: typeof item.id === 'string' ? item.id : undefined,
        type: typeof item.type === 'string' ? item.type : undefined,
        function: fn
          ? {
              name: typeof fn.name === 'string' ? fn.name : undefined,
              arguments: typeof fn.arguments === 'string' ? fn.arguments : undefined
            }
          : undefined
      });
    }
    if (toolCalls.length > 0) {
      delta.tool_calls = toolCalls;
    }
  }

  return delta.content !== undefined || delta.tool_calls !== undefined || delta.toolCallError !== undefined
    ? delta
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function describeError(res: Response, op: string): Promise<string> {
  let detail = '';
  try {
    const payload = await readResponseTextLimited(res, MAX_ERROR_RESPONSE_BYTES);
    detail = payload.text.slice(0, 500);
    if (payload.truncated) {
      detail += '…';
    }
  } catch {
    /* ignore */
  }
  const base = `Chutes: ${op} failed (HTTP ${res.status})`;
  return detail ? `${base}: ${detail}` : base;
}
