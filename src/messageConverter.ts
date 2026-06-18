import * as vscode from 'vscode';

/** A message in the OpenAI chat-completions format (the subset we produce). */
export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Converts VS Code chat messages into OpenAI chat-completions messages.
 *
 * A single VS Code message can expand into several OpenAI messages: tool results
 * (carried inside a User message) become separate `tool`-role messages, which must
 * appear right after the assistant tool call they answer.
 */
export function convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  for (const message of messages) {
    const isAssistant = message.role === vscode.LanguageModelChatMessageRole.Assistant;
    const contentParts: OpenAIContentPart[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    const toolResults: Array<{ callId: string; text: string }> = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        if (part.value) {
          contentParts.push({ type: 'text', text: part.value });
        }
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) }
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push({ callId: part.callId, text: stringifyResultContent(part.content) });
      } else if (part instanceof vscode.LanguageModelDataPart) {
        if (part.mimeType.startsWith('image/')) {
          const base64 = Buffer.from(part.data).toString('base64');
          contentParts.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${base64}` } });
        }
      }
    }

    // Tool results answer the previous assistant tool call → emit them first.
    for (const result of toolResults) {
      out.push({ role: 'tool', tool_call_id: result.callId, content: result.text });
    }

    if (isAssistant) {
      const text = contentParts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const msg: OpenAIMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) {
        msg.tool_calls = toolCalls;
      }
      if (msg.content !== null || msg.tool_calls) {
        out.push(msg);
      }
    } else if (contentParts.length > 0) {
      const onlyText = contentParts.every((p) => p.type === 'text');
      out.push({
        role: 'user',
        content: onlyText
          ? contentParts.map((p) => (p as { text: string }).text).join('')
          : contentParts
      });
    }
  }

  return out;
}

/** Converts VS Code tool declarations into OpenAI `tools`. */
export function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined
): Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} }
    }
  }));
}

export function convertToolMode(mode: vscode.LanguageModelChatToolMode): 'auto' | 'required' {
  return mode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
}

/** Flattens a tool result's content parts into a plain string for the API. */
function stringifyResultContent(content: ReadonlyArray<unknown>): string {
  const chunks: string[] = [];
  for (const item of content) {
    if (item instanceof vscode.LanguageModelTextPart) {
      chunks.push(item.value);
    } else if (typeof item === 'string') {
      chunks.push(item);
    } else if (item && typeof (item as { value?: unknown }).value === 'string') {
      chunks.push((item as { value: string }).value);
    } else {
      try {
        chunks.push(JSON.stringify(item));
      } catch {
        /* skip non-serialisable parts */
      }
    }
  }
  return chunks.join('');
}

/** Best-effort plain-text extraction of a message, used for token counting. */
export function messageToText(message: vscode.LanguageModelChatRequestMessage): string {
  const chunks: string[] = [];
  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      chunks.push(part.value);
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      chunks.push(part.name, JSON.stringify(part.input ?? {}));
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      chunks.push(stringifyResultContent(part.content));
    }
  }
  return chunks.join(' ');
}
