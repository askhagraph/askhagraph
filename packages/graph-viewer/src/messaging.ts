/**
 * @module messaging
 * IDE communication layer for the Graph Viewer.
 * Abstracts message passing so the viewer works in VS Code WebViews
 * and in standalone development/testing mode.
 */

import type { ViewerMessage } from './types.js';

/** Interface for sending messages to the IDE host. */
export interface IMessageBridge {
  /** Send a message to the IDE host. */
  postMessage(message: ViewerMessage): void;
  /** Register a handler for messages from the IDE host. */
  onMessage(handler: (message: unknown) => void): void;
  /** Remove all registered handlers. */
  dispose(): void;
}

// Cache the VS Code API instance — acquireVsCodeApi() can only be called once
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedVsCodeApi: { postMessage: (msg: unknown) => void } | null = null;

/** Get the cached VS Code API instance (available after createMessageBridge is called). */
export function getVsCodeApi(): { postMessage: (msg: unknown) => void } | null {
  return cachedVsCodeApi;
}

/**
 * VS Code WebView message bridge.
 * Uses the `acquireVsCodeApi()` global provided by the WebView host.
 */
export class VsCodeMessageBridge implements IMessageBridge {
  private readonly vscodeApi: { postMessage: (msg: unknown) => void };
  private handlers: Array<(message: unknown) => void> = [];
  private windowListener: ((event: MessageEvent) => void) | null = null;

  constructor() {
    if (cachedVsCodeApi) {
      this.vscodeApi = cachedVsCodeApi;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acquireVsCodeApi = (globalThis as any).acquireVsCodeApi;
      if (typeof acquireVsCodeApi !== 'function') {
        throw new Error('VsCodeMessageBridge: acquireVsCodeApi is not available');
      }
      this.vscodeApi = acquireVsCodeApi();
      cachedVsCodeApi = this.vscodeApi;
    }

    this.windowListener = (event: MessageEvent) => {
      for (const handler of this.handlers) {
        handler(event.data);
      }
    };
    window.addEventListener('message', this.windowListener);
  }

  postMessage(message: ViewerMessage): void {
    this.vscodeApi.postMessage(message);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.handlers.push(handler);
  }

  dispose(): void {
    if (this.windowListener) {
      window.removeEventListener('message', this.windowListener);
      this.windowListener = null;
    }
    this.handlers = [];
  }
}

/**
 * Fallback message bridge for development and testing.
 * Logs messages to the console instead of sending to an IDE.
 */
export class DevMessageBridge implements IMessageBridge {
  private handlers: Array<(message: unknown) => void> = [];

  postMessage(message: ViewerMessage): void {
    console.log('[AskhaGraph Message]', message.type, message.payload);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.handlers.push(handler);
  }

  /** Simulate receiving a message from the IDE (for testing). */
  simulateMessage(message: unknown): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }

  dispose(): void {
    this.handlers = [];
  }
}

/**
 * Create the appropriate message bridge based on the runtime environment.
 */
export function createMessageBridge(): IMessageBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).acquireVsCodeApi === 'function') {
    return new VsCodeMessageBridge();
  }
  return new DevMessageBridge();
}
