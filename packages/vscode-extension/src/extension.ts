/**
 * @module extension
 * Main entry point for the AskhaGraph VS Code / Kiro extension.
 *
 * Registers commands, manages the Core Engine child process,
 * and orchestrates the Graph Viewer WebView panel.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { loadAnnotations } from './annotations.js';
import {
  ERR_NO_ACTIVE_EDITOR,
  ERR_NO_FUNCTION_AT_CURSOR,
  ERR_NO_EDITOR,
  ERR_NO_FUNCTION,
  ERR_NO_WORKSPACE,
  ERR_ENGINE_START_FAILED,
  ERR_NO_ENTRY_POINT,
  PROGRESS_ANALYZING,
  PROGRESS_SENDING,
  PROMPT_DESCRIBE_FEATURE,
  PLACEHOLDER_FEATURE,
  PROMPT_SOURCE_FUNCTION,
  PLACEHOLDER_SOURCE,
  PROMPT_TARGET_FUNCTION,
  PLACEHOLDER_TARGET,
  PLACEHOLDER_ENTRY_POINT,
  STATUSBAR_PATH_READY,
  STATUSBAR_PATH_SOURCE_SET,
  STATUSBAR_PATH_TARGET_SET,
  CLI_TERMINAL_NAME,
  CLI_WELCOME_MESSAGE,
  errAnalysisFailed,
  errPathNotFound,
  infoPathSourceSet,
  infoPathTargetSet,
  errGeneric,
} from './constants.js';
import { EngineProcess, disposeOutputChannel } from './engine-process.js';
import type { EngineRequest, EngineResponse } from './engine-process.js';
import { GraphViewerPanel } from './webview-panel.js';
import { findFunctionAtCursor, getProjectRoot } from './utils.js';

// ─── State ───────────────────────────────────────────────────────────────────

let engineProcess: EngineProcess | null = null;
let pathSource: string | null = null;
let pathTarget: string | null = null;
let pathStatusBar: vscode.StatusBarItem | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

/**
 * Called when the extension is activated.
 * Registers commands and sets up disposables.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Register: Analyze Current Function
  const analyzeCurrentFunction = vscode.commands.registerCommand(
    'askhagraph.analyzeCurrentFunction',
    () => handleAnalyzeCurrentFunction(context),
  );

  // Register: Analyze Feature (natural language)
  const analyzeFeature = vscode.commands.registerCommand(
    'askhagraph.analyzeFeature',
    () => handleAnalyzeFeature(context),
  );

  // Register: Programmatic analysis API for AI assistants
  const analyzeApi = vscode.commands.registerCommand(
    'askhagraph.analyze',
    (options: { entryPoint?: string; description?: string; direction?: string }) =>
      handleAnalyzeApi(context, options),
  );

  context.subscriptions.push(analyzeCurrentFunction, analyzeFeature, analyzeApi);

  // ─── Path Finding ──────────────────────────────────────────────────────────

  // Status bar item showing path source/target selection
  pathStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  pathStatusBar.command = 'askhagraph.clearPath';
  context.subscriptions.push(pathStatusBar);
  updatePathStatusBar();

  const setPathSource = vscode.commands.registerCommand(
    'askhagraph.setPathSource',
    () => handleSetPathSource(),
  );

  const setPathTarget = vscode.commands.registerCommand(
    'askhagraph.setPathTarget',
    () => handleSetPathTarget(context),
  );

  const clearPath = vscode.commands.registerCommand(
    'askhagraph.clearPath',
    () => handleClearPath(),
  );

  const findPath = vscode.commands.registerCommand(
    'askhagraph.findPath',
    () => handleFindPath(context),
  );

  context.subscriptions.push(setPathSource, setPathTarget, clearPath, findPath);

  // Register terminal profile for AskhaGraph CLI
  const cliProfileProvider = vscode.window.registerTerminalProfileProvider(
    'askhagraph.cli',
    new AskhaGraphTerminalProfileProvider(context),
  );
  context.subscriptions.push(cliProfileProvider);

  // Listen for configuration changes and push to the active webview
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('askhagraph.hideLibraryCalls')) {
      const config = vscode.workspace.getConfiguration('askhagraph');
      const hideLibrary = config.get<boolean>('hideLibraryCalls', true);
      // Send to the active panel if it exists
      const panel = GraphViewerPanel.getInstance();
      if (panel) {
        panel.sendSettings({ hideLibraryCalls: hideLibrary });
      }
    }
  });
  context.subscriptions.push(configListener);
}

// ─── Terminal Profile Provider ────────────────────────────────────────────────

/**
 * Provides a terminal profile that opens PowerShell with an `askhagraph`
 * function alias pointing to the bundled CLI script.
 *
 * Users see "AskhaGraph CLI" in the terminal dropdown and can immediately
 * run commands like `askhagraph src/auth.ts:login --format tree`.
 */
