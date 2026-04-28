/**
 * @module toolbar
 * Toolbar component for the Graph Viewer.
 * Contains: search input, view toggle (Graph/List), fit-to-viewport button, direction indicator.
 */

import { UI_STRINGS } from './constants.js';
import type { ViewMode } from './types.js';

/** Toolbar event callbacks. */
export interface ToolbarCallbacks {
  onViewToggle: (mode: ViewMode) => void;
  onFitToViewport: () => void;
  onDepthChange?: (depth: number) => void;
}

/**
 * Toolbar component for the Graph Viewer panel.
 * Provides search, view toggle, and utility buttons.
 */
export class Toolbar {
  private element: HTMLElement | null = null;
  private viewMode: ViewMode = 'graph';
  private callbacks: ToolbarCallbacks;
  private graphButton: HTMLButtonElement | null = null;
  private listButton: HTMLButtonElement | null = null;
  private depthLabel: HTMLElement | null = null;
  private depthMinusBtn: HTMLButtonElement | null = null;
  private depthPlusBtn: HTMLButtonElement | null = null;
  private currentDepth: number = 0;
  private maxDepth: number = 0;

  constructor(callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
  }

  /** Create and mount the toolbar in the given container. Returns the toolbar element. */
  create(container: HTMLElement): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'ag-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', UI_STRINGS.accessibility.toolbarRegion);
    toolbar.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--ag-bg-secondary, #252526);
      border-bottom: 1px solid var(--ag-border, #3e3e42);
      min-height: 36px;
      flex-shrink: 0;
    `;

    // Search area will be added by SearchController
    // We leave a slot for it

    // Depth control (left side)
    const depthControl = this.createDepthControl();
    toolbar.appendChild(depthControl);

    // Right-side controls
    const controls = document.createElement('div');
    controls.className = 'ag-toolbar-controls';
    controls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    `;

    // View toggle: Graph / List
    const viewToggle = this.createViewToggle();
    controls.appendChild(viewToggle);

    // Separator
    const separator = document.createElement('div');
    separator.style.cssText = `
      width: 1px;
      height: 16px;
      background: var(--ag-border, #3e3e42);
      margin: 0 4px;
    `;
    controls.appendChild(separator);

    // Fit to viewport button
    const fitButton = this.createToolbarButton(
      '⊞',
      UI_STRINGS.toolbar.fitToViewport,
      () => this.callbacks.onFitToViewport(),
    );
    controls.appendChild(fitButton);

    toolbar.appendChild(controls);
    container.insertBefore(toolbar, container.firstChild);

    this.element = toolbar;
    return toolbar;
  }

  /** Get the toolbar element (for SearchController to attach to). */
  getElement(): HTMLElement | null {
    return this.element;
  }

  /** Update the active view mode indicator. */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.updateViewToggle();
  }

  /** Update the depth indicator and control bounds. */
  setDepthInfo(currentDepth: number, maxDepth: number): void {
    this.currentDepth = currentDepth;
    this.maxDepth = maxDepth;
    this.updateDepthControl();
  }

  /** Get the current view mode. */
  getViewMode(): ViewMode {
    return this.viewMode;
  }

  /** Destroy the toolbar. */
  destroy(): void {
    if (this.element) {
      this.element.remove();
    }
    this.element = null;
    this.graphButton = null;
    this.listButton = null;
    this.depthLabel = null;
    this.depthMinusBtn = null;
    this.depthPlusBtn = null;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private createDepthControl(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ag-depth-control';
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 2px;
      margin-right: 8px;
    `;

    // Minus button
    this.depthMinusBtn = document.createElement('button');
    this.depthMinusBtn.className = 'ag-depth-btn';
    this.depthMinusBtn.textContent = '−';
    this.depthMinusBtn.setAttribute('aria-label', UI_STRINGS.toolbar.depthDecrease);
    this.depthMinusBtn.style.cssText = `
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--ag-border, #3e3e42);
      background: var(--ag-bg-tertiary, #2d2d30);
      color: var(--ag-text-secondary, #9d9d9d);
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      font-weight: bold;
      line-height: 1;
      padding: 0;
    `;
    this.depthMinusBtn.addEventListener('click', () => {
      if (this.currentDepth > 1) {
        this.currentDepth--;
        this.updateDepthControl();
        this.callbacks.onDepthChange?.(this.currentDepth);
      }
    });
    this.depthMinusBtn.addEventListener('mouseenter', () => {
      this.depthMinusBtn!.style.background = 'var(--ag-bg-primary, #1e1e1e)';
    });
    this.depthMinusBtn.addEventListener('mouseleave', () => {
      this.depthMinusBtn!.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
    });
    container.appendChild(this.depthMinusBtn);

    // Depth label
    this.depthLabel = document.createElement('span');
    this.depthLabel.className = 'ag-depth-label';
    this.depthLabel.style.cssText = `
      font-family: var(--ag-font-mono, monospace);
      font-size: var(--ag-font-size-sm, 11px);
      color: var(--ag-text-secondary, #9d9d9d);
      min-width: 56px;
      text-align: center;
      user-select: none;
      white-space: nowrap;
    `;
    this.depthLabel.textContent = UI_STRINGS.toolbar.depthLabel(0, 0);
    container.appendChild(this.depthLabel);

    // Plus button
    this.depthPlusBtn = document.createElement('button');
    this.depthPlusBtn.className = 'ag-depth-btn';
    this.depthPlusBtn.textContent = '+';
    this.depthPlusBtn.setAttribute('aria-label', UI_STRINGS.toolbar.depthIncrease);
    this.depthPlusBtn.style.cssText = `
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--ag-border, #3e3e42);
      background: var(--ag-bg-tertiary, #2d2d30);
      color: var(--ag-text-secondary, #9d9d9d);
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      font-weight: bold;
      line-height: 1;
      padding: 0;
    `;
    this.depthPlusBtn.addEventListener('click', () => {
      if (this.currentDepth < this.maxDepth) {
        this.currentDepth++;
        this.updateDepthControl();
        this.callbacks.onDepthChange?.(this.currentDepth);
      }
    });
    this.depthPlusBtn.addEventListener('mouseenter', () => {
      this.depthPlusBtn!.style.background = 'var(--ag-bg-primary, #1e1e1e)';
    });
    this.depthPlusBtn.addEventListener('mouseleave', () => {
      this.depthPlusBtn!.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
    });
    container.appendChild(this.depthPlusBtn);

    return container;
  }

  private updateDepthControl(): void {
    if (this.depthLabel) {
      this.depthLabel.textContent = UI_STRINGS.toolbar.depthLabel(this.currentDepth, this.maxDepth);
    }
    if (this.depthMinusBtn) {
      const disabled = this.currentDepth <= 1;
      this.depthMinusBtn.disabled = disabled;
      this.depthMinusBtn.style.opacity = disabled ? '0.4' : '1';
      this.depthMinusBtn.style.cursor = disabled ? 'default' : 'pointer';
    }
    if (this.depthPlusBtn) {
      const disabled = this.currentDepth >= this.maxDepth;
      this.depthPlusBtn.disabled = disabled;
      this.depthPlusBtn.style.opacity = disabled ? '0.4' : '1';
      this.depthPlusBtn.style.cursor = disabled ? 'default' : 'pointer';
    }
  }

  private createViewToggle(): HTMLElement {
    const toggle = document.createElement('div');
    toggle.className = 'ag-view-toggle';
    toggle.setAttribute('role', 'radiogroup');
    toggle.setAttribute('aria-label', 'View mode');
    toggle.style.cssText = `
      display: flex;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--ag-border, #3e3e42);
    `;

    this.graphButton = this.createToggleButton(
      UI_STRINGS.toolbar.graphView,
      'graph',
      true,
    );
    this.listButton = this.createToggleButton(
      UI_STRINGS.toolbar.listView,
      'list',
      false,
    );

    toggle.appendChild(this.graphButton);
    toggle.appendChild(this.listButton);

    return toggle;
  }

  private createToggleButton(
    label: string,
    mode: ViewMode,
    isActive: boolean,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `ag-view-toggle-btn ${isActive ? 'active' : ''}`;
    button.textContent = label;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(isActive));
    button.style.cssText = `
      padding: 3px 8px;
      border: none;
      background: ${isActive ? 'var(--ag-bg-tertiary, #2d2d30)' : 'transparent'};
      color: ${isActive ? 'var(--ag-text-primary, #cccccc)' : 'var(--ag-text-muted, #6b7280)'};
      font-family: var(--ag-font-sans, sans-serif);
      font-size: var(--ag-font-size-sm, 11px);
      cursor: pointer;
      outline: none;
    `;

    button.addEventListener('click', () => {
      this.viewMode = mode;
      this.updateViewToggle();
      this.callbacks.onViewToggle(mode);
    });

    button.addEventListener('focus', () => {
      button.style.outline = '1px solid var(--ag-focus-ring, #007acc)';
      button.style.outlineOffset = '-1px';
    });
    button.addEventListener('blur', () => {
      button.style.outline = 'none';
    });

    return button;
  }

  private createToolbarButton(
    icon: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'ag-toolbar-btn';
    button.textContent = icon;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.style.cssText = `
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      color: var(--ag-text-secondary, #9d9d9d);
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'transparent';
    });
    button.addEventListener('focus', () => {
      button.style.outline = '1px solid var(--ag-focus-ring, #007acc)';
      button.style.outlineOffset = '-1px';
    });
    button.addEventListener('blur', () => {
      button.style.outline = 'none';
    });
    button.addEventListener('click', onClick);

    return button;
  }

  private updateViewToggle(): void {
    if (this.graphButton && this.listButton) {
      const isGraph = this.viewMode === 'graph';

      this.graphButton.setAttribute('aria-checked', String(isGraph));
      this.graphButton.style.background = isGraph
        ? 'var(--ag-bg-tertiary, #2d2d30)'
        : 'transparent';
      this.graphButton.style.color = isGraph
        ? 'var(--ag-text-primary, #cccccc)'
        : 'var(--ag-text-muted, #6b7280)';

      this.listButton.setAttribute('aria-checked', String(!isGraph));
      this.listButton.style.background = !isGraph
        ? 'var(--ag-bg-tertiary, #2d2d30)'
        : 'transparent';
      this.listButton.style.color = !isGraph
        ? 'var(--ag-text-primary, #cccccc)'
        : 'var(--ag-text-muted, #6b7280)';
    }
  }
}
