/**
 * @module overlays/change-impact
 * Analyzes git diffs to identify modified call graph nodes and compute blast radius.
 */

import { execSync } from 'node:child_process';
import type { CallGraph, GraphNode } from '../types.js';

/** Result of a change impact analysis. */
export interface ImpactResult {
  /** IDs of graph nodes whose source code is modified by the diff. */
  modifiedNodes: string[];
  /** Map of node ID → distance from the nearest modified node (BFS upstream). */
  blastRadius: Map<string, number>;
  /** IDs of nodes in the blast radius that have callers outside the current graph scope. */
  externalDependents: string[];
}

/** A range of modified lines within a single file, parsed from a git diff. */
interface DiffHunk {
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Identifies call graph nodes affected by code changes and computes
 * the upstream blast radius from each modified node.
 */
export class ChangeImpactAnalyzer {
  /**
   * Analyze a call graph against a git diff to find modified nodes,
   * compute blast radius, and flag external dependents.
   *
   * @param graph - The call graph to analyze.
   * @param gitDiff - Raw unified diff string. If omitted, runs `git diff HEAD` from projectRoot.
   * @param projectRoot - Project root directory for running git commands.
   * @returns Impact result with modified nodes, blast radius, and external dependents.
   */
  analyze(graph: CallGraph, gitDiff?: string, projectRoot?: string): ImpactResult {
    if (graph.nodes.size === 0) {
      return { modifiedNodes: [], blastRadius: new Map(), externalDependents: [] };
    }

    const diff = gitDiff ?? this.getGitDiff(projectRoot);
    const hunks = this.parseDiff(diff);
    const modifiedNodes = this.findModifiedNodes(graph, hunks);
    const blastRadius = this.computeBlastRadius(graph, modifiedNodes);
    const externalDependents = this.findExternalDependents(graph, blastRadius);

    return { modifiedNodes, blastRadius, externalDependents };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Run `git diff HEAD` to get the current working tree diff.
   */
  private getGitDiff(projectRoot?: string): string {
    try {
      const cwd = projectRoot ?? process.cwd();
      return execSync('git diff HEAD', { cwd, encoding: 'utf-8', timeout: 10_000 });
    } catch {
      return '';
    }
  }

  /**
   * Parse a unified diff into file-level line-range hunks.
   *
   * Extracts `diff --git a/... b/...` headers and `@@ -old,len +new,len @@` hunk headers
   * to determine which lines in which files were modified.
   */
  private parseDiff(diff: string): DiffHunk[] {
    if (!diff.trim()) {
      return [];
    }

    const hunks: DiffHunk[] = [];
    const lines = diff.split('\n');
    let currentFile: string | null = null;

    for (const line of lines) {
      // Match file header: diff --git a/path b/path
      // or +++ b/path (more reliable for the new file path)
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        continue;
      }

      // Match hunk header: @@ -old,len +new,start[,len] @@
      if (line.startsWith('@@') && currentFile) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          const startLine = parseInt(match[1], 10);
          const lineCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
          if (lineCount > 0) {
            hunks.push({
              filePath: currentFile,
              startLine,
              endLine: startLine + lineCount - 1,
            });
          }
        }
      }
    }

