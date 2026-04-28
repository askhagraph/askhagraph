/**
 * @module layout
 * ELK layout configuration for the Graph Viewer.
 * Uses the layered algorithm with left-to-right direction and generous spacing.
 */

import { LAYOUT } from './constants.js';

/** ELK layout options for Cytoscape. */
export interface ElkLayoutOptions {
  name: 'elk';
  elk: Record<string, string>;
  elkInstance?: unknown;
  animate: boolean;
  animationDuration: number;
  fit: boolean;
  padding: number;
}

/**
 * Create the ELK layout configuration for the graph.
 * Uses the layered algorithm with left-to-right flow.
 *
 * IMPORTANT: All ELK layoutOptions values must be strings.
 * ELK.js (compiled from Java via GWT) silently ignores non-string values.
 *
 * @param options - Layout options
 * @param elkInstance - Optional pre-created ELK instance (bundled, no web workers)
 */
export function createElkLayoutOptions(options?: {
  animate?: boolean;
  fit?: boolean;
  direction?: 'RIGHT' | 'LEFT' | 'DOWN' | 'UP';
  elkInstance?: unknown;
}): ElkLayoutOptions {
  const direction = options?.direction ?? 'RIGHT';
  const animate = options?.animate ?? true;
  const fit = options?.fit ?? true;

  const result: ElkLayoutOptions = {
    name: 'elk',
    elk: {
      'algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYOUT.nodeSpacingHorizontal),
      'elk.spacing.nodeNode': String(LAYOUT.nodeSpacingVertical),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'SPLINES',
      'elk.layered.mergeEdges': 'true',
      'elk.padding': '[top=10,left=10,bottom=10,right=10]',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '15',
      'elk.layered.compaction.connectedComponents': 'true',
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
    },
    animate,
    animationDuration: LAYOUT.animationDuration,
    fit,
    padding: 40,
  };

  if (options?.elkInstance) {
    result.elkInstance = options.elkInstance;
  }

  return result;
}

/**
 * Determine which nodes should be auto-collapsed based on depth.
 * Returns a set of node IDs that should start collapsed.
 */
export function getAutoCollapsedNodes(
  entryPointId: string,
  adjacency: Map<string, string[]>,
  maxDepth: number = LAYOUT.autoCollapseDepth,
  excludeNodeIds?: Set<string>,
): Set<string> {
  const collapsed = new Set<string>();
  const visited = new Set<string>();

  interface QueueEntry {
    nodeId: string;
    depth: number;
  }

  const queue: QueueEntry[] = [{ nodeId: entryPointId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    if (visited.has(nodeId)) continue;
    if (excludeNodeIds?.has(nodeId)) continue;
    visited.add(nodeId);

    const children = adjacency.get(nodeId) || [];
    const visibleChildren = excludeNodeIds
      ? children.filter(id => !excludeNodeIds.has(id))
      : children;

    if (depth >= maxDepth && visibleChildren.length > 0) {
      collapsed.add(nodeId);
      continue;
    }

    for (const childId of visibleChildren) {
      if (!visited.has(childId)) {
        queue.push({ nodeId: childId, depth: depth + 1 });
      }
    }
  }

  return collapsed;
}

/**
 * Compute the maximum depth of the graph from the entry point.
 * Uses BFS to find the deepest reachable node.
 */
export function computeMaxDepth(
  entryPointId: string,
  adjacency: Map<string, string[]>,
  excludeNodeIds?: Set<string>,
): number {
  const visited = new Set<string>();
  let maxDepth = 0;

  interface QueueEntry {
    nodeId: string;
    depth: number;
  }

  const queue: QueueEntry[] = [{ nodeId: entryPointId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    if (visited.has(nodeId)) continue;
    if (excludeNodeIds?.has(nodeId)) continue;
    visited.add(nodeId);

    if (depth > maxDepth) {
      maxDepth = depth;
    }

    const children = adjacency.get(nodeId) || [];
    for (const childId of children) {
      if (!visited.has(childId) && !excludeNodeIds?.has(childId)) {
        queue.push({ nodeId: childId, depth: depth + 1 });
      }
    }
  }

  return maxDepth;
}

/**
 * Count the total number of descendants (children, grandchildren, etc.)
 * for a given node. Used to display "+N" on collapsed nodes.
 */
export function countDescendants(
  nodeId: string,
  adjacency: Map<string, string[]>,
): number {
  const visited = new Set<string>();
  const stack = [nodeId];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = adjacency.get(current) || [];

    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        count++;
        stack.push(child);
      }
    }
  }

  return count;
}
