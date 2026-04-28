/**
 * @module graph-renderer
 * Main renderer class for the AskhaGraph Graph Viewer.
 * Initializes Cytoscape.js with ELK layout and manages the graph lifecycle.
 */

import cytoscape from 'cytoscape';
// @ts-expect-error — cytoscape-elk has no type declarations
import elk from 'cytoscape-elk';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createGraphStylesheet } from './styles.js';
import { createElkLayoutOptions, getAutoCollapsedNodes, countDescendants, computeMaxDepth } from './layout.js';
import { GraphEventManager } from './events.js';
import { createMessageBridge, type IMessageBridge } from './messaging.js';
import { NODE_ICONS, LAYOUT } from './constants.js';
import type {
  SerializedCallGraph,
  SerializedNode,
  SerializedEdge,
  GraphEventListener,
} from './types.js';

// Register ELK layout extension
cytoscape.use(elk);

/**
 * Main graph renderer for the AskhaGraph Graph Viewer.
 * Manages the Cytoscape instance, layout, and node state.
 */
export class GraphRenderer {
  private cy: cytoscape.Core | null = null;
  private container: HTMLElement | null = null;
  private messageBridge: IMessageBridge;
  private eventManager: GraphEventManager | null = null;
  private graphData: SerializedCallGraph | null = null;
  private collapsedNodes: Set<string> = new Set();
  private adjacency: Map<string, string[]> = new Map();
  private nodeMap: Map<string, SerializedNode> = new Map();
  private elkInstance: unknown;
  private visibleDepth: number = LAYOUT.autoCollapseDepth;
  private maxDepth: number = 0;
  private hideUnresolved: boolean = false;

  constructor(messageBridge?: IMessageBridge) {
    this.messageBridge = messageBridge || createMessageBridge();
    try {
      this.elkInstance = new ELK();
    } catch {
      this.elkInstance = undefined;
    }
  }

  /** Initialize Cytoscape with ELK layout in the given container. */
  initialize(container: HTMLElement): void {
    this.container = container;

    this.cy = cytoscape({
      container,
      style: createGraphStylesheet(),
      minZoom: LAYOUT.minZoom,
      maxZoom: LAYOUT.maxZoom,
      wheelSensitivity: LAYOUT.zoomSensitivity,
      boxSelectionEnabled: false,
      autounselectify: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
    });

    this.eventManager = new GraphEventManager({
      cy: this.cy,
      messageBridge: this.messageBridge,
      onNodeSelect: (nodeId) => this.handleNodeSelect(nodeId),
      getNodeData: (nodeId) => this.nodeMap.get(nodeId),
      onPathFrom: (nodeId) => {
        this.clearPath();
        this.setPathSource(nodeId);
      },
      onPathTo: (nodeId) => {
        const source = this.getPathSource();
        if (!source) {
          // No source set — use this as source instead
          this.setPathSource(nodeId);
          return;
        }
        const path = this.highlightPath(source, nodeId);
        if (path.length === 0) {
          this.eventManager?.showToast('No path found between these nodes');
        }
      },
      onClearPath: () => {
        this.clearPath();
      },
    });

    this.eventManager.initialize();
  }

  /** Render a CallGraph JSON (the serialized format from GraphSerializer). */
  render(graphJson: SerializedCallGraph): void {
    if (!this.cy) {
      throw new Error('GraphRenderer: not initialized. Call initialize() first.');
    }

    this.graphData = graphJson;
    this.buildNodeMap(graphJson.nodes);
    this.buildAdjacency(graphJson.edges);

    // Determine entry point
    const entryPointId = this.findEntryPointId(graphJson);

    // Build set of unresolved node IDs to exclude from depth calculations
    const excludeNodeIds = this.hideUnresolved
      ? new Set(graphJson.nodes.filter(n => n.metadata.isUnresolved).map(n => n.id))
      : undefined;

    // Compute max depth of the graph (excluding hidden library nodes)
    this.maxDepth = computeMaxDepth(entryPointId, this.adjacency, excludeNodeIds);

    // Reset visible depth to default (autoCollapseDepth) on each new analysis,
    // clamped to the actual max depth of this graph
    this.visibleDepth = Math.min(LAYOUT.autoCollapseDepth, this.maxDepth);

    // Determine auto-collapsed nodes based on visible depth
    this.collapsedNodes = getAutoCollapsedNodes(entryPointId, this.adjacency, this.visibleDepth, excludeNodeIds);

    // Build Cytoscape elements
    const elements = this.buildElements(graphJson, entryPointId);

    // Clear and add elements
    this.cy.elements().remove();
    this.cy.add(elements);

    // Run layout — use bundled ELK (no web workers)
    try {
      const layoutOptions = createElkLayoutOptions({
        animate: false,
        fit: true,
        elkInstance: this.elkInstance,
      });
      
      // Run layout only on visible elements for consistent compaction behavior
      const visibleEles = this.cy.elements(':visible');
      const layout = visibleEles.layout(layoutOptions as unknown as cytoscape.LayoutOptions);
      
      layout.on('layoutstop', () => {
        console.log('[AskhaGraph] Layout: ELK');
        this.fitToViewport();
        this.applyOverlays(graphJson.overlays as Record<string, unknown> | undefined);
      });
      
      layout.run();
      
    } catch (err) {
      console.log('[AskhaGraph] Layout: COSE fallback', err instanceof Error ? err.message : err);
      this.runFallbackLayout();
    }
  }

