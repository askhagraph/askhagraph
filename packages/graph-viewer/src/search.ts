/**
 * @module search
 * Search and filter controller for the Graph Viewer.
 * Manages search input, filter presets, and node visibility.
 */

import type cytoscape from 'cytoscape';
import type { GraphRenderer } from './graph-renderer.js';
import type { GraphListView } from './list-view.js';
import type { FilterPreset, SerializedNode } from './types.js';
import { UI_STRINGS } from './constants.js';

/** Search result with match metadata. */
export interface SearchResult {
  nodeId: string;
  name: string;
  matchField: 'name' | 'qualifiedName' | 'filePath' | 'kind';
}

export class SearchController {
  private renderer: GraphRenderer;
  private listView: GraphListView | null = null;
  private searchInput: HTMLInputElement | null = null;
  private clearButton: HTMLElement | null = null;
  private presetDropdown: HTMLElement | null = null;
  private currentQuery: string = '';
  private currentPreset: FilterPreset = 'all';
  private hideLibrary: boolean = false;
  private results: SearchResult[] = [];

  constructor(renderer: GraphRenderer, listView?: GraphListView) {
    this.renderer = renderer;
    this.listView = listView || null;
  }

  /** Create and mount the search UI in the given toolbar container. */
  createSearchUI(toolbar: HTMLElement): HTMLElement {
    const searchContainer = document.createElement('div');
    searchContainer.className = 'ag-search';
    searchContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      max-width: 320px;
      position: relative;
    `;

    // Search input
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'ag-search-input';
    this.searchInput.placeholder = UI_STRINGS.toolbar.searchPlaceholder;
    this.searchInput.setAttribute('aria-label', UI_STRINGS.accessibility.searchLabel);
    this.searchInput.setAttribute('role', 'searchbox');
    this.searchInput.style.cssText = `
      flex: 1;
      padding: 4px 28px 4px 8px;
      background: var(--ag-bg-tertiary, #2d2d30);
      border: 1px solid var(--ag-border, #3e3e42);
      border-radius: 4px;
      color: var(--ag-text-primary, #cccccc);
      font-family: var(--ag-font-sans, sans-serif);
      font-size: var(--ag-font-size-md, 13px);
      outline: none;
      min-width: 0;
    `;

    this.searchInput.addEventListener('focus', () => {
      this.searchInput!.style.borderColor = 'var(--ag-focus-ring, #007acc)';
    });
    this.searchInput.addEventListener('blur', () => {
      this.searchInput!.style.borderColor = 'var(--ag-border, #3e3e42)';
    });
    this.searchInput.addEventListener('input', () => {
      this.handleSearchInput();
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.clearSearch();
        this.searchInput!.blur();
      } else if (e.key === 'Enter') {
        this.selectFirstResult();
      }
    });

    searchContainer.appendChild(this.searchInput);

    // Clear button
    this.clearButton = document.createElement('button');
    this.clearButton.className = 'ag-search-clear';
    this.clearButton.textContent = '×';
    this.clearButton.setAttribute('aria-label', 'Clear search');
    this.clearButton.style.cssText = `
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--ag-text-muted, #6b7280);
      font-size: 16px;
      cursor: pointer;
      padding: 0 4px;
      display: none;
      line-height: 1;
    `;
    this.clearButton.addEventListener('click', () => {
      this.clearSearch();
    });
    searchContainer.appendChild(this.clearButton);

    toolbar.appendChild(searchContainer);

    // Filter presets dropdown
    this.presetDropdown = this.createPresetDropdown();
    toolbar.appendChild(this.presetDropdown);

    // Global keyboard shortcut: / to focus search
    document.addEventListener('keydown', (e) => {
      if (
        e.key === '/' &&
        document.activeElement !== this.searchInput &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        this.focusSearch();
      }
    });

    return searchContainer;
  }

  /** Focus the search input. */
  focusSearch(): void {
    this.searchInput?.focus();
  }

  /** Toggle hiding of library/unresolved calls. */
  setHideLibrary(hide: boolean): void {
    this.hideLibrary = hide;
    this.renderer.setHideUnresolved(hide);
    this.applyFilters();
    this.syncListViewFilters();
  }

  /** Set the hideLibrary flag without triggering filters or layout.
   *  Use before render() so the initial layout already excludes hidden nodes. */
  setHideLibraryFlag(hide: boolean): void {
    this.hideLibrary = hide;
    this.renderer.setHideUnresolved(hide);
  }

  /** Get the current hideLibrary state. */
  isHideLibraryEnabled(): boolean {
    return this.hideLibrary;
  }

  /** Clear the search and restore all nodes. */
  clearSearch(): void {
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.currentQuery = '';
    this.results = [];
    this.restoreAllNodes();
    this.updateClearButton();
    this.syncListViewFilters();
  }

  /** Apply a filter preset. */
  applyPreset(preset: FilterPreset): void {
    this.currentPreset = preset;
    this.applyFilters();
    this.syncListViewFilters();
  }

  /** Re-apply current filters (call after external changes like depth adjustment).
   *  Skips layout re-run since the caller (e.g., depth change) already triggers one. */
  reapplyFilters(): void {
    this.applyFilters(true);
    this.syncListViewFilters();
  }

  private applyFilters(skipLayout: boolean = false): void {
    const cy = this.renderer.getCytoscape();
    if (!cy) return;

    const nodeMap = this.renderer.getNodeMap();
    const hasQuery = this.currentQuery.length > 0;
    const hasPreset = this.currentPreset !== 'all';
    const lowerQuery = this.currentQuery.toLowerCase();

    if (!hasQuery && !hasPreset && !this.hideLibrary) {
      this.restoreAllNodes();
      if (!skipLayout) this.renderer.runLayout();
      return;
    }

    const hiddenIds = new Set<string>();

    cy.nodes().forEach((node) => {
      const nodeId = node.id();
      const data = nodeMap.get(nodeId);
      if (!data) return;

      let visible = true;
      let hidden = false;

      if (this.hideLibrary && data.metadata.isUnresolved) {
        visible = false;
        hidden = true;
      }

      if (visible && hasPreset) {
        visible = this.matchesPreset(data, this.currentPreset);
      }

      if (visible && hasQuery) {
        visible = this.getMatchField(data, lowerQuery) !== null;
      }

      if (hidden) {
        hiddenIds.add(nodeId);
        node.addClass('hidden');
        node.removeClass('dimmed highlighted');
      } else if (visible) {
        node.removeClass('dimmed hidden');
        node.addClass('highlighted');
      } else {
        node.addClass('dimmed');
        node.removeClass('highlighted hidden');
      }
    });

    // Cascade-hide conditional nodes whose children are all hidden
    if (this.hideLibrary) {
      let changed = true;
      while (changed) {
        changed = false;
        cy.nodes().forEach((node) => {
          if (node.hasClass('hidden')) return;
          const nodeId = node.id();
          const data = nodeMap.get(nodeId);
          if (!data || data.kind !== 'conditional') return;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const outEdges = node.connectedEdges().filter((e: any) => e.source().id() === nodeId);
          if (outEdges.length === 0) return;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allChildrenHidden = outEdges.every((e: any) => e.target().hasClass('hidden'));
          if (allChildrenHidden) {
            node.addClass('hidden');
            node.removeClass('dimmed highlighted');
            hiddenIds.add(nodeId);
            changed = true;
          }
        });
      }
    }

    cy.edges().forEach((edge) => {
      const source = edge.source();
      const target = edge.target();
      if (source.hasClass('hidden') || target.hasClass('hidden')) {
        edge.addClass('hidden');
        edge.removeClass('dimmed');
      } else if (source.hasClass('dimmed') && target.hasClass('dimmed')) {
        edge.addClass('dimmed');
        edge.removeClass('hidden');
      } else {
        edge.removeClass('dimmed hidden');
      }
    });

    // Re-run layout to compact the graph when nodes are hidden
    if (hiddenIds.size > 0 && !skipLayout) {
      this.renderer.runLayout();
    }
  }

  getResults(): SearchResult[] {
    return this.results;
  }

  getQuery(): string {
    return this.currentQuery;
  }

  destroy(): void {
    this.searchInput = null;
    this.clearButton = null;
    this.presetDropdown = null;
    this.results = [];
    this.currentQuery = '';
    this.currentPreset = 'all';
  }

  private handleSearchInput(): void {
    const query = this.searchInput?.value || '';
    this.currentQuery = query;
    this.updateClearButton();
    this.applyFilters();
    this.syncListViewFilters();
  }

  private getMatchField(
    node: SerializedNode,
    lowerQuery: string,
  ): 'name' | 'qualifiedName' | 'filePath' | 'kind' | null {
    if (node.name.toLowerCase().includes(lowerQuery)) return 'name';
    if (node.qualifiedName.toLowerCase().includes(lowerQuery)) return 'qualifiedName';
    if (node.filePath.toLowerCase().includes(lowerQuery)) return 'filePath';
    if (node.kind.toLowerCase().includes(lowerQuery)) return 'kind';
    return null;
  }

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

  private selectFirstResult(): void {
    if (this.results.length === 0) return;
    const firstResult = this.results[0];
    const cy = this.renderer.getCytoscape();
    if (!cy) return;

    const node = cy.getElementById(firstResult.nodeId);
    if (node.length > 0) {
      cy.animate({
        center: { eles: node },
        zoom: cy.zoom(),
      } as unknown as cytoscape.AnimateOptions);
      cy.nodes().unselect();
      node.select();
      this.expandAncestorsOf(firstResult.nodeId);
    }
  }

  private expandAncestorsOf(nodeId: string): void {
    const adjacency = this.renderer.getAdjacency();
    const collapsedNodes = this.renderer.getCollapsedNodes();
    const parents = new Map<string, string>();
    for (const [parentId, children] of adjacency) {
      for (const childId of children) {
        parents.set(childId, parentId);
      }
    }
    const visited = new Set<string>();
    let current = nodeId;
    while (parents.has(current)) {
      const parent = parents.get(current)!;
      if (visited.has(parent)) break;
      visited.add(parent);
      if (collapsedNodes.has(parent)) {
        this.renderer.expandNode(parent);
      }
      current = parent;
    }
  }

  private restoreAllNodes(): void {
    const cy = this.renderer.getCytoscape();
    if (!cy) return;
    cy.nodes().removeClass('dimmed highlighted hidden');
    cy.edges().removeClass('dimmed highlighted hidden');
    this.results = [];
  }

  private syncListViewFilters(): void {
    this.listView?.applyFilters({
      query: this.currentQuery,
      preset: this.currentPreset,
      hideLibrary: this.hideLibrary,
    });
  }

  private updateClearButton(): void {
    if (this.clearButton) {
      this.clearButton.style.display = this.currentQuery ? 'block' : 'none';
    }
  }

  private createPresetDropdown(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ag-filter-presets';
    container.style.cssText = 'position: relative;';

    const button = document.createElement('button');
    button.className = 'ag-filter-presets-btn';
    button.textContent = UI_STRINGS.toolbar.filterPresets;
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.style.cssText = `
      padding: 4px 8px;
      background: var(--ag-bg-tertiary, #2d2d30);
      border: 1px solid var(--ag-border, #3e3e42);
      border-radius: 4px;
      color: var(--ag-text-secondary, #9d9d9d);
      font-family: var(--ag-font-sans, sans-serif);
      font-size: var(--ag-font-size-sm, 11px);
      cursor: pointer;
      white-space: nowrap;
    `;

    const dropdown = document.createElement('ul');
    dropdown.setAttribute('role', 'listbox');
    dropdown.style.cssText = `
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      padding: 4px 0;
      background: var(--ag-bg-secondary, #252526);
      border: 1px solid var(--ag-border, #3e3e42);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      list-style: none;
      z-index: 1000;
      min-width: 160px;
    `;

    const presets: FilterPreset[] = [
      'all', 'functions', 'conditionals', 'uncovered', 'high-complexity', 'dead-code',
    ];

    for (const preset of presets) {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.setAttribute('data-preset', preset);
      item.textContent = UI_STRINGS.filterPresets[preset];
      item.style.cssText = `
        padding: 4px 12px;
        cursor: pointer;
        color: var(--ag-text-primary, #cccccc);
        font-size: var(--ag-font-size-md, 13px);
      `;
      item.addEventListener('mouseenter', () => {
        item.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });
      item.addEventListener('click', () => {
        this.applyPreset(preset);
        dropdown.style.display = 'none';
        button.setAttribute('aria-expanded', 'false');
        if (preset === 'all') {
          button.textContent = UI_STRINGS.toolbar.filterPresets;
          button.style.color = 'var(--ag-text-secondary, #9d9d9d)';
        } else {
          button.textContent = `✓ ${UI_STRINGS.filterPresets[preset]}`;
          button.style.color = 'var(--ag-text-primary, #cccccc)';
        }
      });
      dropdown.appendChild(item);
    }

    button.addEventListener('click', () => {
      const isOpen = dropdown.style.display !== 'none';
      dropdown.style.display = isOpen ? 'none' : 'block';
      button.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target as Node)) {
        dropdown.style.display = 'none';
        button.setAttribute('aria-expanded', 'false');
      }
    });

    container.appendChild(button);
    container.appendChild(dropdown);
    return container;
  }
}
