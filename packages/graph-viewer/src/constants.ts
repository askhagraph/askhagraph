/**
 * @module constants
 * UI strings and configuration constants for the Graph Viewer.
 * All user-facing strings are centralized here for future i18n.
 */

// ─── UI Strings ──────────────────────────────────────────────────────────────

export const UI_STRINGS = {
  toolbar: {
    searchPlaceholder: 'Search nodes... (/ to focus)',
    graphView: 'Graph View',
    listView: 'List View',
    fitToViewport: 'Fit to viewport',
    filterPresets: 'Filter presets',
    depthLabel: (current: number, max: number) => `${current} / ${max}`,
    depthIncrease: 'Increase depth',
    depthDecrease: 'Decrease depth',
    direction: 'Direction',
  },
  contextMenu: {
    askAi: 'Ask AI about this node',
    addAnnotation: 'Add Annotation',
    copyPath: 'Copy path',
    showCallers: 'Show callers',
    showCallees: 'Show callees',
  },
  filterPresets: {
    all: 'All nodes',
    functions: 'Functions only',
    conditionals: 'Conditionals only',
    'by-file': 'By file...',
    uncovered: 'Uncovered',
    'high-complexity': 'High complexity',
    'dead-code': 'Dead code',
    'hide-library': 'Hide library calls',
  },
  listView: {
    expandLabel: 'Expand',
    collapseLabel: 'Collapse',
    navigateLabel: 'Navigate to source',
  },
  accessibility: {
    graphRegion: 'Call graph visualization',
    listRegion: 'Call graph tree view',
    toolbarRegion: 'Graph viewer toolbar',
    searchLabel: 'Search graph nodes',
    liveRegion: 'Graph navigation announcements',
    focusedNode: (name: string, kind: string, file: string, line: number) =>
      `${kind} ${name}, ${file} line ${line}`,
  },
  nodeTypes: {
    function: 'Function',
    method: 'Method',
    conditional: 'Conditional',
    loop: 'Loop',
    callback: 'Callback',
    unresolved: 'Unresolved',
  },
  empty: {
    noGraph: 'No graph loaded',
    noResults: 'No matching nodes',
    callToAction: 'Run "Analyze Current Function" from the command palette to generate a call graph.',
  },
} as const;

// ─── Node Type Icons ─────────────────────────────────────────────────────────

export const NODE_ICONS: Record<string, string> = {
  function: 'ƒ',
  method: 'M',
  class: 'C',
  conditional: '?',
  loop: '↻',
  callback: 'λ',
  unresolved: '?',
};

// ─── CSS Custom Properties ───────────────────────────────────────────────────

export const CSS_VARS = {
  // Node colors (dark mode defaults)
  nodeFunction: '--ag-node-function',
  nodeMethod: '--ag-node-method',
  nodeClass: '--ag-node-class',
  nodeConditional: '--ag-node-conditional',
  nodeLoop: '--ag-node-loop',
  nodeUnresolved: '--ag-node-unresolved',

  // Edge colors
  edgeCall: '--ag-edge-call',
  edgeConditional: '--ag-edge-conditional',
  edgeCallback: '--ag-edge-callback',
  edgeCycle: '--ag-edge-cycle',

  // Surface colors
  bgPrimary: '--ag-bg-primary',
  bgSecondary: '--ag-bg-secondary',
  bgTertiary: '--ag-bg-tertiary',
  textPrimary: '--ag-text-primary',
  textSecondary: '--ag-text-secondary',
  textMuted: '--ag-text-muted',
  border: '--ag-border',
  focusRing: '--ag-focus-ring',

  // Spacing
  spacingSm: '--ag-spacing-sm',
  spacingMd: '--ag-spacing-md',
  spacingLg: '--ag-spacing-lg',

  // Typography
  fontMono: '--ag-font-mono',
  fontSans: '--ag-font-sans',
  fontSizeSm: '--ag-font-size-sm',
  fontSizeMd: '--ag-font-size-md',
} as const;

// ─── Layout Constants ────────────────────────────────────────────────────────

export const LAYOUT = {
  /** Maximum depth before auto-collapsing subtrees. */
  autoCollapseDepth: 6,
  /** Horizontal spacing between nodes in pixels. */
  nodeSpacingHorizontal: 35,
  /** Vertical spacing between nodes in pixels. */
  nodeSpacingVertical: 20,
  /** Animation duration in milliseconds. */
  animationDuration: 200,
  /** Zoom sensitivity factor (1.0 = default, higher = faster zoom). */
  zoomSensitivity: 2.0,
  /** Minimum zoom level. */
  minZoom: 0.1,
  /** Maximum zoom level. */
  maxZoom: 3.0,
  /** Narrow viewport breakpoint in pixels. */
  narrowBreakpoint: 600,
} as const;

// ─── Default CSS Variable Values (Dark Mode) ─────────────────────────────────

export const DEFAULT_THEME = `
:root {
  --ag-node-function: #3b82f6;
  --ag-node-method: #6366f1;
  --ag-node-class: #8b5cf6;
  --ag-node-conditional: #f59e0b;
  --ag-node-loop: #10b981;
  --ag-node-unresolved: #6b7280;

  --ag-edge-call: #94a3b8;
  --ag-edge-conditional: #f59e0b;
  --ag-edge-callback: #6366f1;
  --ag-edge-cycle: #ef4444;

  --ag-bg-primary: #1e1e1e;
  --ag-bg-secondary: #252526;
  --ag-bg-tertiary: #2d2d30;
  --ag-text-primary: #cccccc;
  --ag-text-secondary: #9d9d9d;
  --ag-text-muted: #6b7280;
  --ag-border: #3e3e42;
  --ag-focus-ring: #007acc;

  --ag-spacing-sm: 4px;
  --ag-spacing-md: 8px;
  --ag-spacing-lg: 16px;

  --ag-font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  --ag-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --ag-font-size-sm: 11px;
  --ag-font-size-md: 13px;
}
`;