  /** Run a built-in Cytoscape layout as fallback when ELK fails. */
  private runFallbackLayout(): void {
    if (!this.cy) return;
    console.log('[AskhaGraph] Layout: COSE fallback');
    this.cy.layout({
      name: 'cose',
      animate: false,
      fit: true,
      padding: 40,
      nodeRepulsion: () => 8000,
      idealEdgeLength: () => 120,
      gravity: 0.25,
      numIter: 200,
      nodeDimensionsIncludeLabels: true,
    } as unknown as cytoscape.LayoutOptions).run();
    this.fitToViewport();
    this.applyOverlays(this.graphData?.overlays as Record<string, unknown> | undefined);
  }

  /** Fit the graph to the viewport. */
  fitToViewport(): void {
    if (!this.cy) return;
    this.cy.fit(undefined, 40);
  }

  /** Re-run the layout on currently visible elements (e.g., after filtering). */
  runLayout(animate: boolean = true): void {
    if (!this.cy) return;
    try {
      const layoutOptions = createElkLayoutOptions({
        animate,
        fit: true,
        elkInstance: this.elkInstance,
      });

      // Run layout only on visible elements so hidden nodes (e.g. library calls)
      // don't occupy space in the ELK graph and cause gaps.
      const visibleEles = this.cy.elements(':visible');
      visibleEles.layout(layoutOptions as unknown as cytoscape.LayoutOptions).run();
    } catch {
      this.runFallbackLayout();
    }
  }

  /**
   * Apply overlay classes to nodes based on their metadata.
   * Call this after rendering to visually indicate complexity, coverage, etc.
   */
  applyOverlays(overlayData?: Record<string, unknown>): void {
    if (!this.cy) return;

    this.cy.nodes().forEach((node) => {
      const data = node.data();
      const metadata = data.raw?.metadata;
      if (!metadata) return;

      // Complexity overlay
      if (metadata.cyclomaticComplexity !== undefined) {
        const c = metadata.cyclomaticComplexity as number;
        node.removeClass('complexity-low complexity-medium complexity-high');
        if (c <= 5) node.addClass('complexity-low');
        else if (c <= 10) node.addClass('complexity-medium');
        else node.addClass('complexity-high');
      }

      // Coverage overlay
      if (metadata.coverage !== undefined) {
        const cov = metadata.coverage as number;
        node.removeClass('coverage-covered coverage-partial coverage-uncovered');
        if (cov > 0.8) node.addClass('coverage-covered');
        else if (cov >= 0.2) node.addClass('coverage-partial');
        else node.addClass('coverage-uncovered');
      }

      // Churn overlay
      if (metadata.churn !== undefined) {
        const churn = metadata.churn as number;
        node.removeClass('churn-low churn-medium churn-high');
        if (churn > 10) node.addClass('churn-high');
        else if (churn > 3) node.addClass('churn-medium');
        else node.addClass('churn-low');
      }

      // Recently added
      if (metadata.isRecentlyAdded) {
        node.addClass('recently-added');
      }

      // Feature boundary
      if (metadata.featureBoundary) {
        const boundaryIdx = parseInt(String(metadata.featureBoundary).replace('cluster-', ''), 10);
        if (!isNaN(boundaryIdx)) {
          node.addClass(`boundary-${boundaryIdx % 2}`);
        }
      }
    });

    // Apply overlay data from the overlays response if provided
    if (overlayData) {
      // Dead code
      const deadCode = overlayData['deadCode'] as string[] | undefined;
      if (deadCode) {
        for (const nodeId of deadCode) {
          const node = this.cy.getElementById(nodeId);
          if (node.length > 0) node.addClass('dead-code');
        }
      }

      // Change impact
      const impact = overlayData['changeImpact'] as Record<string, unknown> | undefined;
      if (impact) {
        const modified = impact['modifiedNodes'] as string[] | undefined;
        const blastRadius = impact['blastRadius'] as Record<string, number> | undefined;
        if (modified) {
          for (const nodeId of modified) {
            const node = this.cy.getElementById(nodeId);
            if (node.length > 0) node.addClass('impact-modified');
          }
        }
        if (blastRadius) {
          for (const nodeId of Object.keys(blastRadius)) {
            const node = this.cy.getElementById(nodeId);
            if (node.length > 0 && !node.hasClass('impact-modified')) {
              node.addClass('impact-blast-radius');
            }
          }
        }
      }

      // Data flow
      const dataFlow = overlayData['dataFlow'] as Record<string, unknown> | undefined;
      if (dataFlow) {
        const paths = dataFlow['paths'] as Array<{ nodeIds: string[] }> | undefined;
        const sinks = dataFlow['sinks'] as Array<{ nodeId: string }> | undefined;
        if (paths) {
          for (const path of paths) {
            for (const nodeId of path.nodeIds) {
              const node = this.cy.getElementById(nodeId);
              if (node.length > 0) node.addClass('dataflow-path');
            }
          }
        }
        if (sinks) {
          for (const sink of sinks) {
            const node = this.cy.getElementById(sink.nodeId);
            if (node.length > 0) node.addClass('dataflow-sink');
          }
        }
      }
    }
  }

