import * as vscode from 'vscode';
import { SecretStore } from './secrets';
import { ChutesClient } from './chutesClient';
import { ChutesChatModelProvider } from './provider';
import { fetchDashboard, NoApiKeyError } from './usage/dashboard';
import { formatQuotasMarkdown, formatUsageMarkdown } from './usage/format';
import { ChutesQuotaTool, ChutesUsageTool } from './usage/tools';
import { getConfig } from './config';

export function activate(context: vscode.ExtensionContext): void {
  const secrets = new SecretStore(context.secrets);
  const client = new ChutesClient(getConfig);
  const provider = new ChutesChatModelProvider(secrets, client);

  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider('chutes', provider),
    vscode.lm.registerTool('chutes_usage', new ChutesUsageTool(secrets)),
    vscode.lm.registerTool('chutes_quota', new ChutesQuotaTool(secrets)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('chutes')) {
        provider.invalidate();
      }
    }),
    vscode.commands.registerCommand('chutes.manage', () => manageApiKey(secrets, provider)),
    vscode.commands.registerCommand('chutes.showUsage', () => showUsageReport(secrets)),
    vscode.commands.registerCommand('chutes.refreshModels', () => {
      provider.invalidate();
      void vscode.window.showInformationMessage('Chutes AI: model list refreshed.');
    })
  );
}

async function showUsageReport(secrets: SecretStore): Promise<void> {
  try {
    const data = await fetchDashboard(secrets);
    const content = `${formatUsageMarkdown(data)}\n\n${formatQuotasMarkdown(data)}\n`;
    const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    if (error instanceof NoApiKeyError) {
      const choice = await vscode.window.showWarningMessage('Chutes AI: no API key is configured.', 'Set API Key');
      if (choice === 'Set API Key') {
        await vscode.commands.executeCommand('chutes.manage');
      }
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Chutes AI: could not load usage. ${message}`);
  }
}

export function deactivate(): void {
  /* nothing to clean up beyond context.subscriptions */
}

async function manageApiKey(secrets: SecretStore, provider: ChutesChatModelProvider): Promise<void> {
  const existing = await secrets.get();
  const SET = existing ? 'Update API key' : 'Set API key';
  const CLEAR = 'Clear API key';
  const actions = existing ? [SET, CLEAR] : [SET];

  const choice = await vscode.window.showQuickPick(actions, {
    title: 'Chutes AI',
    placeHolder: existing ? 'An API key is already configured.' : 'No API key configured.'
  });
  if (!choice) {
    return;
  }

  if (choice === CLEAR) {
    await secrets.clear();
    provider.invalidate();
    void vscode.window.showInformationMessage('Chutes AI: API key cleared.');
    return;
  }

  const key = await vscode.window.showInputBox({
    title: 'Chutes AI API key',
    prompt: 'Paste your Chutes API key (starts with "cpk_"). Get one at https://chutes.ai',
    placeHolder: 'cpk_...',
    password: true,
    ignoreFocusOut: true
  });
  if (key === undefined) {
    return;
  }

  const trimmed = key.trim();
  if (!trimmed) {
    void vscode.window.showWarningMessage('Chutes AI: no API key entered.');
    return;
  }

  await secrets.set(trimmed);
  provider.invalidate();
  void vscode.window.showInformationMessage('Chutes AI: API key saved.');
}
