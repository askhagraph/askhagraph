/**
 * @module overlays/temporal
 * Computes git history metrics (churn, recency) for each function node in a call graph.
 */

import { execSync } from 'node:child_process';
import type { CallGraph } from '../types.js';

/** Options for temporal analysis. */
export interface TemporalOptions {
  /** Number of days to look back in git history. Default: 90. */
  timeWindowDays: number;
}

/** Temporal information for a single graph node. */
export interface TemporalInfo {
  /** Number of commits touching the file within the time window. */
  churn: number;
  /** ISO date of the last modification to the file. */
  lastModified: string;
  /** Whether the file was first committed within the time window. */
  isRecentlyAdded: boolean;
}

/** Default temporal analysis options. */
const DEFAULT_OPTIONS: TemporalOptions = {
  timeWindowDays: 90,
};

/**
 * Analyzes git history to compute churn, last-modified dates, and recency
 * for each function/method node in a call graph.
 */
export class TemporalAnalyzer {
  /**
   * Analyze temporal metrics for each function/method node in the graph.
   *
   * @param graph - The call graph to analyze.
   * @param gitRepoPath - Path to the git repository root.
   * @param options - Temporal analysis options.
   * @returns Map of node ID → temporal info.
   */
  analyze(
    graph: CallGraph,
    gitRepoPath: string,
    options?: TemporalOptions,
  ): Map<string, TemporalInfo> {
    const result = new Map<string, TemporalInfo>();

    if (graph.nodes.size === 0) {
      return result;
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const sinceDate = this.computeSinceDate(opts.timeWindowDays);

    // Cache git results per file to avoid redundant git commands
    const fileCache = new Map<string, TemporalInfo>();

    for (const [nodeId, node] of graph.nodes) {
      // Only compute temporal info for function and method nodes
      if (node.kind !== 'function' && node.kind !== 'method') {
        continue;
      }

      const filePath = node.filePath;
      const cached = fileCache.get(filePath);

      if (cached) {
        result.set(nodeId, cached);
        continue;
      }

      const info = this.computeTemporalInfo(filePath, gitRepoPath, sinceDate);
      fileCache.set(filePath, info);
      result.set(nodeId, info);
    }

    return result;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Compute the ISO date string for the start of the time window.
   */
  private computeSinceDate(timeWindowDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() - timeWindowDays);
    return date.toISOString().split('T')[0];
  }

  /**
   * Compute temporal info for a single file.
   */
  private computeTemporalInfo(
    filePath: string,
    gitRepoPath: string,
    sinceDate: string,
  ): TemporalInfo {
    const churn = this.getChurn(filePath, gitRepoPath, sinceDate);
    const lastModified = this.getLastModified(filePath, gitRepoPath);
    const isRecentlyAdded = this.getIsRecentlyAdded(filePath, gitRepoPath, sinceDate);

    return { churn, lastModified, isRecentlyAdded };
  }

  /**
   * Count the number of commits touching a file within the time window.
   */
  private getChurn(filePath: string, gitRepoPath: string, sinceDate: string): number {
    try {
      const output = execSync(
        `git log --follow --format=%H --since=${sinceDate} -- "${filePath}"`,
        { cwd: gitRepoPath, encoding: 'utf-8', timeout: 10_000 },
      );

      if (!output.trim()) {
        return 0;
      }

      return output.trim().split('\n').length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the last modified date of a file from git history.
   */
  private getLastModified(filePath: string, gitRepoPath: string): string {
    try {
      const output = execSync(
        `git log -1 --format=%aI -- "${filePath}"`,
        { cwd: gitRepoPath, encoding: 'utf-8', timeout: 10_000 },
      );

      const date = output.trim();
      if (!date) {
        return new Date().toISOString();
      }

      return date;
    } catch {
      return new Date().toISOString();
    }
  }

  /**
   * Check if a file was first committed within the time window.
   */
  private getIsRecentlyAdded(
    filePath: string,
    gitRepoPath: string,
    sinceDate: string,
  ): boolean {
    try {
      const output = execSync(
        `git log --diff-filter=A --format=%aI -- "${filePath}"`,
        { cwd: gitRepoPath, encoding: 'utf-8', timeout: 10_000 },
      );

      const addedDate = output.trim();
      if (!addedDate) {
        return false;
      }

      // Compare the file's creation date against the time window start
      return new Date(addedDate) >= new Date(sinceDate);
    } catch {
      return false;
    }
  }
}