  /** Expand a collapsed subtree node. */
  expandNode(nodeId: string): void {
    if (!this.cy || !this.graphData) return;

    this.collapsedNodes.delete(nodeId);

    // Update the node data
    const node = this.cy.getElementById(nodeId);
    if (node.length > 0) {
      node.data('isCollapsed', false);
      node.data('label', this.getNodeLabel(this.nodeMap.get(nodeId)!));
    }

    // Re-render with updated collapse state
    this.rerender();

    this.messageBridge.postMessage({
      type: 'expandNode',
      payload: { nodeId },
    });
  }

  /** Collapse a subtree into a summary node. */
  collapseNode(nodeId: string): void {
    if (!this.cy || !this.graphData) return;

    this.collapsedNodes.add(nodeId);

    // Update the node data
    const node = this.cy.getElementById(nodeId);
    if (node.length > 0) {
      const childCount = countDescendants(nodeId, this.adjacency);
      node.data('isCollapsed', true);
      node.data('label', this.getCollapsedLabel(this.nodeMap.get(nodeId)!, childCount));
    }

    // Re-render with updated collapse state
    this.rerender();

    this.messageBridge.postMessage({
      type: 'collapseNode',
      payload: { nodeId },
    });
  }

  /** Get the Cytoscape instance (for external access like search). */
  getCytoscape(): cytoscape.Core | null {
    return this.cy;
  }

  /** Get the event manager (for external event subscription). */
  getEventManager(): GraphEventManager | null {
    return this.eventManager;
  }

  /** Get the current graph data. */
  getGraphData(): SerializedCallGraph | null {
    return this.graphData;
  }

  /** Get the adjacency map. */
  getAdjacency(): Map<string, string[]> {
    return this.adjacency;
  }

  /** Get the node map. */
  getNodeMap(): Map<string, SerializedNode> {
    return this.nodeMap;
  }

  /** Get collapsed node IDs. */
  getCollapsedNodes(): Set<string> {
    return this.collapsedNodes;
  }

  /** Get the current visible depth. */
  getVisibleDepth(): number {
    return this.visibleDepth;
  }

  /** Get the maximum depth of the graph. */
  getMaxDepth(): number {
    return this.maxDepth;
  }

  /** Set the visible depth and re-render the graph. */
  setVisibleDepth(depth: number): void {
    if (!this.graphData) return;
    const clamped = Math.max(1, Math.min(depth, this.maxDepth));
    if (clamped === this.visibleDepth) return;

    this.visibleDepth = clamped;
    const entryPointId = this.findEntryPointId(this.graphData);
    const excludeNodeIds = this.hideUnresolved
      ? new Set(this.graphData.nodes.filter(n => n.metadata.isUnresolved).map(n => n.id))
      : undefined;
    this.collapsedNodes = getAutoCollapsedNodes(entryPointId, this.adjacency, this.visibleDepth, excludeNodeIds);
    this.rerender();
  }

