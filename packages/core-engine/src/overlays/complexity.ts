/**
 * @module overlays/complexity
 * Computes cyclomatic complexity for each function node in a call graph.
 */

import type { CallGraph, ConditionalNode, SymbolIndex } from '../types.js';

/**
 * Computes McCabe cyclomatic complexity for function and method nodes
 * in a call graph by counting decision points from the symbol index.
 */
export class ComplexityCalculator {
  /**
   * Compute cyclomatic complexity for each function/method node in the graph.
   *
   * Complexity is calculated as:
   *   base (1) + sum of (branches - 1) for each conditional within the function body.
   *
   * Decision points counted:
   * - `if` → branches - 1 (each branch beyond the first adds a path)
   * - `switch` → branches - 1 (each case beyond the first)
   * - `ternary` → branches - 1 (the alternate path)
   * - `match` → branches - 1 (each arm beyond the first)
   *
   * @param graph - The call graph containing function nodes.
   * @param index - The symbol index containing conditional nodes per file.
   * @returns Map of node ID → cyclomatic complexity value.
   */
  compute(graph: CallGraph, index: SymbolIndex): Map<string, number> {
    const complexityMap = new Map<string, number>();

    for (const [nodeId, node] of graph.nodes) {
      // Only compute complexity for function and method nodes
      if (node.kind !== 'function' && node.kind !== 'method') {
        continue;
      }

      // Find the symbol entry to get the body range
      const bodyRange = this.findBodyRange(node.filePath, node.name, node.line, index);
      if (!bodyRange) {
        // No body range found — assign base complexity
        complexityMap.set(nodeId, 1);
        continue;
      }

      const conditionals = this.getConditionalsInRange(
        node.filePath,
        bodyRange.startLine,
        bodyRange.endLine,
        index,
      );

      const complexity = this.calculateComplexity(conditionals);
      complexityMap.set(nodeId, complexity);
    }

    return complexityMap;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Find the body range for a function node by looking up its symbol entry.
   */
  private findBodyRange(
    filePath: string,
    name: string,
    line: number,
    index: SymbolIndex,
  ): { startLine: number; endLine: number } | undefined {
    const entries = index.symbols.get(name);
    if (!entries) {
      return undefined;
    }

    const match = entries.find(
      (e) => e.filePath === filePath && e.line === line,
    );

    return match?.bodyRange;
  }

  /**
   * Get all conditional nodes within a line range from the index.
   */
  private getConditionalsInRange(
    filePath: string,
    startLine: number,
    endLine: number,
    index: SymbolIndex,
  ): ConditionalNode[] {
    const fileConditionals = index.conditionals.get(filePath);
    if (!fileConditionals) {
      return [];
    }

    return fileConditionals.filter(
      (c) => c.line >= startLine && c.line <= endLine,
    );
  }

  /**
   * Calculate cyclomatic complexity from a list of conditional nodes.
   *
   * Base complexity = 1.
   * Each conditional adds (branches - 1) to the complexity.
   */
  private calculateComplexity(conditionals: ConditionalNode[]): number {
    let complexity = 1; // Base complexity

    for (const conditional of conditionals) {
      // Each conditional adds (branches - 1) decision paths.
      // A conditional with 2 branches (if/else) adds 1.
      // A switch with 5 cases adds 4.
      const additionalPaths = Math.max(0, conditional.branches - 1);
      complexity += additionalPaths;
    }

    return complexity;
  }
}
