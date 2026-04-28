/**
 * @module webview-entry
 * WebView entry point for the AskhaGraph Graph Viewer.
 * Bundled into a single JS file loaded by the VS Code WebView.
 */

import { GraphViewerApp, initializeGraphViewer } from './index.js';
import { getVsCodeApi } from './messaging.js';
import type { SerializedCallGraph } from './types.js';

let app: GraphViewerApp | null = null;
let pendingFindPath: { source: string; target: string } | null = null;

function applyFindPath(source: string, target: string): 'ok' | 'error' {
  const renderer = app?.getRenderer();
  if (!renderer) return 'error';

  const nodeMap = renderer.getNodeMap();
  let sourceId: string | null = null;
  let targetId: string | null = null;

  for (const [id, node] of nodeMap) {
    if (!sourceId && (node.name === source || node.qualifiedName === source)) {
      sourceId = id;
    }
    if (!targetId && (node.name === target || node.qualifiedName === target)) {
      targetId = id;
    }
    if (sourceId && targetId) break;
  }

  if (sourceId && targetId) {
    const path = renderer.highlightPath(sourceId, targetId);
    if (path.length === 0) {
      showPathError(source, target, 'No call path exists between these functions in the analyzed graph.');
      return 'error';
    } else {
      const listView = app?.getListView();
      if (listView) {
        listView.applyFilters({ pathNodeIds: new Set(path) });
      }
      return 'ok';
    }
  } else {
    const missing = !sourceId ? source : target;
    showPathError(source, target, `"${missing}" was not found in the call graph. It may be outside the analysis scope.`);
    return 'error';
  }
}

