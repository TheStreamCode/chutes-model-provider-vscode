// Client for the Chutes account/usage API (api.chutes.ai), vendored from the
// chutes-usage project. The Chutes `cpk_` key authenticates here too (verified).
// No `vscode` dependency.
import type { JsonContainer, JsonObject } from './types';
import { readResponseTextLimited } from '../http';

const API_BASE_URL = 'https://api.chutes.ai';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ACCOUNT_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_QUOTA_USAGE_REQUESTS = 50;
const QUOTA_USAGE_CONCURRENCY = 4;
const MAX_CHUTE_ID_CHARS = 512;

export interface DashboardPayload {
  subscriptionUsage: JsonObject;
  quotas: JsonContainer;
  quotaUsageMe: JsonContainer | null;
  quotaUsageFallback: JsonContainer | null;
  invocationStatsLlm: JsonContainer | null;
}

export class ChutesAccountClient {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = globalThis.fetch
  ) {}

  /** Fetches the account/usage endpoints needed to summarize spend and quotas. */
  async getDashboardPayload(signal?: AbortSignal): Promise<DashboardPayload> {
    const [subscriptionUsage, quotas, quotaUsageMe, invocationStatsLlm] = await Promise.all([
      this.getJsonContainer('/users/me/subscription_usage', signal),
      this.getJsonContainer('/users/me/quotas', signal),
      this.getJsonContainer('/users/me/quota_usage/me', signal).catch(() => null),
      this.getJsonContainer('/invocations/stats/llm', signal).catch(() => null)
    ]);
    const quotaUsageFallback = hasQuotaUsageData(quotaUsageMe) ? null : await this.getQuotaUsagePayload(quotas, signal);

    if (!isJsonObject(subscriptionUsage)) {
      throw new Error('Unexpected API response shape for /users/me/subscription_usage');
    }

    return { subscriptionUsage, quotas, quotaUsageMe, quotaUsageFallback, invocationStatsLlm };
  }

  private async getJsonContainer(path: string, signal?: AbortSignal): Promise<JsonContainer> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.request(`${API_BASE_URL}${path}`, {
        method: 'GET',
        headers: { Authorization: this.apiKey, Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Chutes account API: ${path} failed (HTTP ${response.status})`);
      }
      const payload = await readResponseTextLimited(response, MAX_ACCOUNT_RESPONSE_BYTES);
      if (payload.truncated) {
        throw new Error(`Chutes account API: ${path} response exceeded ${MAX_ACCOUNT_RESPONSE_BYTES} bytes`);
      }
      let json: unknown;
      try {
        json = JSON.parse(payload.text) as unknown;
      } catch {
        throw new Error(`Chutes account API: ${path} returned invalid JSON`);
      }
      if (!isJsonContainer(json)) {
        throw new Error(`Unexpected API response shape for ${path}`);
      }
      return json;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async getQuotaUsagePayload(quotas: JsonContainer, signal?: AbortSignal): Promise<JsonContainer | null> {
    const chuteIds = getQuotaUsageChuteIds(quotas);
    if (chuteIds.length === 0 || chuteIds.length > MAX_QUOTA_USAGE_REQUESTS) {
      return null;
    }
    const entries: Array<readonly [string, JsonContainer] | null> = Array.from({ length: chuteIds.length }, () => null);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(QUOTA_USAGE_CONCURRENCY, chuteIds.length) }, async () => {
      while (nextIndex < chuteIds.length) {
        if (signal?.aborted) {
          throw signal.reason instanceof Error ? signal.reason : new Error('Chutes account API request cancelled');
        }
        const index = nextIndex++;
        const chuteId = chuteIds[index];
        const path = `/users/me/quota_usage/${encodePathSegment(chuteId)}`;
        const payload = await this.getJsonContainer(path, signal).catch((error: unknown) => {
          if (signal?.aborted) {
            throw error;
          }
          return null;
        });
        entries[index] = payload === null ? null : ([chuteId, payload] as const);
      }
    });
    await Promise.all(workers);
    const valid = entries.filter((entry): entry is readonly [string, JsonContainer] => entry !== null);
    return valid.length === 0 ? null : Object.fromEntries(valid);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonContainer(value: unknown): value is JsonContainer {
  return isJsonObject(value) || Array.isArray(value);
}

function hasQuotaUsageData(payload: JsonContainer | null): boolean {
  if (payload === null || Array.isArray(payload)) {
    return false;
  }
  if (isNonNegativeNumberLike(payload.used) || isNonNegativeNumberLike(payload.quota)) {
    return true;
  }
  return Object.values(payload).some((value) => {
    const object = isJsonObject(value) ? value : null;
    return isNonNegativeNumberLike(object?.used) || isNonNegativeNumberLike(object?.quota);
  });
}

function isNonNegativeNumberLike(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0;
  }
  return false;
}

function getQuotaUsageChuteIds(payload: JsonContainer): string[] {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.quotas)
        ? payload.quotas
        : [];
  const chuteIds = new Set<string>();
  for (const item of items) {
    const object = isJsonObject(item) ? item : null;
    const chuteId =
      typeof object?.chute_id === 'string' && object.chute_id.length > 0 && object.chute_id.length <= MAX_CHUTE_ID_CHARS
        ? object.chute_id
        : null;
    if (chuteId) {
      chuteIds.add(chuteId);
      if (chuteIds.size > MAX_QUOTA_USAGE_REQUESTS) {
        break;
      }
    }
  }
  return Array.from(chuteIds);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/\*/g, '%2A');
}