class AskhaGraphTerminalProfileProvider implements vscode.TerminalProfileProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideTerminalProfile(): vscode.TerminalProfile {
    const cliPath = this.resolveCliPath();
    const projectRoot = getProjectRoot() ?? '';

    // Detect available PowerShell: prefer pwsh (PowerShell Core), fall back to powershell.exe (Windows PowerShell)
    const shellPath = this.resolvePowerShellPath();

    // Create a PowerShell function alias so `askhagraph` works as a command.
    // The function forwards all arguments to `node <cli-script>`.
    // Using single quotes around the path to handle spaces.
    const escapedCliPath = cliPath.replace(/'/g, "''");
    const initCommand = `function askhagraph { node '${escapedCliPath}' @args }; Write-Host '${CLI_WELCOME_MESSAGE}' -ForegroundColor Cyan`;

    return new vscode.TerminalProfile({
      name: CLI_TERMINAL_NAME,
      shellPath,
      shellArgs: ['-NoExit', '-Command', initCommand],
      cwd: projectRoot || undefined,
      iconPath: new vscode.ThemeIcon('type-hierarchy'),
    });
  }

  /**
   * Resolve the PowerShell executable path.
   * Prefers pwsh (PowerShell Core) if available, falls back to powershell.exe (Windows PowerShell).
   */
  private resolvePowerShellPath(): string {
    const fs = require('node:fs');
    const candidates = [
      'pwsh',
      'pwsh.exe',
      'powershell.exe',
      'powershell',
    ];

    // Check common install locations on Windows
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    const extraPaths = [
      path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ];

    for (const fullPath of extraPaths) {
      try {
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      } catch {
        // continue
      }
    }

    // Fall back to bare command names (relies on PATH)
    // powershell.exe is always available on Windows
    if (process.platform === 'win32') {
      return 'powershell.exe';
    }

    // On macOS/Linux, pwsh must be installed separately
    return candidates[0];
  }

  /**
   * Resolve the CLI entry script path.
   * Checks for a bundled CLI first, then falls back to monorepo dev mode.
   */
  private resolveCliPath(): string {
    const fs = require('node:fs');

    // 1. Bundled CLI inside the extension package
    const bundledPath = path.join(this.context.extensionPath, 'dist', 'cli.js');
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }

    // 2. Monorepo dev mode: resolve from workspace node_modules
    const workspaceRoot = getProjectRoot();
    if (workspaceRoot) {
      const monorepoPath = path.join(
        workspaceRoot,
        'packages',
        'cli',
        'dist',
        'index.js',
      );
      if (fs.existsSync(monorepoPath)) {
        return monorepoPath;
      }
    }

    // 3. Last resort: try require.resolve
    try {
      return require.resolve('@askhagraph/cli/dist/index.js');
    } catch {
      // If nothing found, return the bundled path and let Node give a clear error
      return bundledPath;
    }
  }
}

/**
 * Called when the extension is deactivated.
 * Cleans up the Core Engine child process and output channel.
 */
export function deactivate(): void {
  if (engineProcess) {
    engineProcess.stop();
    engineProcess = null;
  }
  disposeOutputChannel();
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleAnalyzeCurrentFunction(
  context: vscode.ExtensionContext,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(ERR_NO_ACTIVE_EDITOR);
    return;
  }

  const document = editor.document;
  const position = editor.selection.active;
  const functionName = findFunctionAtCursor(document, position);

  if (!functionName) {
    void vscode.window.showWarningMessage(ERR_NO_FUNCTION_AT_CURSOR);
    return;
  }

  const filePath = document.uri.fsPath;
  const entryPoint = `${filePath}:${functionName}`;

  await runAnalysis(context, { entryPoint });
}

async function handleAnalyzeFeature(
  context: vscode.ExtensionContext,
): Promise<void> {
  const description = await vscode.window.showInputBox({
    prompt: PROMPT_DESCRIBE_FEATURE,
    placeHolder: PLACEHOLDER_FEATURE,
  });

  if (!description) {
    return; // User cancelled
  }

  await runAnalysis(context, { description });
}

async function handleAnalyzeApi(
  context: vscode.ExtensionContext,
  options: { entryPoint?: string; description?: string; direction?: string },
): Promise<Record<string, unknown> | undefined> {
  const response = await runAnalysis(context, options);
  return response?.payload;
}

// ─── Path Finding Handlers ───────────────────────────────────────────────────