  /** Register a listener for graph events. */
  on(listener: GraphEventListener): void {
    this.eventManager?.on(listener);
  }

  /** Set whether to exclude unresolved/library nodes from the graph.
   *  Call before render() to avoid a second layout pass. */
  setHideUnresolved(hide: boolean): void {
    this.hideUnresolved = hide;
  }

  /** Remove a listener. */
  off(listener: GraphEventListener): void {
    this.eventManager?.off(listener);
  }

  /** Destroy the renderer and clean up. */
  destroy(): void {
    this.eventManager?.destroy();
    this.eventManager = null;
    this.cy?.destroy();
    this.cy = null;
    this.container = null;
    this.graphData = null;
    this.collapsedNodes.clear();
    this.adjacency.clear();
    this.nodeMap.clear();
    this.messageBridge.dispose();
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private buildNodeMap(nodes: SerializedNode[]): void {
    this.nodeMap.clear();
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  private buildAdjacency(edges: SerializedEdge[]): void {
    this.adjacency.clear();
    for (const edge of edges) {
      if (!this.adjacency.has(edge.sourceId)) {
        this.adjacency.set(edge.sourceId, []);
      }
      this.adjacency.get(edge.sourceId)!.push(edge.targetId);
    }
  }

  private findEntryPointId(graphJson: SerializedCallGraph): string {
    // Try to find by metadata.entryPoint
    const entryPoint = graphJson.metadata.entryPoint;
    for (const node of graphJson.nodes) {
      if (node.qualifiedName === entryPoint || node.name === entryPoint) {
        return node.id;
      }
    }
    // Fallback: first node
    return graphJson.nodes[0]?.id || '';
  }

  private buildElements(
    graphJson: SerializedCallGraph,
    entryPointId: string,
  ): cytoscape.ElementDefinition[] {
    const elements: cytoscape.ElementDefinition[] = [];
    const visibleNodes = this.getVisibleNodes(entryPointId);
    const addedNodeIds = new Set<string>();

    // Add nodes
    for (const nodeId of visibleNodes) {
      const node = this.nodeMap.get(nodeId);
      if (!node) continue;

      // Skip unresolved/library nodes if hideUnresolved is set
      if (this.hideUnresolved && node.metadata.isUnresolved) continue;

      addedNodeIds.add(nodeId);

      const isCollapsed = this.collapsedNodes.has(nodeId);
      const childCount = isCollapsed ? countDescendants(nodeId, this.adjacency) : 0;

      elements.push({
        group: 'nodes',
        data: {
          id: node.id,
          label: isCollapsed
            ? this.getCollapsedLabel(node, childCount)
            : this.getNodeLabel(node),
          name: node.name,
          qualifiedName: node.qualifiedName,
          kind: node.kind,
          filePath: node.filePath,
          line: node.line,
          column: node.column,
          isEntryPoint: node.id === entryPointId,
          isCollapsed,
          isDepthLimited: node.metadata.isDepthLimited,
          isUnresolved: node.metadata.isUnresolved,
          isCycleParticipant: node.metadata.isCycleParticipant,
          raw: node,
        },
      });
    }

    // Add edges (only between actually added nodes, skip self-loops)
    const addedEdges = new Set<string>();
    for (const edge of graphJson.edges) {
      // Skip self-loops
      if (edge.sourceId === edge.targetId) continue;
      // Skip if either endpoint wasn't added (hidden, collapsed, or unresolved)
      if (!addedNodeIds.has(edge.sourceId) || !addedNodeIds.has(edge.targetId)) continue;
      // Skip duplicate edges
      const edgeKey = `${edge.sourceId}->${edge.targetId}`;
      if (addedEdges.has(edgeKey)) continue;
      addedEdges.add(edgeKey);

      elements.push({
        group: 'edges',
        data: {
          id: edgeKey,
          source: edge.sourceId,
          target: edge.targetId,
          kind: edge.kind,
        },
      });
    }

    return elements;
  }

  private getVisibleNodes(entryPointId: string): Set<string> {
    const visible = new Set<string>();
    const visited = new Set<string>();
    const stack = [entryPointId];

    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      visible.add(nodeId);

      // If this node is collapsed, don't traverse its children
      if (this.collapsedNodes.has(nodeId)) continue;

      const children = this.adjacency.get(nodeId) || [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          stack.push(childId);
        }
      }
    }

    return visible;
  }

