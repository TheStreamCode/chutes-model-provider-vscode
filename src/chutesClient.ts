import { ChutesConfig } from './config';

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
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export class ChutesApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ChutesApiError';
  }
}

export class ChutesClient {
  constructor(private readonly config: () => ChutesConfig) {}

  /** Fetches the full model catalogue. Aborts after the configured timeout. */
  async listModels(apiKey: string): Promise<ChutesRawModel[]> {
    const { endpoint, requestTimeoutMs } = this.config();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetch(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new ChutesApiError(await describeError(res, 'GET /models'), res.status);
      }
      const json = (await res.json()) as { data?: ChutesRawModel[] };
      return Array.isArray(json?.data) ? json.data : [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Streams a chat completion as OpenAI-style SSE, yielding each delta.
   * The caller's AbortSignal (wired to the VS Code CancellationToken) stops the request.
   */
  async *streamChatCompletion(
    apiKey: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): AsyncGenerator<ChatCompletionDelta> {
    const { endpoint } = this.config();
    const res = await fetch(`${endpoint}/chat/completions`, {
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
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':') || !line.startsWith('data:')) {
            continue;
          }
          const data = line.slice('data:'.length).trim();
          if (data === '[DONE]') {
            return;
          }
          let parsed: { choices?: Array<{ delta?: ChatCompletionDelta }> };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // ignore keep-alives / malformed fragments
          }
          const delta = parsed.choices?.[0]?.delta;
          if (delta) {
            yield delta;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

async function describeError(res: Response, op: string): Promise<string> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  const base = `Chutes: ${op} failed (HTTP ${res.status})`;
  return detail ? `${base}: ${detail}` : base;
}
