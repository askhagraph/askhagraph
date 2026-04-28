/**
 * @module styles
 * Cytoscape.js stylesheet for the Graph Viewer.
 * Follows the UI design principles: dark mode default, subtle borders,
 * rounded corners, monospace labels, and color-coded node types.
 */

import type cytoscape from 'cytoscape';

/**
 * Generate the Cytoscape stylesheet.
 * Uses CSS custom property values resolved at runtime for theming.
 */
export function createGraphStylesheet(): cytoscape.StylesheetStyle[] {
  // We use 'as unknown as cytoscape.StylesheetStyle' pattern because
  // Cytoscape's type definitions are overly strict for dynamic style values.
  const styles: Array<{ selector: string; style: Record<string, unknown> }> = [
    // ─── Base Node Style ───────────────────────────────────────────────
    {
      selector: 'node',
      style: {
        'shape': 'round-rectangle',
        'width': 180,
        'height': 40,
        'padding': '12px',
        'background-color': '#3b82f6',
        'border-width': 1.5,
        'border-color': '#4b9cf7',
        'border-opacity': 0.6,
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-family': "Consolas, monospace",
        'font-size': '12px',
        'color': '#e4e4e7',
        'text-wrap': 'wrap',
        'text-max-width': '160px',
        'text-overflow-wrap': 'anywhere',
        'min-zoomed-font-size': 8,
        'overlay-padding': '4px',
        'overlay-opacity': 0,
        'transition-property': 'background-color, border-color, opacity, border-width',
        'transition-duration': 200,
      },
    },

    // ─── Node Type: Function ───────────────────────────────────────────
    {
      selector: 'node[kind = "function"]',
      style: {
        'background-color': '#3b82f6',
        'border-color': '#60a5fa',
      },
    },

    // ─── Node Type: Method ─────────────────────────────────────────────
    {
      selector: 'node[kind = "method"]',
      style: {
        'background-color': '#6366f1',
        'border-color': '#818cf8',
      },
    },

    // ─── Node Type: Class ──────────────────────────────────────────────
    {
      selector: 'node[kind = "class"]',
      style: {
        'background-color': '#8b5cf6',
        'border-color': '#a78bfa',
        'padding': '14px',
      },
    },

    // ─── Node Type: Conditional ────────────────────────────────────────
    {
      selector: 'node[kind = "conditional"]',
      style: {
        'background-color': '#f59e0b',
        'border-color': '#fbbf24',
        'shape': 'diamond',
        'color': '#1c1917',
      },
    },

    // ─── Node Type: Loop ───────────────────────────────────────────────
    {
      selector: 'node[kind = "loop"]',
      style: {
        'background-color': '#10b981',
        'border-color': '#34d399',
      },
    },

    // ─── Node Type: Callback ───────────────────────────────────────────
    {
      selector: 'node[kind = "callback"]',
      style: {
        'background-color': '#6366f1',
        'border-color': '#818cf8',
        'border-style': 'dashed',
      },
    },

    // ─── Node Type: Unresolved ─────────────────────────────────────────
    {
      selector: 'node[kind = "unresolved"]',
      style: {
        'background-color': '#6b7280',
        'border-color': '#9ca3af',
        'border-style': 'dashed',
        'opacity': 0.7,
      },
    },

    // ─── Entry Point Node ──────────────────────────────────────────────
    {
      selector: 'node[?isEntryPoint]',
      style: {
        'border-width': 3,
        'border-color': '#fbbf24',
        'font-weight': 'bold',
        'font-size': '13px',
      },
    },

    // ─── Collapsed Node (has hidden children) ──────────────────────────
    {
      selector: 'node[?isCollapsed]',
      style: {
        'border-style': 'double',
      },
    },

    // ─── Depth-Limited Node ────────────────────────────────────────────
    {
      selector: 'node[?isDepthLimited]',
      style: {
        'opacity': 0.6,
        'border-style': 'dotted',
      },
    },

    // ─── Hover State ───────────────────────────────────────────────────
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.08,
        'overlay-color': '#ffffff',
      },
    },

    // ─── Selected State ────────────────────────────────────────────────
    {
      selector: 'node:selected',
      style: {
        'border-width': 2.5,
        'border-color': '#007acc',
        'overlay-opacity': 0.05,
        'overlay-color': '#007acc',
      },
    },

    // ─── Focused State (keyboard navigation) ───────────────────────────
    {
      selector: 'node.focused',
      style: {
        'border-width': 2.5,
        'border-color': '#007acc',
        'border-opacity': 1,
      },
    },

    // ─── Dimmed State (search filtering) ───────────────────────────────
    {
      selector: 'node.dimmed',
      style: {
        'opacity': 0.3,
      },
    },

    // ─── Hidden State (library calls filter) ───────────────────────────
    {
      selector: 'node.hidden',
      style: {
        'display': 'none',
      },
    },

    // ─── Annotated Node Indicator ──────────────────────────────────────
    {
      selector: 'node.has-annotation',
      style: {
        'border-width': 2.5,
        'border-color': '#4fc1ff',
        'border-style': 'double',
      },
    },

    // ─── Highlighted State (search match) ──────────────────────────────
    {
      selector: 'node.highlighted',
      style: {
        'opacity': 1,
        'border-width': 2.5,
        'border-color': '#fbbf24',
      },
    },

    // ─── Base Edge Style ───────────────────────────────────────────────
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': '#94a3b8',
        'target-arrow-color': '#94a3b8',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        'opacity': 0.7,
        'transition-property': 'opacity, line-color, width',
        'transition-duration': 200,
      },
    },

    // ─── Edge Type: Call ───────────────────────────────────────────────
    {
      selector: 'edge[kind = "call"]',
      style: {
        'line-style': 'solid',
        'line-color': '#94a3b8',
        'target-arrow-color': '#94a3b8',
      },
    },

    // ─── Edge Type: Conditional Flow ───────────────────────────────────
    {
      selector: 'edge[kind = "conditional_flow"]',
      style: {
        'line-style': 'dashed',
        'line-color': '#f59e0b',
        'target-arrow-color': '#f59e0b',
      },
    },

    // ─── Edge Type: Callback ───────────────────────────────────────────
    {
      selector: 'edge[kind = "callback"]',
      style: {
        'line-style': 'dotted',
        'line-color': '#6366f1',
        'target-arrow-color': '#6366f1',
      },
    },

    // ─── Edge Type: Cycle Back-Edge ────────────────────────────────────
    {
      selector: 'edge[kind = "cycle_back_edge"]',
      style: {
        'line-style': 'dashed',
        'line-color': '#ef4444',
        'target-arrow-color': '#ef4444',
        'source-arrow-shape': 'triangle',
        'source-arrow-color': '#ef4444',
        'width': 2,
      },
    },

    // ─── Edge Type: Depth Limited ──────────────────────────────────────
    {
      selector: 'edge[kind = "depth_limited"]',
      style: {
        'line-style': 'dotted',
        'line-color': '#6b7280',
        'target-arrow-color': '#6b7280',
        'opacity': 0.5,
      },
    },

    // ─── Edge: Connected to hovered/selected node ──────────────────────
    {
      selector: 'edge.highlighted',
      style: {
        'opacity': 1,
        'width': 2.5,
      },
    },

    // ─── Edge: Dimmed (search filtering) ───────────────────────────────
    {
      selector: 'edge.dimmed',
      style: {
        'opacity': 0.15,
      },
    },

    // ─── Edge: Hidden (library calls filter) ─────────────────────────
    {
      selector: 'edge.hidden',
      style: {
        'display': 'none',
      },
    },

    // ─── Path: Nodes on the path ───────────────────────────────────────
    {
      selector: 'node.on-path',
      style: {
        'opacity': 1,
        'border-width': 2.5,
        'border-color': '#22d3ee',
      },
    },

    // ─── Path: Source node ─────────────────────────────────────────────
    {
      selector: 'node.path-source',
      style: {
        'border-width': 3,
        'border-color': '#22c55e',
        'border-style': 'solid',
      },
    },

    // ─── Path: Target node ─────────────────────────────────────────────
    {
      selector: 'node.path-target',
      style: {
        'border-width': 3,
        'border-color': '#f59e0b',
        'border-style': 'solid',
      },
    },

    // ─── Path: Edges on the path ───────────────────────────────────────
    {
      selector: 'edge.on-path',
      style: {
        'opacity': 1,
        'width': 3,
        'line-color': '#22d3ee',
        'target-arrow-color': '#22d3ee',
      },
    },

    // ─── Overlay: Complexity — Low (1-5, green) ────────────────────────
    {
      selector: 'node.complexity-low',
      style: {
        'border-color': '#22c55e',
        'border-width': 2.5,
      },
    },

    // ─── Overlay: Complexity — Medium (6-10, yellow) ───────────────────
    {
      selector: 'node.complexity-medium',
      style: {
        'border-color': '#eab308',
        'border-width': 2.5,
      },
    },

    // ─── Overlay: Complexity — High (>10, red) ─────────────────────────
    {
      selector: 'node.complexity-high',
      style: {
        'border-color': '#ef4444',
        'border-width': 3,
      },
    },

    // ─── Overlay: Coverage — Covered (>80%) ────────────────────────────
    {
      selector: 'node.coverage-covered',
      style: {
        'border-color': '#22c55e',
        'border-width': 2,
      },
    },

    // ─── Overlay: Coverage — Partial (20-80%) ──────────────────────────
    {
      selector: 'node.coverage-partial',
      style: {
        'border-color': '#eab308',
        'border-width': 2,
      },
    },

    // ─── Overlay: Coverage — Uncovered (<20%) ──────────────────────────
    {
      selector: 'node.coverage-uncovered',
      style: {
        'border-color': '#ef4444',
        'border-width': 2,
        'border-style': 'dashed',
      },
    },

    // ─── Overlay: Dead Code ────────────────────────────────────────────
    {
      selector: 'node.dead-code',
      style: {
        'opacity': 0.4,
        'border-style': 'dashed',
        'border-color': '#6b7280',
        'text-decoration': 'line-through',
      },
    },

    // ─── Overlay: Change Impact — Modified ─────────────────────────────
    {
      selector: 'node.impact-modified',
      style: {
        'border-color': '#ef4444',
        'border-width': 3,
        'border-style': 'solid',
      },
    },

    // ─── Overlay: Change Impact — Blast Radius ─────────────────────────
    {
      selector: 'node.impact-blast-radius',
      style: {
        'border-color': '#f97316',
        'border-width': 2,
        'border-style': 'dashed',
      },
    },

    // ─── Overlay: Churn — High ─────────────────────────────────────────
    {
      selector: 'node.churn-high',
      style: {
        'border-color': '#ef4444',
        'border-width': 2.5,
      },
    },

    // ─── Overlay: Churn — Medium ───────────────────────────────────────
    {
      selector: 'node.churn-medium',
      style: {
        'border-color': '#f97316',
        'border-width': 2,
      },
    },

    // ─── Overlay: Churn — Low ──────────────────────────────────────────
    {
      selector: 'node.churn-low',
      style: {
        'border-color': '#3b82f6',
        'border-width': 1.5,
      },
    },

    // ─── Overlay: Data Flow Path ───────────────────────────────────────
    {
      selector: 'node.dataflow-path',
      style: {
        'border-color': '#a855f7',
        'border-width': 3,
      },
    },

    // ─── Overlay: Data Flow Sink ───────────────────────────────────────
    {
      selector: 'node.dataflow-sink',
      style: {
        'border-color': '#ef4444',
        'border-width': 3,
        'background-color': '#7f1d1d',
      },
    },

    // ─── Overlay: Feature Boundary Group ───────────────────────────────
    {
      selector: 'node.boundary-0',
      style: { 'background-opacity': 0.85 },
    },
    {
      selector: 'node.boundary-1',
      style: { 'background-opacity': 0.85 },
    },

    // ─── Overlay: Recently Added ───────────────────────────────────────
    {
      selector: 'node.recently-added',
      style: {
        'border-color': '#22d3ee',
        'border-width': 2.5,
        'border-style': 'double',
      },
    },
  ];

  return styles as unknown as cytoscape.StylesheetStyle[];
}
