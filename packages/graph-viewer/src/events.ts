/**
 * @module events
 * Event handlers for the Graph Viewer.
 * Wires Cytoscape events to IDE messaging and UI interactions.
 */

import type cytoscape from 'cytoscape';
import type { IMessageBridge } from './messaging.js';
import type { SerializedNode, GraphEvent, GraphEventListener } from './types.js';
import { ContextMenu } from './context-menu.js';
import { UI_STRINGS } from './constants.js';

/** Options for configuring graph event handlers. */
export interface EventHandlerOptions {
  cy: cytoscape.Core;
  messageBridge: IMessageBridge;
  onNodeSelect?: (nodeId: string) => void;
  getNodeData?: (nodeId: string) => SerializedNode | undefined;
  onPathFrom?: (nodeId: string) => void;
  onPathTo?: (nodeId: string) => void;
  onClearPath?: () => void;
  onPathChanged?: (pathNodeIds: string[] | null) => void;
}

/**
 * Manages all event handlers for the Cytoscape graph instance.
 */
export class GraphEventManager {
  private cy: cytoscape.Core;
  private messageBridge: IMessageBridge;
  private contextMenu: ContextMenu;
  private tooltip: HTMLElement | null = null;
  private listeners: GraphEventListener[] = [];
  private focusedNodeId: string | null = null;
  private options: EventHandlerOptions;

  constructor(options: EventHandlerOptions) {
    this.cy = options.cy;
    this.messageBridge = options.messageBridge;
    this.contextMenu = new ContextMenu();
    this.options = options;
  }

  /** Set up all event handlers on the Cytoscape instance. */
  initialize(): void {
    this.setupNodeClick();
    this.setupNodeRightClick();
    this.setupNodeHover();
    this.setupCanvasInteractions();
    this.setupKeyboardNavigation();
  }

  /** Register a listener for graph events. */
  on(listener: GraphEventListener): void {
    this.listeners.push(listener);
  }

