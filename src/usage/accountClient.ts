// Client for the Chutes account/usage API (api.chutes.ai), vendored from the
// chutes-usage project. The Chutes `cpk_` key authenticates here too (verified).
// No `vscode` dependency.
import type { JsonContainer, JsonObject } from './types';

const API_BASE_URL = 'https://api.chutes.ai';
const REQUEST_TIMEOUT_MS = 15000;

export interface DashboardPayload {
  subscriptionUsage: JsonObject;
  quotas: JsonContainer;
  quotaUsageMe: JsonContainer | null;
  quotaUsageFallback: JsonContainer | null;
  invocationStatsLlm: JsonContainer | null;
  pricing: JsonContainer | null;
}

export class ChutesAccountClient {
  constructor(private readonly apiKey: string) {}

  /** Fetches the account/usage endpoints needed to summarize spend and quotas. */
  async getDashboardPayload(): Promise<DashboardPayload> {
    const [subscriptionUsage, quotas, pricing, quotaUsageMe, invocationStatsLlm] = await Promise.all([
      this.getJsonContainer('/users/me/subscription_usage'),
      this.getJsonContainer('/users/me/quotas'),
      this.getJsonContainer('/pricing').catch(() => null),
      this.getJsonContainer('/users/me/quota_usage/me').catch(() => null),
      this.getJsonContainer('/invocations/stats/llm').catch(() => null)
    ]);
    const quotaUsageFallback = hasQuotaUsageData(quotaUsageMe) ? null : await this.getQuotaUsagePayload(quotas);

    if (!isJsonObject(subscriptionUsage)) {
      throw new Error('Unexpected API response shape for /users/me/subscription_usage');
    }

    return { subscriptionUsage, quotas, quotaUsageMe, quotaUsageFallback, invocationStatsLlm, pricing };
  }

  private async getJsonContainer(path: string): Promise<JsonContainer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'GET',
        headers: { Authorization: this.apiKey, Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Chutes account API: ${path} failed (HTTP ${response.status})`);
      }
      const json = (await response.json()) as unknown;
      if (!isJsonContainer(json)) {
        throw new Error(`Unexpected API response shape for ${path}`);
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getQuotaUsagePayload(quotas: JsonContainer): Promise<JsonContainer | null> {
    const chuteIds = getQuotaUsageChuteIds(quotas);
    if (chuteIds.length === 0) {
      return null;
    }
    const entries = await Promise.all(
      chuteIds.map(async (chuteId) => {
        const path = `/users/me/quota_usage/${encodePathSegment(chuteId)}`;
        const payload = await this.getJsonContainer(path).catch(() => null);
        return payload === null ? null : ([chuteId, payload] as const);
      })
    );
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
  if (isFiniteNumberLike(payload.used) || isFiniteNumberLike(payload.quota)) {
    return true;
  }
  return Object.values(payload).some((value) => {
    const object = isJsonObject(value) ? value : null;
    return isFiniteNumberLike(object?.used) || isFiniteNumberLike(object?.quota);
  });
}

function isFiniteNumberLike(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return Number.isFinite(Number(value));
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
    const chuteId = typeof object?.chute_id === 'string' && object.chute_id.length > 0 ? object.chute_id : null;
    if (chuteId) {
      chuteIds.add(chuteId);
    }
  }
  return Array.from(chuteIds);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/\*/g, '%2A');
}
