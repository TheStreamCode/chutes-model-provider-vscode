import type { DashboardData, UsageWindow } from './types';

/** Renders the spend/usage windows as a markdown table. Pure — unit-tested. */
export function formatUsageMarkdown(data: DashboardData): string {
  const lines: string[] = ['### Chutes usage'];
  const plan = data.plan;
  if (plan?.planName) {
    const price = plan.monthlyPriceUsd != null ? ` · $${plan.monthlyPriceUsd}/mo` : '';
    lines.push(`**Billing:** ${escapeInlineMarkdown(plan.planName)}${price}`);
  }
  if (data.paygCreditUsd != null) {
    lines.push(`**PAYG balance:** $${data.paygCreditUsd.toFixed(2)}`);
  }
  if (plan?.planName === 'Pay-as-you-go') {
    lines.push('_Usage is billed per request; the 4-hour window is a rate limit._');
  }
  lines.push('');

  if (data.windows.length === 0) {
    lines.push('_No usage data available._');
    return lines.join('\n');
  }

  lines.push('| Window | Used | Limit | Remaining | Used % |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const window of data.windows) {
    lines.push(
      `| ${escapeTableCell(window.label)} | ${formatValue(window.unit, window.used)} | ${formatLimit(window)} | ${formatValue(window.unit, window.remaining)} | ${formatPercent(window.percentUsed)} |`
    );
  }
  lines.push('');
  lines.push('_Run **Chutes AI: Show Usage** for the full report, including per-model quotas._');
  return lines.join('\n');
}

/** Renders per-model quotas as a markdown table. Pure — unit-tested. */
export function formatQuotasMarkdown(data: DashboardData): string {
  const lines: string[] = ['### Chutes per-model quotas', ''];
  if (data.quotas.length === 0) {
    lines.push('_No quota data available._');
    return lines.join('\n');
  }
  lines.push('| Model | Daily quota (requests) |');
  lines.push('| --- | --- |');
  for (const quota of data.quotas) {
    const value =
      quota.quota === null ? '—' : quota.quota === 0 ? 'Unlimited' : Math.round(quota.quota).toLocaleString('en-US');
    lines.push(`| ${escapeTableCell(quota.modelLabel)} | ${value} |`);
  }
  return lines.join('\n');
}

function formatValue(unit: UsageWindow['unit'], value: number | null): string {
  if (value === null) {
    return '—';
  }
  return unit === 'usd' ? `$${value.toFixed(2)}` : Math.round(value).toLocaleString('en-US');
}

function formatLimit(window: UsageWindow): string {
  return window.limit === 0 ? 'Unlimited' : formatValue(window.unit, window.limit);
}

function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${Math.round(percent)}%`;
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>])/g, '\\$1');
}

function escapeTableCell(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\|`*_{}[\]<>])/g, '\\$1');
}
