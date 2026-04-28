/**
 * @module list-view
 * Accessible tree view alternative to the graph visualization.
 * Renders the call graph as a nested list following WAI-ARIA TreeView pattern.
 */

import { NODE_ICONS, UI_STRINGS } from './constants.js';
import type { IMessageBridge } from './messaging.js';
import type {
  SerializedNode,
  SerializedCallGraph,
  GraphEventListener,
  GraphEvent,
  FilterPreset,
} from './types.js';

/**
 * Active filter state for the list view.
 * Mirrors the graph view's combined filter model.
 */
export interface ListViewFilterState {
  query: string;
  preset: FilterPreset;
  hideLibrary: boolean;
  pathNodeIds: Set<string> | null;
}

/**
 * Accessible list view that renders the call graph as a nested tree.
 * Implements WAI-ARIA TreeView pattern with full keyboard navigation.
 */
export class GraphListView {
  private container: HTMLElement | null = null;
  private messageBridge: IMessageBridge;
  private graphData: SerializedCallGraph | null = null;
  private nodeMap: Map<string, SerializedNode> = new Map();
  private adjacency: Map<string, string[]> = new Map();
  private expandedNodes: Set<string> = new Set();
  private selectedNodeId: string | null = null;
  private listeners: GraphEventListener[] = [];
  private treeElement: HTMLElement | null = null;
  private filterState: ListViewFilterState = { query: '', preset: 'all', hideLibrary: false, pathNodeIds: null };

  constructor(messageBridge: IMessageBridge) {
    this.messageBridge = messageBridge;
  }

  /** Initialize the list view in the given container. */
  initialize(container: HTMLElement): void {
    this.container = container;
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', UI_STRINGS.accessibility.listRegion);
  }

  /** Render the call graph as a tree. */
  render(graphData: SerializedCallGraph): void {
    if (!this.container) return;

    this.graphData = graphData;
    this.buildNodeMap(graphData.nodes);
    this.buildAdjacency(graphData);

    // Determine entry point
    const entryPointId = this.findEntryPointId(graphData);

    // Only set default expansion on first render (when expandedNodes is empty)
    if (this.expandedNodes.size === 0) {
      this.expandedNodes.add(entryPointId);
      this.expandFirstLevels(entryPointId, 2);
    }

    // Build tree DOM
    this.container.innerHTML = '';
    this.treeElement = this.buildTree(entryPointId);
    this.container.appendChild(this.treeElement);

    // Set up keyboard navigation
    this.setupKeyboardNavigation();
  }

  /** Select a node by ID (for synchronization with graph view). */
  selectNode(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.updateSelection();

    // Ensure the node is visible (expand ancestors)
    this.expandAncestors(nodeId);
  }

  /** Get the currently selected node ID. */
  getSelectedNodeId(): string | null {
    return this.selectedNodeId;
  }

  /** Register a listener for graph events. */
  on(listener: GraphEventListener): void {
    this.listeners.push(listener);
  }