function updatePathStatusBar(): void {
  if (!pathStatusBar) return;

  if (!pathSource && !pathTarget) {
    pathStatusBar.hide();
    return;
  }

  const srcLabel = pathSource?.split(':').pop() ?? '?';
  const tgtLabel = pathTarget?.split(':').pop() ?? '?';

  if (pathSource && pathTarget) {
    pathStatusBar.text = `$(arrow-right) 🟢 ${srcLabel} → 🎯 ${tgtLabel}`;
    pathStatusBar.tooltip = STATUSBAR_PATH_READY;
  } else if (pathSource) {
    pathStatusBar.text = `$(arrow-right) 🟢 ${srcLabel} → ?`;
    pathStatusBar.tooltip = STATUSBAR_PATH_SOURCE_SET;
  } else {
    pathStatusBar.text = `$(arrow-right) ? → 🎯 ${tgtLabel}`;
    pathStatusBar.tooltip = STATUSBAR_PATH_TARGET_SET;
  }

  pathStatusBar.show();
}

function handleSetPathSource(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(ERR_NO_EDITOR);
    return;
  }

  const functionName = findFunctionAtCursor(editor.document, editor.selection.active);
  if (!functionName) {
    void vscode.window.showWarningMessage(ERR_NO_FUNCTION);
    return;
  }

  pathSource = `${editor.document.uri.fsPath}:${functionName}`;
  updatePathStatusBar();
  void vscode.window.showInformationMessage(infoPathSourceSet(functionName));
}

async function handleSetPathTarget(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(ERR_NO_EDITOR);
    return;
  }

  const functionName = findFunctionAtCursor(editor.document, editor.selection.active);
  if (!functionName) {
    void vscode.window.showWarningMessage(ERR_NO_FUNCTION);
    return;
  }

  pathTarget = `${editor.document.uri.fsPath}:${functionName}`;
  updatePathStatusBar();

  // If source is already set, auto-analyze
  if (pathSource) {
    await runPathAnalysis(context, pathSource, pathTarget);
  } else {
    void vscode.window.showInformationMessage(infoPathTargetSet(functionName));
  }
}

function handleClearPath(): void {
  pathSource = null;
  pathTarget = null;
  updatePathStatusBar();
}

async function handleFindPath(context: vscode.ExtensionContext): Promise<void> {
  // If both are already set from editor context menu, use them
  if (pathSource && pathTarget) {
    await runPathAnalysis(context, pathSource, pathTarget);
    return;
  }

  // Otherwise prompt
  const sourceInput = await vscode.window.showInputBox({
    prompt: PROMPT_SOURCE_FUNCTION,
    placeHolder: PLACEHOLDER_SOURCE,
    value: pathSource ?? '',
  });
  if (!sourceInput) return;

  const targetInput = await vscode.window.showInputBox({
    prompt: PROMPT_TARGET_FUNCTION,
    placeHolder: PLACEHOLDER_TARGET,
    value: pathTarget ?? '',
  });
  if (!targetInput) return;

  pathSource = sourceInput;
  pathTarget = targetInput;
  updatePathStatusBar();

  await runPathAnalysis(context, pathSource, pathTarget);
}

async function runPathAnalysis(
  context: vscode.ExtensionContext,
  source: string,
  target: string,
): Promise<void> {
  const sourceName = source.split(':').pop() ?? source;
  const targetName = target.split(':').pop() ?? target;

  // Pre-send findPath so the webview queues it BEFORE loadGraph arrives.
  // This ensures the loading overlay stays visible until the path is resolved.
  const existingPanel = GraphViewerPanel.getInstance();
  if (existingPanel) {
    existingPanel.sendFindPath(sourceName, targetName);
  }

  // Run bidirectional analysis from the source (this sends loadGraph to the webview)
  const response = await runAnalysis(context, {
    entryPoint: source,
    direction: 'bidirectional',
  });

  if (!response || response.type === 'error') {
    void vscode.window.showWarningMessage(errPathNotFound(sourceName, targetName));
    return;
  }

  // If the panel was just created by runAnalysis (first time), send findPath now
  const panel = GraphViewerPanel.getInstance();
  if (panel && panel !== existingPanel) {
    panel.sendFindPath(sourceName, targetName);
  }
}

// ─── Core Analysis Flow ──────────────────────────────────────────────────────

