import * as vscode from 'vscode';

const API_KEY = 'chutes.apiKey';

/**
 * Stores the Chutes API key in VS Code's encrypted SecretStorage (OS keychain),
 * never in settings.json. Mirrors the pattern used by the chutes-usage extension.
 */
export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get(): Thenable<string | undefined> {
    return this.secrets.get(API_KEY);
  }

  set(value: string): Thenable<void> {
    return this.secrets.store(API_KEY, value);
  }

  clear(): Thenable<void> {
    return this.secrets.delete(API_KEY);
  }
}
