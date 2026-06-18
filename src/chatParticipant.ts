import * as vscode from 'vscode';
import { SecretStore } from './secrets';
import { ChutesAccountClient } from './usage/accountClient';
import { normalizeDashboardData } from './usage/normalize';
import type { DashboardData, UsageWindow } from './usage/types';

/**
 * Handler for the `@chutes` chat participant. Surfaces Chutes account usage,
 * spend and quotas natively inside the VS Code / Copilot Chat panel.
 */
export function createUsageChatHandler(secrets: SecretStore): vscode.ChatRequestHandler {
  return async (request, _context, stream, token) => {
    const apiKey = await secrets.get();
    if (!apiKey) {
      stream.markdown('No Chutes API key is configured. Set one to view your usage and spend.\n\n');
      stream.button({ command: 'chutes.manage', title: 'Set Chutes API Key' });
      return {};
    }

    stream.progress('Fetching Chutes usage…');
    let data: DashboardData;
    try {
      const payload = await new ChutesAccountClient(apiKey).getDashboardPayload();
      if (token.isCancellationRequested) {
        return {};
      }
      data = normalizeDashboardData(
        payload.subscriptionUsage,
        payload.quotas,
        payload.quotaUsageFallback,
        payload.quotaUsageMe,
        payload.invocationStatsLlm
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stream.markdown(`Could not load Chutes usage (${message}).\n\nMake sure your API key is valid and has account access.`);
      return {};
    }

    stream.markdown(request.command === 'quota' ? formatQuotasMarkdown(data) : formatUsageMarkdown(data));
    return {};
  };
}

/** Renders the spend/usage windows as a markdown table. Pure — unit-tested. */
export function formatUsageMarkdown(data: DashboardData): string {
  const lines: string[] = ['### Chutes usage'];
  const plan = data.plan;
  if (plan?.planName) {
    const price = plan.monthlyPriceUsd != null ? ` · $${plan.monthlyPriceUsd}/mo` : '';
    lines.push(`**Plan:** ${plan.planName}${price}`);
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
      `| ${window.label} | ${formatValue(window.unit, window.used)} | ${formatLimit(window)} | ${formatValue(window.unit, window.remaining)} | ${formatPercent(window.percentUsed)} |`
    );
  }
  lines.push('');
  lines.push('_Run `@chutes /quota` for per-model quotas._');
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
    const value = quota.quota === null ? '—' : quota.quota === 0 ? 'Unlimited' : Math.round(quota.quota).toLocaleString('en-US');
    lines.push(`| ${quota.modelLabel} | ${value} |`);
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