  private getNodeLabel(node: SerializedNode): string {
    const icon = NODE_ICONS[node.kind] || '';
    return `${icon} ${node.name}`;
  }

  private getCollapsedLabel(node: SerializedNode, childCount: number): string {
    const icon = NODE_ICONS[node.kind] || '';
    return `${icon} ${node.name} [+${childCount}]`;
  }

  /** Re-render the graph with current collapsed state and run layout. */
  rerender(): void {
    if (!this.cy || !this.graphData) return;

    const entryPointId = this.findEntryPointId(this.graphData);
    const elements = this.buildElements(this.graphData, entryPointId);

    this.cy.elements().remove();
    this.cy.add(elements);

    try {
      const layoutOptions = createElkLayoutOptions({
        animate: true,
        fit: false,
        elkInstance: this.elkInstance,
      });

      // Run layout only on visible elements so hidden nodes don't affect positioning.
      const visibleEles = this.cy.elements(':visible');
      visibleEles.layout(layoutOptions as unknown as cytoscape.LayoutOptions).run();
    } catch {
      this.runFallbackLayout();
    }
  }

  private handleNodeSelect(_nodeId: string): void {
    // Selection handling is done via event manager
  }

  // ─── Path Finding ──────────────────────────────────────────────────────────

  private pathSource: string | null = null;

  /** Set a node as the path source. Call highlightPath with a target to show the path. */
  setPathSource(nodeId: string): void {
    this.pathSource = nodeId;
  }

  /** Get the current path source node ID. */
  getPathSource(): string | null {
    return this.pathSource;
  }

  /** Clear path source and any path highlighting. */
  clearPath(): void {
    this.pathSource = null;
    if (!this.cy) return;
    this.cy.elements().removeClass('on-path path-source path-target dimmed hidden');
    // Re-run layout to restore the full graph layout
    this.runLayout(false);
  }

  /**
   * Find and highlight the shortest path between two nodes.
   * Uses BFS on the adjacency map. Returns the path node IDs, or empty if no path.
   */
  highlightPath(sourceId: string, targetId: string): string[] {
    if (!this.cy) return [];

    // Clear previous path highlighting
    this.cy.elements().removeClass('on-path path-source path-target dimmed hidden');

    // BFS to find shortest path (forward direction)
    let path = this.bfsPath(sourceId, targetId);

    // If no forward path, try reverse
    if (path.length === 0) {
      path = this.bfsPath(targetId, sourceId);
      if (path.length > 0) path.reverse();
    }

    if (path.length === 0) return [];

    // Hide non-path nodes and edges so only the path is visible
    const pathSet = new Set(path);

    this.cy.nodes().forEach((node) => {
      if (pathSet.has(node.id())) {
        node.addClass('on-path');
      } else {
        node.addClass('hidden');
      }
    });

    // Mark source and target
    const sourceNode = this.cy.getElementById(sourceId);
    const targetNode = this.cy.getElementById(targetId);
    if (sourceNode.length > 0) sourceNode.addClass('path-source');
    if (targetNode.length > 0) targetNode.addClass('path-target');

    // Show only edges between consecutive path nodes
    this.cy.edges().forEach((edge) => {
      const src = edge.source().id();
      const tgt = edge.target().id();
      const srcIdx = path.indexOf(src);
      const tgtIdx = path.indexOf(tgt);
      if (srcIdx >= 0 && tgtIdx >= 0 && Math.abs(srcIdx - tgtIdx) === 1) {
        edge.addClass('on-path');
      } else {
        edge.addClass('hidden');
      }
    });

    // Re-run layout on visible elements only so the path compacts nicely
    this.runLayout(false);

    return path;
  }

  /** BFS to find shortest path from source to target using the adjacency map. */
  private bfsPath(sourceId: string, targetId: string): string[] {
    if (sourceId === targetId) return [sourceId];

    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue = [sourceId];
    visited.add(sourceId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = this.adjacency.get(current) || [];

      for (const child of children) {
        if (visited.has(child)) continue;
        visited.add(child);
        parent.set(child, current);

        if (child === targetId) {
          // Reconstruct path
          const path: string[] = [targetId];
          let node = targetId;
          while (parent.has(node)) {
            node = parent.get(node)!;
            path.unshift(node);
          }
          return path;
        }

        queue.push(child);
      }
    }

    return [];
  }
}