  /** Remove a listener. */
  off(listener: GraphEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** Get the currently focused node ID. */
  getFocusedNodeId(): string | null {
    return this.focusedNodeId;
  }

  /** Programmatically focus a node (for accessibility). */
  focusNode(nodeId: string): void {
    // Remove previous focus
    this.cy.nodes('.focused').removeClass('focused');

    const node = this.cy.getElementById(nodeId);
    if (node.length > 0) {
      node.addClass('focused');
      this.focusedNodeId = nodeId;
      this.announceNode(node);
      this.emit({
        type: 'nodeSelected',
        nodeId,
        node: node.data('raw') as SerializedNode,
      });
    }
  }

  /** Clean up all event handlers and DOM elements. */
  destroy(): void {
    this.contextMenu.hide();
    this.hideTooltip();
    this.listeners = [];
    this.focusedNodeId = null;
  }

  // ─── Private: Event Setup ──────────────────────────────────────────────────

  private setupNodeClick(): void {
    this.cy.on('tap', 'node', (event) => {
      const node = event.target;
      const data = node.data();

      // Navigate to source
      this.messageBridge.postMessage({
        type: 'navigate',
        payload: {
          filePath: data.filePath,
          line: data.line,
          column: data.column || 0,
        },
      });

      // Selection sync (safe — circular loop is guarded in setupSelectionSync)
      this.options.onNodeSelect?.(node.id());
      this.emit({
        type: 'nodeSelected',
        nodeId: node.id(),
        node: data.raw as SerializedNode,
      });
    });
  }

  private setupNodeRightClick(): void {
    this.cy.on('cxttap', 'node', (event) => {
      const node = event.target;
      const nodeId = node.id();
      const data = node.data();
      const renderedPos = event.renderedPosition || { x: 0, y: 0 };

      // Get container offset for proper positioning
      const container = this.cy.container();
      const containerRect = container?.getBoundingClientRect() || { left: 0, top: 0 };

      const x = renderedPos.x + containerRect.left;
      const y = renderedPos.y + containerRect.top;

      const hasAnnotation = node.hasClass('has-annotation');

      const items = ContextMenu.getDefaultItems({
        onAskAi: (id) => {
          const fileName = (data.filePath || '').split(/[/\\]/).pop() || data.filePath;
          const context = [
            `Analyze this function from the AskhaGraph call graph:`,
            `- Name: ${data.qualifiedName || data.name}`,
            `- File: ${fileName}:${data.line + 1}`,
            ``,
            `Please explain what this function does, its role in the call graph, and any potential issues.`,
          ].join('\n');

          // Send to extension host (works in VS Code with Copilot)
          this.messageBridge.postMessage({
            type: 'askAi',
            payload: {
              nodeId: id,
              name: data.name,
              qualifiedName: data.qualifiedName,
              filePath: data.filePath,
              line: data.line,
            },
          });

          // Also copy to clipboard as a reliable fallback
          navigator.clipboard?.writeText(context).then(() => {
            this.showToast('AI context copied to clipboard — paste into chat (Ctrl+L)');
          }).catch(() => {
            // Clipboard API not available
          });
        },
        onAddAnnotation: (id) => {
          this.messageBridge.postMessage({
            type: 'addAnnotation',
            payload: { nodeId: id, name: data.name },
          });
        },
        onCopyPath: () => {
          const fileName = (data.filePath || '').split(/[/\\]/).pop() || data.filePath;
          const path = `${fileName}:${data.line + 1}`;
          navigator.clipboard?.writeText(path).catch(() => {
            console.log('Copy path:', path);
          });
        },
        onShowCallers: (_id) => {
          // Highlight incoming edges
          const incomers = node.incomers('edge');
          this.cy.elements().removeClass('highlighted');
          incomers.addClass('highlighted');
          incomers.sources().addClass('highlighted');
        },
        onShowCallees: (_id) => {
          // Highlight outgoing edges
          const outgoers = node.outgoers('edge');
          this.cy.elements().removeClass('highlighted');
          outgoers.addClass('highlighted');
          outgoers.targets().addClass('highlighted');
        },
      }, { hasAnnotation });

      // Add path-finding items
      items.push({
        id: 'path-from',
        label: 'Find path from here',
        icon: '🟢',
        action: (id) => {
          this.options.onPathFrom?.(id);
          this.showToast(`Path source set: ${data.name}. Right-click another node → "Find path to here"`);
        },
      });
      items.push({
        id: 'path-to',
        label: 'Find path to here',
        icon: '🎯',
        action: (id) => {
          this.options.onPathTo?.(id);
        },
      });
      items.push({
        id: 'clear-path',
        label: 'Clear path',
        icon: '✕',
        action: () => {
          this.options.onClearPath?.();
        },
      });

      this.contextMenu.show(x, y, nodeId, items);
    });
  }

  private setupNodeHover(): void {
    this.cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      const data = node.data();

      // Highlight connected edges
      node.connectedEdges().addClass('highlighted');

      // Show tooltip
      const renderedPos = event.renderedPosition || { x: 0, y: 0 };
      const container = this.cy.container();
      const containerRect = container?.getBoundingClientRect() || { left: 0, top: 0 };

      // Build annotation text if present
      const raw = data.raw as SerializedNode | undefined;
      const annotations = raw?.metadata?.annotations;
      const annotationText = annotations && annotations.length > 0
        ? annotations.join(' · ')
        : undefined;

      this.showTooltip(
        renderedPos.x + containerRect.left,
        renderedPos.y + containerRect.top - 40,
        data.qualifiedName || data.name,
        `${this.toRelativePath(data.filePath)}:${data.line + 1}`,
        annotationText,
      );
    });

