import { SecretStore } from '../secrets';
import { ChutesAccountClient } from './accountClient';
import { normalizeDashboardData } from './normalize';
import type { DashboardData } from './types';

export class NoApiKeyError extends Error {
  constructor() {
    super('No Chutes API key is configured.');
    this.name = 'NoApiKeyError';
  }
}

/** Fetch and normalize the Chutes account dashboard for the stored API key. */
export async function fetchDashboard(secrets: SecretStore, signal?: AbortSignal): Promise<DashboardData> {
  const apiKey = await secrets.get();
  if (!apiKey) {
    throw new NoApiKeyError();
  }
  const payload = await new ChutesAccountClient(apiKey).getDashboardPayload(signal);
  return normalizeDashboardData(
    payload.subscriptionUsage,
    payload.quotas,
    payload.quotaUsageFallback,
    payload.quotaUsageMe,
    payload.invocationStatsLlm,
    payload.me
  );
}