async function runAnalysis(
  context: vscode.ExtensionContext,
  options: { entryPoint?: string; description?: string; direction?: string },
): Promise<EngineResponse | undefined> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    void vscode.window.showErrorMessage(ERR_NO_WORKSPACE);
    return undefined;
  }

  // Ensure the engine process is running
  ensureEngineRunning(projectRoot);

  if (!engineProcess) {
    void vscode.window.showErrorMessage(ERR_ENGINE_START_FAILED);
    return undefined;
  }

  // Build the request
  const requestId = generateRequestId();
  let request: EngineRequest;

  if (options.description) {
    request = {
      id: requestId,
      type: 'analyze_nl',
      payload: {
        description: options.description,
        direction: options.direction ?? 'downstream',
        maxDepth: 20,
        includeConditionals: true,
        includeLoops: true,
        includeCallbacks: true,
      },
    };
  } else if (options.entryPoint) {
    request = {
      id: requestId,
      type: 'analyze',
      payload: {
        entryPoint: options.entryPoint,
        direction: options.direction ?? 'downstream',
        maxDepth: 20,
        includeConditionals: true,
        includeLoops: true,
        includeCallbacks: true,
      },
    };
  } else {
    void vscode.window.showErrorMessage(ERR_NO_ENTRY_POINT);
    return undefined;
  }

  // Show progress
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: PROGRESS_ANALYZING,
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        // Send cancel request to engine
        if (engineProcess?.isRunning()) {
          void engineProcess.sendRequest({
            id: generateRequestId(),
            type: 'cancel',
            payload: { requestId: request.id },
          });
        }
      });

      // Show loading indicator in the webview panel if it exists
      const existingPanel = GraphViewerPanel.getInstance();
      if (existingPanel) {
        existingPanel.showLoading();
      }

      progress.report({ message: PROGRESS_SENDING });

      try {
        const response = await engineProcess!.sendRequest(request);

        if (response.type === 'error') {
          const errorPayload = response.payload;
          void vscode.window.showErrorMessage(
            errAnalysisFailed(errorPayload['message'] as string ?? 'Unknown error'),
          );
          return response;
        }

        if (response.type === 'candidates') {
          // Entry point candidates — let user pick
          const candidates = response.payload['candidates'] as Array<{
            symbol: { name: string; qualifiedName: string; filePath: string };
            score: number;
            reason: string;
          }> | undefined;

          if (candidates && candidates.length > 0) {
            const items = candidates.map((c) => ({
              label: c.symbol.qualifiedName || c.symbol.name,
              description: c.symbol.filePath,
              detail: c.reason,
              entryPoint: `${c.symbol.filePath}:${c.symbol.name}`,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: PLACEHOLDER_ENTRY_POINT,
            });

            if (selected) {
              return runAnalysis(context, {
                entryPoint: selected.entryPoint,
                direction: options.direction,
              });
            }
          }
          return response;
        }

        // Success — show the graph
        if (response.type === 'result' && response.payload['graph']) {
          const graphJson = response.payload['graph'] as Record<string, unknown>;

          // Gather all settings to send with the graph so the webview renders once
          const config = vscode.workspace.getConfiguration('askhagraph');
          const hideLibrary = config.get<boolean>('hideLibraryCalls', true);

          const panel = GraphViewerPanel.createOrShow(context.extensionUri, graphJson, {
            hideLibraryCalls: hideLibrary,
          });

          // Load persisted annotations and send them to the webview
          const projectRoot = getProjectRoot();
          if (projectRoot) {
            const annotations = loadAnnotations(projectRoot);
            for (const annotation of annotations) {
              panel.sendAnnotation(annotation.nodeId, annotation.text, annotation.author, annotation.timestamp);
            }
          }
        }

        return response;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Error messages for timeout/crash are already shown by EngineProcess
        if (!message.includes('timed out') && !message.includes('crashed')) {
          void vscode.window.showErrorMessage(errGeneric(message));
        }
        return undefined;
      }
    },
  );
}

// ─── Engine Lifecycle ────────────────────────────────────────────────────────

function ensureEngineRunning(projectRoot: string): void {
  if (engineProcess?.isRunning()) {
    return;
  }

  // Resolve the Core Engine entry script path
  const enginePath = resolveEnginePath();

  const config = vscode.workspace.getConfiguration('askhagraph');
  const timeoutSeconds = config.get<number>('timeout', 60);

  engineProcess = new EngineProcess(enginePath, projectRoot, timeoutSeconds * 1000);
  engineProcess.start();
}

function resolveEnginePath(): string {
  // 1. Prefer the bundled engine shipped inside the extension package.
  //    This is the standalone path that works without npm install.
  //    __dirname points to the extension's dist/ folder at runtime.
  const bundledPath = path.join(__dirname, 'engine', 'engine-bundle.js');
  try {
    const fs = require('node:fs');
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  } catch {
    // fs not available — fall through to legacy resolution
  }

  // 2. Fallback: look in the workspace node_modules (monorepo dev mode)
  const workspaceRoot = getProjectRoot();
  if (workspaceRoot) {
    const monorepoPath = path.join(
      workspaceRoot,
      'node_modules',
      '@askhagraph',
      'core-engine',
      'dist',
      'server-entry.js',
    );
    return monorepoPath;
  }

  // 3. Last resort: require.resolve
  return require.resolve('@askhagraph/core-engine/dist/server-entry.js');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let requestCounter = 0;

function generateRequestId(): string {
  return `req-${Date.now()}-${++requestCounter}`;
}
