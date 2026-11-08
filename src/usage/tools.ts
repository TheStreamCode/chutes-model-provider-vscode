import * as vscode from 'vscode';
import { SecretStore } from '../secrets';
import { fetchDashboard, NoApiKeyError } from './dashboard';
import { formatQuotasMarkdown, formatUsageMarkdown } from './format';
import type { DashboardData } from './types';

type EmptyInput = Record<string, never>;

abstract class ChutesAccountTool implements vscode.LanguageModelTool<EmptyInput> {
  constructor(
    private readonly secrets: SecretStore,
    private readonly render: (data: DashboardData) => string
  ) {}

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<EmptyInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const data = await fetchDashboard(this.secrets, controller.signal);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(this.render(data))]);
    } catch (error) {
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      if (error instanceof NoApiKeyError) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            'No Chutes API key is configured. Ask the user to run "Chutes AI: Manage API Key" first.'
          )
        ]);
      }
      const message = error instanceof Error ? error.message : String(error);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Could not load Chutes usage: ${message}`)
      ]);
    } finally {
      cancellation.dispose();
    }
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: 'Fetching Chutes usage…' };
  }
}

export class ChutesUsageTool extends ChutesAccountTool {
  constructor(secrets: SecretStore) {
    super(secrets, formatUsageMarkdown);
  }
}

export class ChutesQuotaTool extends ChutesAccountTool {
  constructor(secrets: SecretStore) {
    super(secrets, formatQuotasMarkdown);
  }
}