    this.cy.on('mouseout', 'node', (event) => {
      const node = event.target;
      node.connectedEdges().removeClass('highlighted');
      this.hideTooltip();
    });
  }

  private setupCanvasInteractions(): void {
    // Dismiss context menu on canvas tap
    this.cy.on('tap', (event) => {
      if (event.target === this.cy) {
        this.contextMenu.hide();
      }
    });
  }

  private setupKeyboardNavigation(): void {
    const container = this.cy.container();
    if (!container) return;

    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', UI_STRINGS.accessibility.graphRegion);

    container.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.focusedNodeId) {
        // Focus entry point on first key press
        const entryNode = this.cy.nodes('[?isEntryPoint]').first();
        if (entryNode.length > 0) {
          this.focusNode(entryNode.id());
        }
        return;
      }

      const focused = this.cy.getElementById(this.focusedNodeId);
      if (focused.length === 0) return;

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          const outgoing = focused.outgoers('node').first();
          if (outgoing.length > 0) this.focusNode(outgoing.id());
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const incoming = focused.incomers('node').first();
          if (incoming.length > 0) this.focusNode(incoming.id());
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const siblings = focused.outgoers('node');
          if (siblings.length > 1) {
            // Navigate to next sibling among outgoers
            const siblingsArr = siblings.toArray();
            const next = siblingsArr[1]; // Skip first (already visited via ArrowRight)
            if (next) this.focusNode(next.id());
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const siblingsUp = focused.incomers('node');
          if (siblingsUp.length > 1) {
            const siblingsUpArr = siblingsUp.toArray();
            const prev = siblingsUpArr[siblingsUpArr.length - 1];
            if (prev) this.focusNode(prev.id());
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const data = focused.data();
          this.messageBridge.postMessage({
            type: 'navigate',
            payload: {
              filePath: data.filePath,
              line: data.line,
              column: data.column || 0,
            },
          });
          break;
        }
        case 'Tab': {
          // Tab moves between graph regions (handled at toolbar level)
          break;
        }
      }
    });
  }

  // ─── Private: Tooltip ──────────────────────────────────────────────────────

  private showTooltip(x: number, y: number, title: string, subtitle: string, annotation?: string): void {
    this.hideTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'ag-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      transform: translateX(-50%);
      z-index: 9999;
      padding: 4px 8px;
      background: var(--ag-bg-tertiary, #2d2d30);
      border: 1px solid var(--ag-border, #3e3e42);
      border-radius: 4px;
      font-family: var(--ag-font-mono, monospace);
      font-size: var(--ag-font-size-sm, 11px);
      color: var(--ag-text-primary, #cccccc);
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      max-width: 400px;
    `;

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.fontWeight = '500';
    tooltip.appendChild(titleEl);

    const subtitleEl = document.createElement('div');
    subtitleEl.textContent = subtitle;
    subtitleEl.style.color = 'var(--ag-text-muted, #6b7280)';
    subtitleEl.style.fontSize = 'var(--ag-font-size-sm, 11px)';
    tooltip.appendChild(subtitleEl);

    if (annotation) {
      const annotationEl = document.createElement('div');
      annotationEl.textContent = `📝 ${annotation}`;
      annotationEl.style.cssText = `
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid var(--ag-border, #3e3e42);
        color: var(--ag-text-accent, #4fc1ff);
        font-family: var(--ag-font-sans, sans-serif);
        white-space: pre-wrap;
      `;
      tooltip.appendChild(annotationEl);
    }

    document.body.appendChild(tooltip);
    this.tooltip = tooltip;

    // Adjust if overflowing
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      tooltip.style.left = `${window.innerWidth - rect.width - 8}px`;
      tooltip.style.transform = 'none';
    }
    if (rect.top < 0) {
      tooltip.style.top = `${y + 60}px`;
    }
  }

  private hideTooltip(): void {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  }

  // ─── Private: Accessibility ────────────────────────────────────────────────

  private announceNode(node: cytoscape.NodeSingular): void {
    const data = node.data();
    const liveRegion = document.getElementById('ag-live-region');
    if (liveRegion) {
      liveRegion.textContent = UI_STRINGS.accessibility.focusedNode(
        data.name,
        UI_STRINGS.nodeTypes[data.kind as keyof typeof UI_STRINGS.nodeTypes] || data.kind,
        data.filePath?.split('/').pop() || '',
        data.line,
      );
    }
  }

  // ─── Private: Path Helpers ──────────────────────────────────────────────────

  /**
   * Convert an absolute file path to a project-relative path.
   * Strips common prefixes like drive letters and project root directories.
   */
  private toRelativePath(filePath: string | undefined): string {
    if (!filePath) return '';
    const normalized = filePath.replace(/\\/g, '/');

    // Try to find a common project root indicator and strip everything before it
    // Look for common project structure markers
    const markers = ['/src/', '/lib/', '/packages/', '/app/'];
    for (const marker of markers) {
      const idx = normalized.indexOf(marker);
      if (idx >= 0) {
        return normalized.slice(idx + 1); // +1 to skip the leading /
      }
    }

    // Fallback: strip everything up to and including the last occurrence of a
    // directory that looks like a project root (contains common root-level dirs)
    const parts = normalized.split('/');
    // Find the deepest directory that's a common root indicator
    for (let i = parts.length - 1; i >= 0; i--) {
      if (['src', 'lib', 'packages', 'app'].includes(parts[i])) {
        return parts.slice(i).join('/');
      }
    }

    // Last resort: just show the last 3 path segments
    if (parts.length > 3) {
      return parts.slice(-3).join('/');
    }

    return normalized;
  }

  // ─── Private: Event Emission ───────────────────────────────────────────────

  private emit(event: GraphEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Show a brief toast notification in the graph viewer. */
  showToast(message: string): void {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--ag-bg-secondary, #252526);
      color: var(--ag-text-primary, #cccccc);
      border: 1px solid var(--ag-border, #3e3e42);
      border-radius: 6px;
      padding: 8px 16px;
      font-family: var(--ag-font-sans, sans-serif);
      font-size: var(--ag-font-size-md, 13px);
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity 0.2s;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }
}
