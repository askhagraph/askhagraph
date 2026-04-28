/**
 * @module @askhagraph/graph-viewer
 * Interactive Cytoscape.js graph viewer for AskhaGraph.
 * Entry point that exports the main components and orchestrates initialization.
 */

export { GraphRenderer } from './graph-renderer.js';
export { GraphListView } from './list-view.js';
export type { ListViewFilterState } from './list-view.js';
export { SearchController } from './search.js';
export { Toolbar } from './toolbar.js';
export { ContextMenu } from './context-menu.js';
export { GraphEventManager } from './events.js';
export { createMessageBridge, VsCodeMessageBridge, DevMessageBridge } from './messaging.js';
export type { IMessageBridge } from './messaging.js';
export { createGraphStylesheet } from './styles.js';
export { createElkLayoutOptions, getAutoCollapsedNodes, countDescendants, computeMaxDepth } from './layout.js';
export { UI_STRINGS, NODE_ICONS, CSS_VARS, LAYOUT, DEFAULT_THEME } from './constants.js';
export type {
  SerializedCallGraph,
  SerializedNode,
  SerializedEdge,
  SerializedNodeMetadata,
  SerializedGraphMetadata,
  NodeKind,
  EdgeKind,
  MessageType,
  ViewerMessage,
  NavigateMessage,
  AskAiMessage,
  AddAnnotationMessage,
  ExpandNodeMessage,
  CollapseNodeMessage,
  GraphEventType,
  GraphEvent,
  GraphEventListener,
  NodeSelectedEvent,
  NodeExpandedEvent,
  NodeCollapsedEvent,
  ViewChangedEvent,
  ViewMode,
  FilterPreset,
  ContextMenuItem,
} from './types.js';

import { GraphRenderer } from './graph-renderer.js';
import { GraphListView } from './list-view.js';
import { SearchController } from './search.js';
import { Toolbar } from './toolbar.js';
import { createMessageBridge } from './messaging.js';
import { DEFAULT_THEME, UI_STRINGS } from './constants.js';
import type { SerializedCallGraph, ViewMode } from './types.js';

/**
 * Initialize the complete Graph Viewer application.
 * This is the main entry point for WebView embedding.
 *
 * @param root - The root HTML element to mount the viewer into.
 * @returns An object with methods to control the viewer.
 */
export function initializeGraphViewer(root: HTMLElement): GraphViewerApp {
  return new GraphViewerApp(root);
}

/**
 * The top-level Graph Viewer application.
 * Orchestrates the toolbar, graph renderer, list view, and search.
 */
export class GraphViewerApp {
  private root: HTMLElement;
  private graphContainer: HTMLElement;
  private listContainer: HTMLElement;
  private renderer: GraphRenderer;
  private listView: GraphListView;
  private searchController: SearchController;
  private toolbar: Toolbar;
  private viewMode: ViewMode = 'graph';
  private liveRegion: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;

    // Inject default theme CSS variables
    this.injectTheme();

