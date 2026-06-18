import * as vscode from 'vscode';
import { SecretStore } from './secrets';
import { ChutesClient } from './chutesClient';
import { ChutesChatModelProvider } from './provider';
import { getConfig } from './config';

export function activate(context: vscode.ExtensionContext): void {
  const secrets = new SecretStore(context.secrets);
  const client = new ChutesClient(getConfig);
  const provider = new ChutesChatModelProvider(secrets, client);

  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider('chutes', provider),
    secrets.onDidChange(() => provider.invalidate()),
    vscode.commands.registerCommand('chutes.manage', () => manageApiKey(secrets, provider)),
    vscode.commands.registerCommand('chutes.refreshModels', () => {
      provider.invalidate();
      void vscode.window.showInformationMessage('Chutes AI: model list refreshed.');
    })
  );
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
  void vscode.window.showInformationMessage('Chutes AI: API key saved.');
}
