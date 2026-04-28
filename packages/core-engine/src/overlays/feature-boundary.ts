/**
 * @module overlays/feature-boundary
 * Detects feature boundaries by clustering tightly-connected subgraphs
 * using native Rust Louvain community detection via napi-rs.
 *
 * Falls back to a simple label propagation algorithm if the native
 * addon is not available.
 */

import { createRequire } from 'node:module';
import type { CallGraph } from '../types.js';

/** A detected feature boundary cluster in the call graph. */
export interface FeatureBoundary {
  /** Unique identifier for the cluster (e.g., "cluster-0"). */
  id: string;
  /** Auto-generated name from the dominant directory path. */
  name: string;
  /** IDs of graph nodes belonging to this cluster. */
  nodeIds: string[];
  /** Number of edges crossing between this cluster and other clusters. */
  interClusterEdgeCount: number;
  /** Modularity score of the partition (0.0 to 1.0, higher = better). */
  modularity?: number;
}

/** Native addon interface for Louvain detection. */
interface NativeLouvain {
  detectCommunities(
    nodeIds: string[],
    edges: Array<{ source: string; target: string; weight?: number | null }>,
  ): {
    communities: Array<{ nodeId: string; communityId: number }>;
    modularity: number;
    numCommunities: number;
  };
}

/**
 * Identifies feature boundaries in a call graph using native Rust Louvain
 * community detection for high-quality modularity-optimized clustering.
 */
export class FeatureBoundaryDetector {
  private native: NativeLouvain | null = null;

  constructor() {
    try {
      const require = createRequire(import.meta.url);
      this.native = require('@askhagraph/native') as NativeLouvain;
    } catch {
      // Native addon not available — will use fallback
    }
  }

  /**
   * Detect feature boundary clusters in the call graph.
   */
  detect(graph: CallGraph): FeatureBoundary[] {
    if (graph.nodes.size === 0) {
      return [];
    }

    const nodeIds = Array.from(graph.nodes.keys());

    if (nodeIds.length < 2 || graph.edges.length === 0) {
      return [{
        id: 'cluster-0',
        name: this.generateClusterName(nodeIds, graph),
        nodeIds,
        interClusterEdgeCount: 0,
      }];
    }

    // Build edges for the algorithm (undirected, deduplicated)
    const edgeSet = new Set<string>();
    const edges: Array<{ source: string; target: string }> = [];
    for (const edge of graph.edges) {
      if (edge.sourceId === edge.targetId) continue;
      if (!graph.nodes.has(edge.sourceId) || !graph.nodes.has(edge.targetId)) continue;
      const key = [edge.sourceId, edge.targetId].sort().join('|');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: edge.sourceId, target: edge.targetId });
      }
    }

    // Use native Louvain if available, otherwise fall back to label propagation
    let nodeToComm: Map<string, number>;
    let modularity = 0;

    if (this.native) {
      const result = this.native.detectCommunities(nodeIds, edges);
      nodeToComm = new Map(result.communities.map((c) => [c.nodeId, c.communityId]));
      modularity = result.modularity;
    } else {
      nodeToComm = this.labelPropagation(nodeIds, edges);
    }

    return this.buildBoundaries(nodeToComm, modularity, graph);
  }

  // ─── Label Propagation Fallback ────────────────────────────────────────────

  private labelPropagation(
    nodeIds: string[],
    edges: Array<{ source: string; target: string }>,
  ): Map<string, number> {
    const adj = new Map<string, Set<string>>();
    for (const id of nodeIds) adj.set(id, new Set());
    for (const e of edges) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }

    const labels = new Map<string, number>();
    for (let i = 0; i < nodeIds.length; i++) labels.set(nodeIds[i], i);

    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      for (const nodeId of nodeIds) {
        const neighbors = adj.get(nodeId);
        if (!neighbors || neighbors.size === 0) continue;

        const counts = new Map<number, number>();
        for (const nId of neighbors) {
          const l = labels.get(nId)!;
          counts.set(l, (counts.get(l) ?? 0) + 1);
        }

        let bestLabel = labels.get(nodeId)!;
        let bestCount = 0;
        for (const [l, c] of counts) {
          if (c > bestCount || (c === bestCount && l === labels.get(nodeId))) {
            bestLabel = l;
            bestCount = c;
          }
        }

        if (bestLabel !== labels.get(nodeId)) {
          labels.set(nodeId, bestLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    return labels;
  }

  // ─── Boundary Building ─────────────────────────────────────────────────────

  private buildBoundaries(
    nodeToComm: Map<string, number>,
    modularity: number,
    graph: CallGraph,
  ): FeatureBoundary[] {
    // Group by community
    const clusters = new Map<number, string[]>();
    for (const [nodeId, comm] of nodeToComm) {
      const existing = clusters.get(comm);
      if (existing) existing.push(nodeId);
      else clusters.set(comm, [nodeId]);
    }

    // Count inter-cluster edges
    const interCounts = new Map<number, number>();
    for (const edge of graph.edges) {
      const sc = nodeToComm.get(edge.sourceId);
      const tc = nodeToComm.get(edge.targetId);
      if (sc !== undefined && tc !== undefined && sc !== tc) {
        interCounts.set(sc, (interCounts.get(sc) ?? 0) + 1);
        interCounts.set(tc, (interCounts.get(tc) ?? 0) + 1);
      }
    }

    const boundaries: FeatureBoundary[] = [];
    let idx = 0;
    for (const [comm, nodeIds] of clusters) {
      boundaries.push({
        id: `cluster-${idx}`,
        name: this.generateClusterName(nodeIds, graph),
        nodeIds,
        interClusterEdgeCount: interCounts.get(comm) ?? 0,
        modularity,
      });
      idx++;
    }

    return boundaries;
  }

  // ─── Cluster Naming ────────────────────────────────────────────────────────

  private generateClusterName(nodeIds: string[], graph: CallGraph): string {
    if (nodeIds.length === 0) return 'unknown';

    const dirCounts = new Map<string, number>();
    const generic = new Set(['src', 'lib', 'app', 'main', 'core', 'common', 'shared', 'utils', 'util', 'helpers', 'internal']);

    for (const nodeId of nodeIds) {
      const node = graph.nodes.get(nodeId);
      if (!node) continue;
      const parts = node.filePath.replace(/\\/g, '/').split('/');
      if (parts.length >= 2) {
        const dir = parts[parts.length - 2];
        if (dir && !generic.has(dir.toLowerCase())) {
          dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
        }
      }
    }

    let bestDir = '';
    let bestCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > bestCount) { bestDir = dir; bestCount = count; }
    }

    if (bestDir) return bestDir;
    return graph.nodes.get(nodeIds[0])?.name ?? 'unknown';
  }
}