function showPathError(source: string, target: string, detail: string): void {
  // Clear the rendered graph
  const cy = app?.getRenderer().getCytoscape();
  if (cy) {
    cy.elements().remove();
  }

  // Clear the list view
  const listContainer = document.querySelector('.ag-list-container');
  if (listContainer) {
    listContainer.innerHTML = '';
  }

  const root = document.getElementById('ag-root');
  if (!root) return;

  // Find or create the error overlay
  let overlay = document.getElementById('ag-path-error');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ag-path-error';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
      pointer-events: none;
    `;
    root.appendChild(overlay);
  }

  // Build error card using DOM API (safe — no innerHTML with user data)
  const card = document.createElement('div');
  card.style.cssText = `
    text-align: center; padding: 32px; max-width: 400px;
    background: var(--ag-bg-secondary, #252526);
    border: 1px solid var(--ag-border, #3e3e42);
    border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
  `;

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size: 32px; margin-bottom: 12px;';
  icon.textContent = '🚫';
  card.appendChild(icon);

  const title = document.createElement('div');
  title.style.cssText = 'font-family: var(--ag-font-sans, sans-serif); font-size: 14px; font-weight: 600; color: var(--ag-text-primary, #cccccc); margin-bottom: 8px;';
  title.textContent = 'No path found';
  card.appendChild(title);

  const pathLabel = document.createElement('div');
  pathLabel.style.cssText = 'font-family: var(--ag-font-mono, monospace); font-size: 12px; color: var(--ag-text-muted, #6b7280); margin-bottom: 12px;';
  pathLabel.textContent = `${source} → ${target}`;
  card.appendChild(pathLabel);

  const detailEl = document.createElement('div');
  detailEl.style.cssText = 'font-family: var(--ag-font-sans, sans-serif); font-size: 12px; color: var(--ag-text-secondary, #9d9d9d); line-height: 1.5;';
  detailEl.textContent = detail;
  card.appendChild(detailEl);

  overlay.innerHTML = '';
  overlay.appendChild(card);
}

function showError(root: HTMLElement, message: string, detail?: string): void {
  root.innerHTML = `
    <div style="padding: 20px; color: #ef4444; font-family: monospace; font-size: 13px;">
      <div style="font-weight: bold; margin-bottom: 8px;">AskhaGraph Error</div>
      <div>${message}</div>
      ${detail ? `<pre style="margin-top: 8px; opacity: 0.7; white-space: pre-wrap; font-size: 11px;">${detail}</pre>` : ''}
    </div>
  `;
}

function init(): void {
  const root = document.getElementById('ag-root');
  if (!root) return;

  try {
    console.log('[AskhaGraph] Initializing...');
    // This internally calls acquireVsCodeApi() once via createMessageBridge()
    app = initializeGraphViewer(root);
    console.log('[AskhaGraph] Initialized successfully');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AskhaGraph] Init failed:', msg);
    showError(root, 'Failed to initialize graph viewer', msg);
    return;
  }

  // Send 'ready' to extension host using the cached VS Code API
  const vscodeApi = getVsCodeApi();
  if (vscodeApi) {
    vscodeApi.postMessage({ type: 'ready' });
    console.log('[AskhaGraph] Sent ready signal');
  }

  // Listen for messages from extension host
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'loadGraph' && msg.payload) {
      const data = msg.payload as SerializedCallGraph;
      const settings = msg.settings as Record<string, unknown> | undefined;

      // Clear any previous path error overlay
      const pathError = document.getElementById('ag-path-error');
      if (pathError) pathError.remove();

      try {
        const hideLibrary = settings && typeof settings.hideLibraryCalls === 'boolean'
          ? settings.hideLibraryCalls
          : true;

        app?.getSearchController().setHideLibraryFlag(hideLibrary);

        // Always show loading — it stays until everything is ready
        app?.showLoading();

        // Render the graph (behind the loading overlay if path pending)
        app?.loadGraph(data, !!pendingFindPath);

        if (hideLibrary) {
          app?.getSearchController().reapplyFilters();
        }

        if (pendingFindPath) {
          // Path mode: keep loading overlay, apply path after layout settles,
          // then either show the path result or show an error
          const fp = pendingFindPath;
          pendingFindPath = null;
          setTimeout(() => {
            const result = applyFindPath(fp.source, fp.target);
            if (result === 'error') {
              // Error overlay is already shown by applyFindPath — hide loading
              app?.hideLoading();
            } else {
              // Path applied successfully — remove loading to reveal the graph
              app?.hideLoading();
            }
          }, 1500);
        } else {
          // Normal analysis: loading overlay is removed by loadGraph itself
          // (hideLoading is called at the start of loadGraph in index.ts)
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[AskhaGraph] loadGraph failed:', errMsg);
        if (root) showError(root, 'Failed to render graph', errMsg);
      }
    } else if (msg && msg.type === 'showLoading') {
      app?.showLoading();
    } else if (msg && msg.type === 'annotationAdded' && msg.payload) {
      const { nodeId, text, author, timestamp } = msg.payload as {
        nodeId: string; text: string; author: string; timestamp: string;
      };
      app?.addAnnotation(nodeId, text, author, timestamp);
    } else if (msg && msg.type === 'settingsChanged' && msg.payload) {
      const settings = msg.payload as Record<string, unknown>;
      if (typeof settings.hideLibraryCalls === 'boolean') {
        const search = app?.getSearchController();
        // Skip if the value is already set (avoids redundant re-render)
        if (search && search.isHideLibraryEnabled() !== settings.hideLibraryCalls) {
          search.setHideLibrary(settings.hideLibraryCalls);
        }
      }
    } else if (msg && msg.type === 'findPath' && msg.payload) {
      const { source, target } = msg.payload as { source: string; target: string };
      // Queue the findPath — loadGraph handler will apply it after layout settles
      pendingFindPath = { source, target };
      // Show loading immediately
      app?.showLoading();
      // Fallback: if loadGraph already finished, apply after a delay
      setTimeout(() => {
        if (pendingFindPath) {
          const fp = pendingFindPath;
          pendingFindPath = null;
          applyFindPath(fp.source, fp.target);
          app?.hideLoading();
        }
      }, 2000);
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
