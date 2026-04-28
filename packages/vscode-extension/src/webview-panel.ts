/**
 * @module webview-panel
 * WebView panel management for the AskhaGraph Graph Viewer.
 *
 * Creates and manages a VS Code WebView panel that hosts the Graph Viewer,
 * handling bidirectional message passing between the extension host and the viewer.
 */

import * as vscode from 'vscode';
import { getProjectRoot } from './utils.js';
import { setAnnotation, getAnnotationForNode } from './annotations.js';
import {
  INFO_AI_CONTEXT_COPIED,
  PLACEHOLDER_ANNOTATION,
  promptAnnotation,
} from './constants.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Messages sent from the WebView to the extension host. */
interface ViewerToHostMessage {
  type: 'navigate' | 'askAi' | 'addAnnotation' | 'expandNode' | 'collapseNode';
  payload: Record<string, unknown>;
}

// ─── GraphViewerPanel ────────────────────────────────────────────────────────

/**
 * Manages the Graph Viewer WebView panel.
 * Handles creation, messaging, and lifecycle of the panel.
 */
export class GraphViewerPanel {
  private static instance: GraphViewerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private pendingGraph: Record<string, unknown> | null = null;
  private pendingAnnotations: Array<{ nodeId: string; text: string; author: string; timestamp: string }> = [];
  private pendingSettings: Record<string, unknown> | null = null;
  private webviewReady = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set the initial HTML content
    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from the WebView
    this.panel.webview.onDidReceiveMessage(
      (message: ViewerToHostMessage) => {
        if ((message as unknown as Record<string, string>).type === 'ready') {
          this.webviewReady = true;
          if (this.pendingGraph) {
            this.panel.webview.postMessage({ type: 'loadGraph', payload: this.pendingGraph });
            this.pendingGraph = null;
          }
          // Flush pending annotations after graph is loaded
          for (const annotation of this.pendingAnnotations) {
            this.panel.webview.postMessage({ type: 'annotationAdded', payload: annotation });
          }
          this.pendingAnnotations = [];
          // Flush pending settings
          if (this.pendingSettings) {
            this.panel.webview.postMessage({ type: 'settingsChanged', payload: this.pendingSettings });
            this.pendingSettings = null;
          }
          return;
        }
        this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        GraphViewerPanel.instance = undefined;
        this.dispose();
      },
      null,
      this.disposables,
    );
  }

  /**
   * Get the current panel instance, if one exists.
   */
  static getInstance(): GraphViewerPanel | undefined {
    return GraphViewerPanel.instance;
  }

  /**
   * Create a new Graph Viewer panel or reveal the existing one.
   * Sends graph data to the viewer once ready.
   *
   * @param extensionUri - The extension's root URI.
   * @param graphJson - The serialized call graph JSON to display.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    graphJson?: Record<string, unknown>,
    initialSettings?: Record<string, unknown>,
  ): GraphViewerPanel {
    // If we already have a panel, reveal it
    if (GraphViewerPanel.instance) {
      GraphViewerPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      if (graphJson) {
        GraphViewerPanel.instance.loadGraph(graphJson, initialSettings);
      }
      return GraphViewerPanel.instance;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      'askhagraph.graphViewer',
      'AskhaGraph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          extensionUri,
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      },
    );

    GraphViewerPanel.instance = new GraphViewerPanel(panel, extensionUri);

    if (graphJson) {
      GraphViewerPanel.instance.loadGraph(graphJson, initialSettings);
    }

    return GraphViewerPanel.instance;
  }

  /**
   * Send graph data to the WebView for rendering.
   *
   * @param graphJson - The serialized call graph JSON.
   */
  loadGraph(graphJson: Record<string, unknown>, initialSettings?: Record<string, unknown>): void {
    if (this.webviewReady) {
      this.panel.webview.postMessage({
        type: 'loadGraph',
        payload: graphJson,
        settings: initialSettings,
      });
    } else {
      this.pendingGraph = graphJson;
      if (initialSettings) {
        this.pendingSettings = initialSettings;
      }
    }
  }

  /**
   * Send a persisted annotation to the WebView for display on a node.
   */
  sendAnnotation(nodeId: string, text: string, author: string, timestamp: string): void {
    const payload = { nodeId, text, author, timestamp };
    if (this.webviewReady) {
      this.panel.webview.postMessage({ type: 'annotationAdded', payload });
    } else {
      this.pendingAnnotations.push(payload);
    }
  }

  /**
   * Send a settings update to the WebView.
   */
  sendSettings(settings: Record<string, unknown>): void {
    if (this.webviewReady) {
      this.panel.webview.postMessage({ type: 'settingsChanged', payload: settings });
    } else {
      this.pendingSettings = settings;
    }
  }

  /** Show a loading indicator in the webview. */
  showLoading(): void {
    this.panel.webview.postMessage({ type: 'showLoading' });
  }

  /** Send a find-path request to the webview. */
  sendFindPath(source: string, target: string): void {
    this.panel.webview.postMessage({
      type: 'findPath',
      payload: { source, target },
    });
  }

  /**
   * Dispose the panel and clean up resources.
   */
  dispose(): void {
    GraphViewerPanel.instance = undefined;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private handleMessage(message: ViewerToHostMessage): void {
    switch (message.type) {
      case 'navigate':
        this.handleNavigate(message.payload);
        break;
      case 'askAi':
        this.handleAskAi(message.payload);
        break;
      case 'addAnnotation':
        this.handleAddAnnotation(message.payload);
        break;
      default:
        break;
    }
  }

  private handleNavigate(payload: Record<string, unknown>): void {
    const filePath = payload['filePath'] as string | undefined;
    const line = payload['line'] as number | undefined;
    const column = payload['column'] as number | undefined;

    if (!filePath) {
      return;
    }

    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(
      Math.max(0, line ?? 0),
      Math.max(0, column ?? 0),
    );
    const selection = new vscode.Selection(position, position);

    void vscode.window.showTextDocument(uri, {
      selection,
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: true,
    });
  }

  private handleAskAi(payload: Record<string, unknown>): void {
    const name = payload['qualifiedName'] as string ?? payload['name'] as string ?? 'unknown';
    const filePath = payload['filePath'] as string ?? '';
    const line = payload['line'] as number ?? 0;
    const nodeId = payload['nodeId'] as string ?? '';

    // Compose rich context for the AI assistant
    const context = [
      `Analyze this function from the AskhaGraph call graph:`,
      `- Name: ${name}`,
      `- File: ${filePath}:${(line ?? 0) + 1}`,
      `- Node ID: ${nodeId}`,
      ``,
      `Please explain what this function does, its role in the call graph, and any potential issues.`,
      `You can run \`askhagraph.analyze\` with entryPoint "${filePath}:${name}" to get the full call graph data.`,
    ].join('\n');

    // Try to find a working chat command — different IDEs register different ones.
    const chatCommands = [
      'kiro.chat.open',
      'kiro.openChat',
      'workbench.action.chat.open',
    ];

    void vscode.commands.getCommands(true).then((allCommands) => {
      const availableChat = chatCommands.find((cmd) => allCommands.includes(cmd));

      if (availableChat) {
        // Open chat and submit the query
        void vscode.commands.executeCommand(availableChat, { query: context, isPartialQuery: false }).then(undefined, () => {
          // Fallback: open chat then try to submit separately
          void vscode.commands.executeCommand(availableChat).then(() => {
            // Small delay to let the chat panel open, then submit
            setTimeout(() => {
              void vscode.commands.executeCommand('workbench.action.chat.submit', context).then(undefined, () => {
                this.copyAiContextToClipboard(context);
              });
            }, 300);
          }, () => {
            this.copyAiContextToClipboard(context);
          });
        });
      } else {
        this.copyAiContextToClipboard(context);
      }
    }, () => {
      this.copyAiContextToClipboard(context);
    });
  }

  private copyAiContextToClipboard(context: string): void {
    void vscode.env.clipboard.writeText(context).then(() => {
      void vscode.window.showInformationMessage(INFO_AI_CONTEXT_COPIED);
    });
  }

  private handleAddAnnotation(payload: Record<string, unknown>): void {
    const nodeId = payload['nodeId'] as string | undefined;
    const name = payload['name'] as string ?? 'node';

    if (!nodeId) {
      return;
    }

    // Check for existing annotation to pre-fill
    const projectRoot = getProjectRoot();
    const existing = projectRoot ? getAnnotationForNode(projectRoot, nodeId) : undefined;
    const isEdit = !!existing;

    void vscode.window
      .showInputBox({
        prompt: promptAnnotation(name, isEdit),
        placeHolder: PLACEHOLDER_ANNOTATION,
        value: existing?.text ?? '',
      })
      .then((text) => {
        if (text !== undefined && text !== '') {
          const annotation = {
            nodeId,
            text,
            author: 'user',
            timestamp: new Date().toISOString(),
          };

          // Send annotation to the WebView for display
          this.panel.webview.postMessage({
            type: 'annotationAdded',
            payload: annotation,
          });

          // Persist (replaces any existing annotation for this node)
          if (projectRoot) {
            setAnnotation(projectRoot, {
              id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              ...annotation,
            });
          }
        }
      });
  }

  private getWebviewContent(): string {
    const webview = this.panel.webview;

    // Resolve path to the bundled graph viewer
    // The bundle is copied into the extension's dist/ folder during build
    const graphViewerPath = vscode.Uri.joinPath(
      this.extensionUri, 'dist', 'graph-viewer.bundle.js',
    );
    const graphViewerUri = webview.asWebviewUri(graphViewerPath);

    // Cache-bust: append a timestamp so the webview always loads the latest bundle
    const cacheBuster = `?v=${Date.now()}`;
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data:;">
  <title>AskhaGraph</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #ag-root { height: 100%; width: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="ag-root"></div>
  <script nonce="${nonce}" src="${graphViewerUri}${cacheBuster}"></script>
</body>
</html>`;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