  /** Remove a listener. */
  off(listener: GraphEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * Apply combined filters to the list view.
   * Mirrors the graph view's filter model: search query + preset + hideLibrary.
   * Re-renders the tree, excluding nodes that don't pass all active filters.
   */
  applyFilters(state: Partial<ListViewFilterState>): void {
    let changed = false;
    if (state.query !== undefined && state.query !== this.filterState.query) {
      this.filterState.query = state.query;
      changed = true;
    }
    if (state.preset !== undefined && state.preset !== this.filterState.preset) {
      this.filterState.preset = state.preset;
      changed = true;
    }
    if (state.hideLibrary !== undefined && state.hideLibrary !== this.filterState.hideLibrary) {
      this.filterState.hideLibrary = state.hideLibrary;
      changed = true;
    }
    if (state.pathNodeIds !== undefined) {
      this.filterState.pathNodeIds = state.pathNodeIds;
      changed = true;
    }
    if (changed) {
      this.rerenderTree();
    }
  }

  /** Get the current filter state. */
  getFilterState(): Readonly<ListViewFilterState> {
    return this.filterState;
  }

  /** Destroy the list view and clean up. */
  destroy(): void {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.container = null;
    this.graphData = null;
    this.nodeMap.clear();
    this.adjacency.clear();
    this.expandedNodes.clear();
    this.selectedNodeId = null;
    this.listeners = [];
    this.treeElement = null;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private buildNodeMap(nodes: SerializedNode[]): void {
    this.nodeMap.clear();
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  private buildAdjacency(graphData: SerializedCallGraph): void {
    this.adjacency.clear();
    for (const edge of graphData.edges) {
      if (!this.adjacency.has(edge.sourceId)) {
        this.adjacency.set(edge.sourceId, []);
      }
      const children = this.adjacency.get(edge.sourceId)!;
      // Deduplicate: skip if this child is already listed under this parent
      if (!children.includes(edge.targetId)) {
        children.push(edge.targetId);
      }
    }
  }

  private findEntryPointId(graphData: SerializedCallGraph): string {
    const entryPoint = graphData.metadata.entryPoint;
    for (const node of graphData.nodes) {
      if (node.qualifiedName === entryPoint || node.name === entryPoint) {
        return node.id;
      }
    }
    return graphData.nodes[0]?.id || '';
  }

  private expandFirstLevels(nodeId: string, levels: number): void {
    if (levels <= 0) return;
    this.expandedNodes.add(nodeId);
    const children = this.adjacency.get(nodeId) || [];
    for (const childId of children) {
      this.expandFirstLevels(childId, levels - 1);
    }
  }

  private buildTree(entryPointId: string): HTMLElement {
    const tree = document.createElement('ul');
    tree.setAttribute('role', 'tree');
    tree.className = 'ag-tree';
    tree.style.cssText = `
      list-style: none;
      padding: 0;
      margin: 0;
      font-family: var(--ag-font-mono, monospace);
      font-size: var(--ag-font-size-md, 13px);
      color: var(--ag-text-primary, #cccccc);
    `;

    const visited = new Set<string>();
    const entryItem = this.buildTreeItem(entryPointId, 0, visited);
    if (entryItem) {
      tree.appendChild(entryItem);
    }

    return tree;
  }

  private buildTreeItem(
    nodeId: string,
    depth: number,
    visited: Set<string>,
  ): HTMLElement | null {
    const node = this.nodeMap.get(nodeId);
    if (!node) return null;

    // Apply filters: hide library, preset, and search query
    if (!this.isNodeVisible(node)) {
      return null;
    }

    if (visited.has(nodeId)) {
      // Cycle indicator
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('data-node-id', nodeId);
      li.setAttribute('data-name', node.name);
      li.setAttribute('data-filepath', node.filePath);
      li.setAttribute('data-kind', node.kind);
      li.setAttribute('data-qualified', node.qualifiedName);
      li.style.cssText = this.getTreeItemStyle(depth);

      const content = this.buildItemContent(node, true);
      li.appendChild(content);
      return li;
    }

    visited.add(nodeId);

    const children = this.adjacency.get(nodeId) || [];
    const hasChildren = children.length > 0;
    const isExpanded = this.expandedNodes.has(nodeId);

    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('data-node-id', nodeId);
    li.setAttribute('data-name', node.name);
    li.setAttribute('data-filepath', node.filePath);
    li.setAttribute('data-kind', node.kind);
    li.setAttribute('data-qualified', node.qualifiedName);
    li.setAttribute('tabindex', '-1');
    li.style.cssText = this.getTreeItemStyle(depth);

    if (hasChildren) {
      li.setAttribute('aria-expanded', String(isExpanded));
    }

    // Build content row
    const row = document.createElement('div');
    row.className = 'ag-tree-item-row';
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 3px;
      cursor: pointer;
      user-select: none;
    `;

    // Expand/collapse toggle
    if (hasChildren) {
      const toggle = document.createElement('button');
      toggle.className = 'ag-tree-toggle';
      toggle.setAttribute('aria-label', isExpanded ? UI_STRINGS.listView.collapseLabel : UI_STRINGS.listView.expandLabel);
      toggle.setAttribute('tabindex', '-1');
      toggle.textContent = isExpanded ? '▼' : '▶';
      toggle.style.cssText = `
        background: none;
        border: none;
        color: var(--ag-text-muted, #6b7280);
        font-size: 10px;
        width: 16px;
        cursor: pointer;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNode(nodeId);
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.style.width = '16px';
      spacer.style.display = 'inline-block';
      row.appendChild(spacer);
    }

    // Node content
    const content = this.buildItemContent(node, false);
    row.appendChild(content);

    // Click handler for navigation
    row.addEventListener('click', () => {
      this.selectNodeById(nodeId);
      this.messageBridge.postMessage({
        type: 'navigate',
        payload: {
          filePath: node.filePath,
          line: node.line,
          column: node.column,
        },
      });
    });

    // Hover style
    row.addEventListener('mouseenter', () => {
      row.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = this.selectedNodeId === nodeId
        ? 'var(--ag-bg-tertiary, #2d2d30)'
        : 'transparent';
    });

    li.appendChild(row);

    // Children
    if (hasChildren && isExpanded) {
      const childList = document.createElement('ul');
      childList.setAttribute('role', 'group');
      childList.style.cssText = 'list-style: none; padding: 0; margin: 0;';

      for (const childId of children) {
        const childItem = this.buildTreeItem(childId, depth + 1, new Set(visited));
        if (childItem) {
          childList.appendChild(childItem);
        }
      }

      li.appendChild(childList);
    }

    return li;
  }

  private buildItemContent(node: SerializedNode, isCycle: boolean): HTMLElement {
    const content = document.createElement('span');
    content.className = 'ag-tree-item-content';
    content.style.cssText = 'display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;';

    // Type icon
    const icon = document.createElement('span');
    icon.className = 'ag-tree-item-icon';
    icon.textContent = NODE_ICONS[node.kind] || '?';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = `
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      background: ${this.getNodeColor(node.kind)};
      color: #fff;
      flex-shrink: 0;
    `;
    content.appendChild(icon);

    // Name
    const name = document.createElement('span');
    name.className = 'ag-tree-item-name';
    name.textContent = isCycle ? `↻ ${node.name}` : node.name;
    name.style.cssText = `
      font-family: var(--ag-font-mono, monospace);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    if (isCycle) {
      name.style.opacity = '0.6';
      name.style.fontStyle = 'italic';
    }
    content.appendChild(name);

    // File path and line
    const meta = document.createElement('span');
    meta.className = 'ag-tree-item-meta';
    const fileName = node.filePath.split('/').pop() || node.filePath;
    meta.textContent = `${fileName}:${node.line + 1}`;
    meta.style.cssText = `
      font-family: var(--ag-font-sans, sans-serif);
      font-size: var(--ag-font-size-sm, 11px);
      color: var(--ag-text-muted, #6b7280);
      flex-shrink: 0;
    `;
    content.appendChild(meta);

    return content;
  }

  private getNodeColor(kind: string): string {
    const colors: Record<string, string> = {
      function: '#3b82f6',
      method: '#6366f1',
      class: '#8b5cf6',
      conditional: '#f59e0b',
      loop: '#10b981',
      callback: '#6366f1',
      unresolved: '#6b7280',
    };
    return colors[kind] || '#6b7280';
  }

  private getTreeItemStyle(depth: number): string {
    return `padding-left: ${depth * 16}px; list-style: none;`;
  }

  /**
   * Check if a node passes all active filters.
   * A node must pass hideLibrary, preset, AND search query to be visible.
   */
  private isNodeVisible(node: SerializedNode): boolean {
    // Path filter — if active, only show nodes on the path
    if (this.filterState.pathNodeIds && this.filterState.pathNodeIds.size > 0) {
      const nodeId = `${node.filePath}:${node.line}:${node.name}`;
      const inPath = this.filterState.pathNodeIds.has(nodeId) ||
        Array.from(this.filterState.pathNodeIds).some(id => id.endsWith(`:${node.name}`));
      if (!inPath) return false;
    }

    // Hide library calls
    if (this.filterState.hideLibrary && node.metadata.isUnresolved) {
      return false;
    }

    // Hide conditional nodes whose children are all hidden (library calls)
    if (this.filterState.hideLibrary && node.kind === 'conditional') {
      const nodeId = `${node.filePath}:${node.line}:${node.kind}`;
      const children = this.adjacency.get(nodeId) || [];
      if (children.length > 0) {
        const allChildrenHidden = children.every((childId) => {
          const child = this.nodeMap.get(childId);
          return child ? !this.isChildVisible(child) : true;
        });
        if (allChildrenHidden) return false;
      }
    }

    // Preset filter
    if (this.filterState.preset !== 'all' && !this.matchesPreset(node, this.filterState.preset)) {
      return false;
    }

    // Search query filter
    if (this.filterState.query) {
      const lowerQuery = this.filterState.query.toLowerCase();
      const matchesName = node.name.toLowerCase().includes(lowerQuery);
      const matchesQualified = node.qualifiedName.toLowerCase().includes(lowerQuery);
      const matchesFile = node.filePath.toLowerCase().includes(lowerQuery);
      const matchesKind = node.kind.toLowerCase().includes(lowerQuery);
      if (!matchesName && !matchesQualified && !matchesFile && !matchesKind) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a child node would be visible (non-recursive, avoids infinite loops).
   * Used by isNodeVisible to determine if a conditional's children are all hidden.
   */
  private isChildVisible(node: SerializedNode): boolean {
    if (this.filterState.hideLibrary && node.metadata.isUnresolved) {
      return false;
    }
    if (this.filterState.hideLibrary && node.kind === 'conditional') {
      const nodeId = `${node.filePath}:${node.line}:${node.kind}`;
      const children = this.adjacency.get(nodeId) || [];
      if (children.length > 0) {
        return children.some((childId) => {
          const child = this.nodeMap.get(childId);
          return child ? this.isChildVisible(child) : false;
        });
      }
    }
    return true;
  }

  /** Check if a node matches a filter preset. */
  private matchesPreset(node: SerializedNode, preset: FilterPreset): boolean {
    switch (preset) {
      case 'functions':
        return node.kind === 'function';
      case 'conditionals':
        return node.kind === 'conditional';
      case 'uncovered':
        return node.metadata.coverage !== undefined && node.metadata.coverage < 50;
      case 'high-complexity':
        return node.metadata.cyclomaticComplexity !== undefined && node.metadata.cyclomaticComplexity > 10;
      case 'dead-code':
        return node.metadata.coverage === 0;
      case 'hide-library':
        return !node.metadata.isUnresolved;
      case 'by-file':
        return true;
      case 'all':
      default:
        return true;
    }
  }

  private toggleNode(nodeId: string): void {
    if (this.expandedNodes.has(nodeId)) {
      this.expandedNodes.delete(nodeId);
      this.emit({ type: 'nodeCollapsed', nodeId });
    } else {
      this.expandedNodes.add(nodeId);
      this.emit({ type: 'nodeExpanded', nodeId });
    }

    this.rerenderTree();
  }

  /** Re-render the tree DOM without resetting expansion state. */
  private rerenderTree(): void {
    if (!this.graphData || !this.container) return;

    const entryPointId = this.findEntryPointId(this.graphData);

    this.container.innerHTML = '';
    this.treeElement = this.buildTree(entryPointId);
    this.container.appendChild(this.treeElement);
    this.setupKeyboardNavigation();

    // Restore selection highlight
    if (this.selectedNodeId) {
      this.updateSelection();
    }
  }

  private selectNodeById(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.updateSelection();
    const node = this.nodeMap.get(nodeId);
    if (node) {
      this.emit({ type: 'nodeSelected', nodeId, node });
    }
  }

  private updateSelection(): void {
    if (!this.treeElement) return;

    // Remove previous selection
    const items = this.treeElement.querySelectorAll<HTMLElement>('[role="treeitem"]');
    for (const item of items) {
      const row = item.querySelector<HTMLElement>('.ag-tree-item-row');
      if (row) {
        row.style.background = 'transparent';
      }
      item.setAttribute('aria-selected', 'false');
    }

    // Apply new selection
    if (this.selectedNodeId) {
      const selected = this.treeElement.querySelector<HTMLElement>(
        `[data-node-id="${this.selectedNodeId}"]`,
      );
      if (selected) {
        selected.setAttribute('aria-selected', 'true');
        const row = selected.querySelector<HTMLElement>('.ag-tree-item-row');
        if (row) {
          row.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
        }
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  private expandAncestors(nodeId: string): void {
    // Build reverse adjacency to find parents
    const parents = new Map<string, string>();
    for (const [parentId, children] of this.adjacency) {
      for (const childId of children) {
        parents.set(childId, parentId);
      }
    }

    // Walk up the parent chain, tracking visited nodes to break cycles
    const visited = new Set<string>();
    let current = nodeId;
    let expanded = false;
    while (parents.has(current)) {
      const parent = parents.get(current)!;
      if (visited.has(parent)) break; // Cycle detected — stop walking
      visited.add(parent);
      if (!this.expandedNodes.has(parent)) {
        this.expandedNodes.add(parent);
        expanded = true;
      }
      current = parent;
    }

    // Only re-render if we actually expanded something
    if (expanded) {
      this.rerenderTree();
    }
  }

  private setupKeyboardNavigation(): void {
    if (!this.treeElement) return;

    this.treeElement.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const treeItem = target.closest<HTMLElement>('[role="treeitem"]');
      if (!treeItem) return;

      const nodeId = treeItem.getAttribute('data-node-id');
      if (!nodeId) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = this.getNextVisibleItem(treeItem);
          if (next) {
            next.focus();
            next.setAttribute('tabindex', '0');
            treeItem.setAttribute('tabindex', '-1');
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = this.getPreviousVisibleItem(treeItem);
          if (prev) {
            prev.focus();
            prev.setAttribute('tabindex', '0');
            treeItem.setAttribute('tabindex', '-1');
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const isExpanded = treeItem.getAttribute('aria-expanded');
          if (isExpanded === 'false') {
            this.toggleNode(nodeId);
          } else if (isExpanded === 'true') {
            // Move to first child
            const firstChild = treeItem.querySelector<HTMLElement>('[role="treeitem"]');
            if (firstChild) {
              firstChild.focus();
              firstChild.setAttribute('tabindex', '0');
              treeItem.setAttribute('tabindex', '-1');
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const isExpandedLeft = treeItem.getAttribute('aria-expanded');
          if (isExpandedLeft === 'true') {
            this.toggleNode(nodeId);
          } else {
            // Move to parent
            const parentItem = treeItem.parentElement?.closest<HTMLElement>('[role="treeitem"]');
            if (parentItem) {
              parentItem.focus();
              parentItem.setAttribute('tabindex', '0');
              treeItem.setAttribute('tabindex', '-1');
            }
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          this.selectNodeById(nodeId);
          const node = this.nodeMap.get(nodeId);
          if (node) {
            this.messageBridge.postMessage({
              type: 'navigate',
              payload: {
                filePath: node.filePath,
                line: node.line,
                column: node.column,
              },
            });
          }
          break;
        }
        case ' ': {
          e.preventDefault();
          const hasChildren = treeItem.getAttribute('aria-expanded') !== null;
          if (hasChildren) {
            this.toggleNode(nodeId);
          }
          break;
        }
      }
    });

    // Make first item focusable
    const firstItem = this.treeElement.querySelector<HTMLElement>('[role="treeitem"]');
    if (firstItem) {
      firstItem.setAttribute('tabindex', '0');
    }
  }

  private getNextVisibleItem(current: HTMLElement): HTMLElement | null {
    const allItems = this.getAllVisibleItems();
    const idx = allItems.indexOf(current);
    return idx >= 0 && idx < allItems.length - 1 ? allItems[idx + 1] : null;
  }

  private getPreviousVisibleItem(current: HTMLElement): HTMLElement | null {
    const allItems = this.getAllVisibleItems();
    const idx = allItems.indexOf(current);
    return idx > 0 ? allItems[idx - 1] : null;
  }

  private getAllVisibleItems(): HTMLElement[] {
    if (!this.treeElement) return [];
    return Array.from(
      this.treeElement.querySelectorAll<HTMLElement>(
        '[role="treeitem"]:not([style*="display: none"])',
      ),
    );
  }

  private emit(event: GraphEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
