/**
 * @module context-menu
 * HTML-based context menu for the Graph Viewer.
 * No framework dependency — pure DOM manipulation.
 */

import { UI_STRINGS } from './constants.js';
import type { ContextMenuItem } from './types.js';

/**
 * Context menu component for graph nodes.
 * Renders a simple positioned menu that dismisses on click outside or Escape.
 */
export class ContextMenu {
  private element: HTMLElement | null = null;
  private dismissHandler: ((e: Event) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Default menu items for node context menus. */
  static getDefaultItems(callbacks: {
    onAskAi: (nodeId: string) => void;
    onAddAnnotation: (nodeId: string) => void;
    onCopyPath: (nodeId: string) => void;
    onShowCallers: (nodeId: string) => void;
    onShowCallees: (nodeId: string) => void;
  }, options?: { hasAnnotation?: boolean }): ContextMenuItem[] {
    const annotationLabel = options?.hasAnnotation
      ? 'Edit Annotation'
      : UI_STRINGS.contextMenu.addAnnotation;
    return [
      {
        id: 'ask-ai',
        label: UI_STRINGS.contextMenu.askAi,
        icon: '✨',
        action: callbacks.onAskAi,
      },
      {
        id: 'add-annotation',
        label: annotationLabel,
        icon: '📝',
        action: callbacks.onAddAnnotation,
      },
      {
        id: 'copy-path',
        label: UI_STRINGS.contextMenu.copyPath,
        icon: '📋',
        action: callbacks.onCopyPath,
      },
      {
        id: 'show-callers',
        label: UI_STRINGS.contextMenu.showCallers,
        icon: '⬅',
        action: callbacks.onShowCallers,
      },
      {
        id: 'show-callees',
        label: UI_STRINGS.contextMenu.showCallees,
        icon: '➡',
        action: callbacks.onShowCallees,
      },
    ];
  }

  /**
   * Show the context menu at the given position.
   */
  show(x: number, y: number, nodeId: string, items: ContextMenuItem[]): void {
    this.hide();

    const menu = document.createElement('div');
    menu.className = 'ag-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Node actions');
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      z-index: 10000;
      min-width: 180px;
      background: var(--ag-bg-secondary, #252526);
      border: 1px solid var(--ag-border, #3e3e42);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      font-family: var(--ag-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: var(--ag-font-size-md, 13px);
    `;

    for (const item of items) {
      const menuItem = document.createElement('button');
      menuItem.className = 'ag-context-menu-item';
      menuItem.setAttribute('role', 'menuitem');
      menuItem.setAttribute('data-action', item.id);
      menuItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: transparent;
        color: var(--ag-text-primary, #cccccc);
        font-size: inherit;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        outline: none;
      `;

      menuItem.addEventListener('mouseenter', () => {
        menuItem.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
      });
      menuItem.addEventListener('mouseleave', () => {
        menuItem.style.background = 'transparent';
      });
      menuItem.addEventListener('focus', () => {
        menuItem.style.background = 'var(--ag-bg-tertiary, #2d2d30)';
        menuItem.style.outline = '1px solid var(--ag-focus-ring, #007acc)';
        menuItem.style.outlineOffset = '-1px';
      });
      menuItem.addEventListener('blur', () => {
        menuItem.style.background = 'transparent';
        menuItem.style.outline = 'none';
      });

      if (item.icon) {
        const icon = document.createElement('span');
        icon.textContent = item.icon;
        icon.style.width = '16px';
        icon.style.textAlign = 'center';
        icon.setAttribute('aria-hidden', 'true');
        menuItem.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = item.label;
      menuItem.appendChild(label);

      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        item.action(nodeId);
        this.hide();
      });

      menu.appendChild(menuItem);
    }

    document.body.appendChild(menu);
    this.element = menu;

    // Adjust position if menu overflows viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }

    // Focus first item
    const firstItem = menu.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();

    // Dismiss handlers
    this.dismissHandler = (e: Event) => {
      if (!menu.contains(e.target as Node)) {
        this.hide();
      }
    };
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusNext(menu);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusPrevious(menu);
      }
    };

    // Delay adding click listener to avoid immediate dismiss
    requestAnimationFrame(() => {
      document.addEventListener('click', this.dismissHandler!);
      document.addEventListener('keydown', this.keyHandler!);
    });
  }

  /** Hide and remove the context menu. */
  hide(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    if (this.dismissHandler) {
      document.removeEventListener('click', this.dismissHandler);
      this.dismissHandler = null;
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  /** Whether the context menu is currently visible. */
  get isVisible(): boolean {
    return this.element !== null;
  }

  private focusNext(menu: HTMLElement): void {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = document.activeElement as HTMLElement;
    const idx = items.indexOf(current);
    const next = items[(idx + 1) % items.length];
    next?.focus();
  }

  private focusPrevious(menu: HTMLElement): void {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = document.activeElement as HTMLElement;
    const idx = items.indexOf(current);
    const prev = items[(idx - 1 + items.length) % items.length];
    prev?.focus();
  }
}
