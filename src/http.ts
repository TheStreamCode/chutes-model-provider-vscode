export interface LimitedResponseText {
  text: string;
  truncated: boolean;
}

/** Reads at most `maxBytes` from a response body and cancels the remainder. */
export async function readResponseTextLimited(response: Response, maxBytes: number): Promise<LimitedResponseText> {
  if (!response.body) {
    return { text: '', truncated: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }

      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          text += decoder.decode(value.subarray(0, remaining), { stream: true });
        }
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          /* the response may already be closed */
        }
        break;
      }

      bytesRead += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return { text, truncated };
}
