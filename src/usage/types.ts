// Types for the Chutes account/usage API, vendored from the chutes-usage project.
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export interface JsonArray extends Array<JsonValue> {}
export type JsonContainer = JsonObject | JsonArray;

export type UsageWindowKind = 'billing-cycle' | 'rolling-4h' | 'daily-requests' | 'weekly' | 'unknown';
export type UsageUnit = 'usd' | 'requests';

export interface UsageWindow {
  id: string;
  kind: UsageWindowKind;
  label: string;
  unit: UsageUnit;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  resetLabel: string | null;
  status?: 'trusted' | 'stale' | 'unknown';
  dataSource?: 'quota-usage-me' | 'quota-usage-fallback' | 'subscription-usage' | 'quotas' | 'unknown';
}

export interface QuotaEntry {
  modelLabel: string;
  quota: number | null;
  lastUpdated: string | null;
}

export interface PlanInfo {
  planName: string | null;
  monthlyPriceUsd: number | null;
  monthlyCapUsd: number | null;
  fourHourCapUsd: number | null;
  dailyRequestLimit: number | null;
  paygDiscountPercent: number | null;
}

export interface DashboardData {
  windows: UsageWindow[];
  quotas: QuotaEntry[];
  plan: PlanInfo | null;
}

export interface QuotaUsageSummary {
  used: number | null;
  quota: number | null;
  trusted: boolean;
}

export interface InvocationStatsSummary {
  totalRequests: number;
}