    // Set up root styles
    root.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
      background: var(--ag-bg-primary, #1e1e1e);
      color: var(--ag-text-primary, #cccccc);
    `;

    // Create message bridge
    const messageBridge = createMessageBridge();

    // Create toolbar
    this.toolbar = new Toolbar({
      onViewToggle: (mode) => this.setViewMode(mode),
      onFitToViewport: () => this.renderer.fitToViewport(),
      onDepthChange: (depth) => {
        this.renderer.setVisibleDepth(depth);
        this.searchController.reapplyFilters();
      },
    });
    this.toolbar.create(root);

    // Create graph container
    this.graphContainer = document.createElement('div');
    this.graphContainer.className = 'ag-graph-container';
    this.graphContainer.style.cssText = `
      flex: 1;
      position: relative;
      overflow: hidden;
    `;
    root.appendChild(this.graphContainer);

    // Create list container (hidden by default)
    this.listContainer = document.createElement('div');
    this.listContainer.className = 'ag-list-container';
    this.listContainer.style.cssText = `
      flex: 1;
      overflow: auto;
      display: none;
      padding: 8px;
    `;
    root.appendChild(this.listContainer);

    // Create ARIA live region for accessibility announcements
    this.liveRegion = document.createElement('div');
    this.liveRegion.id = 'ag-live-region';
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    root.appendChild(this.liveRegion);

    // Initialize renderer
    this.renderer = new GraphRenderer(messageBridge);
    this.renderer.initialize(this.graphContainer);

    // Initialize list view
    this.listView = new GraphListView(messageBridge);
    this.listView.initialize(this.listContainer);

    // Initialize search controller
    this.searchController = new SearchController(this.renderer, this.listView);
    const toolbarEl = this.toolbar.getElement();
    if (toolbarEl) {
      this.searchController.createSearchUI(toolbarEl);
    }

    // Synchronize selection between views
    this.setupSelectionSync();
  }

  /** Load and render a call graph. */
  loadGraph(graphJson: SerializedCallGraph, keepLoading: boolean = false): void {
    if (!keepLoading) {
      this.hideLoading();
    }
    this.renderer.render(graphJson);
    this.listView.render(graphJson);

    // Update depth control in toolbar
    const currentDepth = this.renderer.getVisibleDepth();
    const maxDepth = this.renderer.getMaxDepth();
    this.toolbar.setDepthInfo(currentDepth, maxDepth);
  }

  /** Show a loading indicator over the graph area. */
  showLoading(): void {
    this.hideLoading();
    const overlay = document.createElement('div');
    overlay.id = 'ag-loading-overlay';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ag-bg-primary, #1e1e1e);
      z-index: 100;
      font-family: var(--ag-font-sans, sans-serif);
      font-size: var(--ag-font-size-md, 13px);
      color: var(--ag-text-muted, #6b7280);
    `;
    overlay.innerHTML = `
      <div style="text-align: center;">
        <div style="margin-bottom: 8px; font-size: 24px;">⏳</div>
        <div>Analyzing call graph...</div>
      </div>
    `;
    this.graphContainer.appendChild(overlay);
  }

  /** Remove the loading indicator. */
  hideLoading(): void {
    const existing = document.getElementById('ag-loading-overlay');
    if (existing) existing.remove();
  }

  /** Set the annotation for a node (replaces any existing annotation). */
  addAnnotation(nodeId: string, text: string, _author: string, _timestamp: string): void {
    // Store in the node metadata (replace, don't append)
    const nodeMap = this.renderer.getNodeMap();
    const node = nodeMap.get(nodeId);
    if (node) {
      node.metadata.annotations = [text];
    }

    // Update the Cytoscape node data so the tooltip can read it
    const cy = this.renderer.getCytoscape();
    if (cy) {
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.length > 0) {
        const raw = cyNode.data('raw');
        if (raw) {
          raw.metadata.annotations = [text];
          cyNode.data('raw', raw);
          cyNode.addClass('has-annotation');
        }
      }
    }
  }

  /** Get the annotation for a node (returns the latest one, or undefined). */
  getAnnotation(nodeId: string): string | undefined {
    const nodeMap = this.renderer.getNodeMap();
    const node = nodeMap.get(nodeId);
    const annotations = node?.metadata.annotations;
    return annotations && annotations.length > 0 ? annotations[annotations.length - 1] : undefined;
  }

  /** Switch between graph and list view. */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.toolbar.setViewMode(mode);

    if (mode === 'graph') {
      this.graphContainer.style.display = 'block';
      this.listContainer.style.display = 'none';
    } else {
      this.graphContainer.style.display = 'none';
      this.listContainer.style.display = 'block';
    }
  }

  /** Get the current view mode. */
  getViewMode(): ViewMode {
    return this.viewMode;
  }

  /** Get the graph renderer instance. */
  getRenderer(): GraphRenderer {
    return this.renderer;
  }

  /** Get the list view instance. */
  getListView(): GraphListView {
    return this.listView;
  }

  /** Get the search controller instance. */
  getSearchController(): SearchController {
    return this.searchController;
  }

  /** Destroy the entire viewer and clean up. */
  destroy(): void {
    this.searchController.destroy();
    this.listView.destroy();
    this.renderer.destroy();
    this.toolbar.destroy();
    this.root.innerHTML = '';
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private injectTheme(): void {
    // Only inject if not already present
    if (!document.getElementById('ag-theme-defaults')) {
      const style = document.createElement('style');
      style.id = 'ag-theme-defaults';
      style.textContent = DEFAULT_THEME;
      document.head.appendChild(style);
    }
  }

  private setupSelectionSync(): void {
    let syncing = false; // Guard against circular sync

    // Graph → List sync
    this.renderer.on((event) => {
      if (event.type === 'nodeSelected' && !syncing) {
        syncing = true;
        try {
          this.listView.selectNode(event.nodeId);
        } finally {
          syncing = false;
        }
      }
    });

    // List → Graph sync
    this.listView.on((event) => {
      if (event.type === 'nodeSelected' && !syncing) {
        syncing = true;
        try {
          const cy = this.renderer.getCytoscape();
          if (cy) {
            cy.nodes().unselect();
            const node = cy.getElementById(event.nodeId);
            if (node.length > 0) {
              node.select();
            }
          }
        } finally {
          syncing = false;
        }
      }
    });
  }
}

// Note: Auto-initialization is handled by webview-entry.ts when bundled for WebViews.
// This module is a library — it exports components but does not self-initialize.