    return hunks;
  }

  /**
   * Find graph nodes whose file path and body range overlap with any diff hunk.
   */
  private findModifiedNodes(graph: CallGraph, hunks: DiffHunk[]): string[] {
    if (hunks.length === 0) {
      return [];
    }

    const modifiedIds: string[] = [];

    for (const [id, node] of graph.nodes) {
      if (this.isNodeModified(node, hunks)) {
        modifiedIds.push(id);
      }
    }

    return modifiedIds;
  }

  /**
   * Check if a node's source location overlaps with any diff hunk.
   * Matches by file path suffix (diff paths are relative, node paths may be absolute).
   */
  private isNodeModified(node: GraphNode, hunks: DiffHunk[]): boolean {
    for (const hunk of hunks) {
      if (!this.filePathsMatch(node.filePath, hunk.filePath)) {
        continue;
      }

      // Use node line as a single-point check if no body range metadata is available.
      // GraphNode doesn't have bodyRange directly, but we can use the line number
      // and check if the hunk overlaps with the node's location.
      const nodeLine = node.line;
      if (nodeLine >= hunk.startLine && nodeLine <= hunk.endLine) {
        return true;
      }

      // Also check if the hunk falls within the node's body range
      // by looking at the node's metadata for body range info.
      // Since GraphNode doesn't expose bodyRange, we approximate using the node line.
    }
    return false;
  }

  /**
   * Check if two file paths refer to the same file.
   * Handles relative vs absolute paths by checking suffix match.
   */
  private filePathsMatch(nodePath: string, diffPath: string): boolean {
    const normalizedNode = nodePath.replace(/\\/g, '/');
    const normalizedDiff = diffPath.replace(/\\/g, '/');

    if (normalizedNode === normalizedDiff) {
      return true;
    }

    // Check if one is a suffix of the other (handles absolute vs relative)
    return normalizedNode.endsWith(normalizedDiff) || normalizedDiff.endsWith(normalizedNode);
  }

  /**
   * BFS upstream from each modified node to compute blast radius distances.
   * Distance 0 = the modified node itself.
   */
  private computeBlastRadius(
    graph: CallGraph,
    modifiedNodeIds: string[],
  ): Map<string, number> {
    const blastRadius = new Map<string, number>();

    if (modifiedNodeIds.length === 0) {
      return blastRadius;
    }

    // Build a reverse adjacency list: target → [source IDs]
    const reverseAdj = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const callers = reverseAdj.get(edge.targetId);
      if (callers) {
        callers.push(edge.sourceId);
      } else {
        reverseAdj.set(edge.targetId, [edge.sourceId]);
      }
    }

    // BFS from all modified nodes simultaneously
    const queue: Array<{ nodeId: string; distance: number }> = [];

    for (const id of modifiedNodeIds) {
      blastRadius.set(id, 0);
      queue.push({ nodeId: id, distance: 0 });
    }

    while (queue.length > 0) {
      const { nodeId, distance } = queue.shift()!;
      const callers = reverseAdj.get(nodeId);
      if (!callers) {
        continue;
      }

      for (const callerId of callers) {
        const newDistance = distance + 1;
        const existing = blastRadius.get(callerId);
        if (existing === undefined || newDistance < existing) {
          blastRadius.set(callerId, newDistance);
          queue.push({ nodeId: callerId, distance: newDistance });
        }
      }
    }

    return blastRadius;
  }

  /**
   * Find nodes in the blast radius that have callers outside the current graph scope.
   * A node is an external dependent if any of its callers (from the reverse adjacency)
   * are not present in the graph's node set.
   *
   * Since we only have edges within the graph, we flag nodes that are at the
   * "boundary" — nodes in the blast radius that are entry points (have no incoming
   * edges within the graph) but are not the graph's root entry point.
   */
  private findExternalDependents(
    graph: CallGraph,
    blastRadius: Map<string, number>,
  ): string[] {
    if (blastRadius.size === 0) {
      return [];
    }

    // Build set of nodes that have incoming edges within the graph
    const hasIncomingEdge = new Set<string>();
    for (const edge of graph.edges) {
      hasIncomingEdge.add(edge.targetId);
    }

    const externalDependents: string[] = [];

    for (const [nodeId] of blastRadius) {
      // A node in the blast radius is an external dependent if:
      // 1. It has no incoming edges within the graph (boundary node), AND
      // 2. It is not the graph's entry point (the entry point is expected to have no callers)
      if (!hasIncomingEdge.has(nodeId) && nodeId !== graph.entryPointId) {
        externalDependents.push(nodeId);
      }
    }

    return externalDependents;
  }
}
