// Minimal VS Code API surface used to run the extension's real code against the
// live Chutes API outside the VS Code host. Used only by test/harness.ts.
class LanguageModelTextPart {
  constructor(value) {
    this.value = value;
  }
}
class LanguageModelToolCallPart {
  constructor(callId, name, input) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
}
class LanguageModelToolResultPart {
  constructor(callId, content) {
    this.callId = callId;
    this.content = content;
  }
}
class LanguageModelDataPart {
  constructor(data, mimeType) {
    this.data = data;
    this.mimeType = mimeType;
  }
  static image(data, mime) {
    return new LanguageModelDataPart(data, mime);
  }
  static text(value, mime) {
    return new LanguageModelDataPart(Buffer.from(value, 'utf8'), mime || 'text/plain');
  }
  static json(value, mime) {
    return new LanguageModelDataPart(Buffer.from(JSON.stringify(value)), mime || 'application/json');
  }
}

const LanguageModelChatMessageRole = { User: 1, Assistant: 2 };
const LanguageModelChatToolMode = { Auto: 1, Required: 2 };

class EventEmitter {
  constructor() {
    this._listeners = new Set();
  }
  get event() {
    return (listener) => {
      this._listeners.add(listener);
      return { dispose: () => this._listeners.delete(listener) };
    };
  }
  fire(e) {
    for (const l of this._listeners) {
      l(e);
    }
  }
  dispose() {
    this._listeners.clear();
  }
}

const workspace = {
  getConfiguration() {
    return { get: () => undefined }; // force config defaults
  }
};
const window = {
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined
};
const commands = { executeCommand: async () => undefined };

module.exports = {
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  EventEmitter,
  workspace,
  window,
  commands
};
