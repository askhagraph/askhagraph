---
inclusion: auto
description: UI design principles for AskhaGraph — guides visual style, interaction patterns, and layout decisions for the Graph Viewer to ensure a functional, readable, sleek, and professional developer experience.
---

# UI Design Principles — AskhaGraph

## Core Philosophy

The AskhaGraph UI should feel like a professional developer tool that gets out of the way. It should be immediately understandable without a tutorial, visually clean without being sterile, and information-dense without being overwhelming.

## Design Pillars

### 1. Functional First

- Every visual element must serve a purpose. No decorative elements that don't convey information.
- Default to showing less. Let users expand into detail rather than drowning them in it.
- Interactions should be discoverable but not intrusive — hover states reveal actions, context menus provide depth.
- The graph should be readable at a glance: node labels, edge directions, and groupings should tell a story without clicking anything.

### 2. Readability

- Use a clear visual hierarchy: entry point nodes are visually prominent, leaf nodes are subtle.
- Node labels use monospace font for code identifiers, proportional font for metadata.
- Edge labels and annotations use smaller, muted text that doesn't compete with node labels.
- Maintain generous spacing between nodes — cramped graphs are unreadable. Prefer scrolling over compression.
- Color is supplementary, never the sole carrier of meaning. Always pair with icons, patterns, or text labels.
- Use consistent iconography: a small set of recognizable icons for node types (function, method, conditional, loop, class).

### 3. Sleek and Professional

- Follow the IDE's native color scheme (dark/light mode aware). Don't introduce a separate color palette that clashes with VS Code or IntelliJ themes.
- Use subtle borders, soft shadows, and rounded corners on nodes — not flat boxes with hard edges.
- Animations should be fast (150-250ms) and purposeful: expand/collapse transitions, zoom, pan. No bouncing, no spring physics, no gratuitous motion.
- The panel should feel like a native part of the IDE, not an embedded web page. Match the IDE's font sizes, spacing tokens, and interaction patterns.
- Overlay indicators (complexity, coverage, churn) use small, tasteful badges — not garish full-node color fills. Think GitHub's label pills, not traffic lights.

### 4. Easy to Use

- First interaction should be zero-config: open a file, run "Analyze Current Function" from the command palette, see the graph. No setup wizard.
- The graph should auto-fit to the viewport on first render. Users shouldn't have to zoom out to find their graph.
- Provide a minimap or overview indicator for large graphs so users always know where they are.
- Click-to-navigate is the primary interaction. Clicking a node opens the source — this must feel instant.
- The toolbar should have at most 5-7 buttons. Group secondary actions in dropdowns or the context menu.
- Search/filter should be prominent and fast — typing filters nodes in real-time.

## Visual Language

### Node Styles

| Node Type | Shape | Icon | Default Color (dark mode) |
|-----------|-------|------|--------------------------|
| Function | Rounded rectangle | `ƒ` | `#3b82f6` (blue-500) |
| Method | Rounded rectangle | `M` | `#6366f1` (indigo-500) |
| Class | Rounded rectangle, slightly larger | `C` | `#8b5cf6` (violet-500) |
| Conditional | Diamond/rhombus | `?` | `#f59e0b` (amber-500) |
| Loop | Rounded rectangle with loop icon | `↻` | `#10b981` (emerald-500) |
| Unresolved | Dashed border | `?` | `#6b7280` (gray-500) |

### Edge Styles

| Edge Type | Style | Color |
|-----------|-------|-------|
| Direct call | Solid line, arrow | `#94a3b8` (slate-400) |
| Conditional flow | Dashed line, arrow | `#f59e0b` (amber-500) |
| Callback/closure | Dotted line, arrow | `#6366f1` (indigo-400) |
| Cycle back-edge | Red dashed, double arrow | `#ef4444` (red-500) |

### Overlay Badges

- **Complexity**: Small pill badge on node corner — green/yellow/red with number inside
- **Coverage**: Thin progress bar at bottom of node — filled portion = coverage %
- **Churn**: Small flame icon with intensity (1-3 flames)
- **Dead code**: Node at 40% opacity with strikethrough on label
- **Annotation**: Small sticky-note icon on node corner, tooltip shows full text

## Interaction Patterns

- **Hover**: Show tooltip with full qualified name, file path, and line number. Highlight connected edges.
- **Click**: Navigate to source file. Brief highlight animation on the node (200ms pulse).
- **Right-click**: Context menu with: "Ask AI about this node", "Add Annotation", "Copy path", "Show callers", "Show callees".
- **Scroll**: Zoom in/out (smooth, not stepped).
- **Drag**: Pan the canvas. Drag a node to reposition it (optional, layout can be locked).
- **Keyboard**: Arrow keys navigate between connected nodes. Enter = click. `/` = focus search.
- **Depth control**: Toolbar provides −/+ buttons with a "current / max" depth label. Changing depth recalculates which subtrees are collapsed and re-renders the graph. This replaces per-node double-click expand/collapse for a more predictable, global depth control.

## Layout Preferences

- Use ELK's layered algorithm with left-to-right flow (entry point on the left, callees flow right).
- Group nodes by file or module when the graph has more than 20 nodes — use compound nodes with a subtle background.
- Default visible depth is 6. Collapsed nodes show a "+" indicator with descendant count.
- The depth control in the toolbar lets users increase or decrease visible depth globally. The max depth is computed from the graph structure.
- When filters hide nodes (e.g., "Hide library calls"), re-run the layout so remaining nodes compact into the freed space. Don't leave layout gaps where hidden nodes used to be.
- When a graph has more than 50 visible nodes, consider providing a visual overview indicator for orientation.

## Filter Behavior

- All filters (search query, filter presets, hide library calls) apply identically to both graph and list views.
- In the graph view, hidden nodes get `display: none` and the layout re-runs to fill gaps.
- In the list view, filtered nodes are excluded at tree-build time (not just CSS-hidden).
- Filter presets: All, Functions only, Conditionals only, Uncovered, High complexity, Dead code.
- "Hide library calls" hides unresolved nodes. Conditional nodes whose children are all hidden are cascade-hidden.
- The list view maintains its own per-node expand/collapse state independent of the graph's depth control.

## Responsive Behavior

- The panel should work at any width from 400px to full screen.
- At narrow widths (< 600px), switch to the list view by default.
- Node labels truncate with ellipsis at narrow zoom levels; full labels appear on hover or zoom-in.

## Anti-Patterns (Do NOT)

- Don't use neon colors, gradients, or glow effects on nodes.
- Don't animate edges or make them pulse/flow.
- Don't use 3D effects or perspective transforms.
- Don't show loading spinners for operations under 200ms.
- Don't use modal dialogs for anything — use inline panels, toasts, or the context menu.
- Don't require users to configure anything before first use.
- Don't show empty states without a clear call-to-action.
