/**
 * @module tracer/condition-tracer
 * Locates all occurrences of a condition or variable in the symbol index,
 * including transitive propagation through wrapper functions and utility methods.
 */

import type {
  SymbolEntry,
  SymbolIndex,
  CallSite,
  ConditionalNode,
} from '../types.js';

/** A single match where a condition/variable is referenced. */
export interface ConditionMatch {
  /** Unique node identifier (filePath:line:name). */
  nodeId: string;
  /** The symbol entry where the match was found. */
  symbolEntry: SymbolEntry;
  /** How the condition is used at this location. */
  matchType:
    | 'direct_evaluation'
    | 'parameter_pass'
    | 'return_value'
    | 'assignment'
    | 'read'
    | 'write';
  /** Line number of the match. */
  line: number;
  /** Source code snippet showing the match context. */
  snippet: string;
}

/** Result of tracing a condition through the codebase. */
export interface ConditionTraceResult {
  /** Nodes where the condition is directly evaluated or referenced. */
  directMatches: ConditionMatch[];
  /** Nodes where the condition is transitively propagated. */
  transitiveMatches: ConditionMatch[];
  /** Arrays of node IDs forming paths through which the condition propagates. */
  affectedPaths: string[][];
}

/**
 * Traces a condition or variable through the symbol index,
 * finding direct references and transitive propagation paths.
 */
export class ConditionTracer {
  /**
   * Trace a condition/variable through the symbol index.
   *
   * @param condition - The condition or variable name to trace
   * @param index - The cross-file symbol index
   * @param maxDepth - Maximum transitive propagation depth (default: 10)
   * @returns Trace result with direct matches, transitive matches, and affected paths
   */
  trace(
    condition: string,
    index: SymbolIndex,
    maxDepth: number = 10,
  ): ConditionTraceResult {
    if (!condition || condition.trim().length === 0) {
      return { directMatches: [], transitiveMatches: [], affectedPaths: [] };
    }

    const conditionLower = condition.toLowerCase();

    // Step 1: Direct scan — find symbols whose name contains the condition
    // or that have call sites referencing the condition
    const directMatches = this.findDirectMatches(conditionLower, index);

    // Step 2: Find transitive matches — callers of direct-match symbols
    const transitiveMatches = this.findTransitiveMatches(
      conditionLower,
      directMatches,
      index,
      maxDepth,
    );

    // Step 3: Build affected paths
    const affectedPaths = this.buildAffectedPaths(
      directMatches,
      transitiveMatches,
      index,
    );

    return { directMatches, transitiveMatches, affectedPaths };
  }

  /**
   * Find symbols that directly reference the condition.
   * A direct match is a symbol whose name contains the condition string,
   * OR a symbol that has call sites in its body range where the callee name
   * contains the condition string.
   */
  private findDirectMatches(
    conditionLower: string,
    index: SymbolIndex,
  ): ConditionMatch[] {
    const matches: ConditionMatch[] = [];
    const seen = new Set<string>();

    // Check symbol names
    for (const entries of index.symbols.values()) {
      for (const symbol of entries) {
        const nodeId = this.buildNodeId(symbol);
        if (seen.has(nodeId)) continue;

        if (symbol.name.toLowerCase().includes(conditionLower)) {
          seen.add(nodeId);
          matches.push({
            nodeId,
            symbolEntry: symbol,
            matchType: 'direct_evaluation',
            line: symbol.line,
            snippet: symbol.signature,
          });
        }
      }
    }

    // Check call sites within symbol body ranges
    for (const [filePath, callSites] of index.callSites) {
      for (const callSite of callSites) {
        if (!callSite.calleeName.toLowerCase().includes(conditionLower)) {
          continue;
        }

        // Find the enclosing symbol for this call site
        const enclosingSymbol = this.findEnclosingSymbol(
          filePath,
          callSite.line,
          index,
        );
        if (!enclosingSymbol) continue;

        const nodeId = this.buildNodeId(enclosingSymbol);
        if (seen.has(nodeId)) continue;

        seen.add(nodeId);
        matches.push({
          nodeId,
          symbolEntry: enclosingSymbol,
          matchType: 'direct_evaluation',
          line: callSite.line,
          snippet: `calls ${callSite.calleeName}(${(callSite.arguments ?? []).join(', ')})`,
        });
      }
    }

    // Check conditionals that might reference the condition
    for (const [filePath, conditionals] of index.conditionals) {
      for (const conditional of conditionals) {
        const enclosingSymbol = this.findEnclosingSymbol(
          filePath,
          conditional.line,
          index,
        );
        if (!enclosingSymbol) continue;

        const nodeId = this.buildNodeId(enclosingSymbol);
        if (seen.has(nodeId)) continue;

        // Check if the enclosing symbol's name suggests condition relevance
        if (enclosingSymbol.name.toLowerCase().includes(conditionLower)) {
          seen.add(nodeId);
          matches.push({
            nodeId,
            symbolEntry: enclosingSymbol,
            matchType: 'direct_evaluation',
            line: conditional.line,
            snippet: `${conditional.kind} with ${conditional.branches} branches`,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Find transitive matches — callers of direct-match symbols.
   * Uses parameter tracking and return value tracking.
   */
  private findTransitiveMatches(
    conditionLower: string,
    directMatches: ConditionMatch[],
    index: SymbolIndex,
    maxDepth: number,
  ): ConditionMatch[] {
    const transitiveMatches: ConditionMatch[] = [];
    const directNodeIds = new Set(directMatches.map((m) => m.nodeId));
    const visited = new Set<string>();
    let currentLevel = directMatches.map((m) => m.symbolEntry);
    let depth = 0;

    while (currentLevel.length > 0 && depth < maxDepth) {
      const nextLevel: SymbolEntry[] = [];

      for (const targetSymbol of currentLevel) {
        // Find all call sites that call this symbol
        const callers = this.findCallers(targetSymbol, index);

        for (const { caller, callSite } of callers) {
          const callerNodeId = this.buildNodeId(caller);
          if (visited.has(callerNodeId) || directNodeIds.has(callerNodeId)) {
            continue;
          }
          visited.add(callerNodeId);

          // Determine match type
          const matchType = this.determineTransitiveMatchType(
            conditionLower,
            callSite,
            targetSymbol,
          );

          transitiveMatches.push({
            nodeId: callerNodeId,
            symbolEntry: caller,
            matchType,
            line: callSite.line,
            snippet: `calls ${callSite.calleeName}(${(callSite.arguments ?? []).join(', ')})`,
          });

          nextLevel.push(caller);
        }
      }

      currentLevel = nextLevel;
      depth++;
    }

    return transitiveMatches;
  }

  /**
   * Determine the transitive match type based on how the condition propagates.
   */
  private determineTransitiveMatchType(
    conditionLower: string,
    callSite: CallSite,
    targetSymbol: SymbolEntry,
  ): ConditionMatch['matchType'] {
    // Check if condition appears as an argument (parameter_pass)
    if (
      callSite.arguments?.some((arg) =>
        arg.toLowerCase().includes(conditionLower),
      )
    ) {
      return 'parameter_pass';
    }

    // Check if the target function name suggests it returns the condition
    const targetNameLower = targetSymbol.name.toLowerCase();
    if (
      targetNameLower.startsWith('get') ||
      targetNameLower.startsWith('calculate') ||
      targetNameLower.startsWith('compute') ||
      targetNameLower.startsWith('fetch')
    ) {
      return 'return_value';
    }

    return 'parameter_pass';
  }

  /**
   * Find all symbols that call a given target symbol.
   */
  private findCallers(
    targetSymbol: SymbolEntry,
    index: SymbolIndex,
  ): { caller: SymbolEntry; callSite: CallSite }[] {
    const results: { caller: SymbolEntry; callSite: CallSite }[] = [];
    const targetName = targetSymbol.name;

    for (const [filePath, callSites] of index.callSites) {
      for (const callSite of callSites) {
        if (callSite.calleeName !== targetName) continue;

        const enclosingSymbol = this.findEnclosingSymbol(
          filePath,
          callSite.line,
          index,
        );
        if (enclosingSymbol) {
          results.push({ caller: enclosingSymbol, callSite });
        }
      }
    }

    return results;
  }

  /**
   * Build affected paths: [caller → direct_match → callee] chains.
   */
  private buildAffectedPaths(
    directMatches: ConditionMatch[],
    transitiveMatches: ConditionMatch[],
    index: SymbolIndex,
  ): string[][] {
    const paths: string[][] = [];

    for (const directMatch of directMatches) {
      // Find callees of the direct match
      const callees = this.findCallees(directMatch.symbolEntry, index);

      // Find callers (from transitive matches)
      const callers = transitiveMatches.filter((tm) => {
        // Check if this transitive match calls the direct match
        const callSites = index.callSites.get(tm.symbolEntry.filePath) ?? [];
        return callSites.some(
          (cs) =>
            cs.calleeName === directMatch.symbolEntry.name &&
            cs.line >= tm.symbolEntry.bodyRange.startLine &&
            cs.line <= tm.symbolEntry.bodyRange.endLine,
        );
      });

      if (callers.length === 0 && callees.length === 0) {
        // Standalone direct match
        paths.push([directMatch.nodeId]);
      } else {
        for (const caller of callers) {
          if (callees.length === 0) {
            paths.push([caller.nodeId, directMatch.nodeId]);
          } else {
            for (const callee of callees) {
              paths.push([
                caller.nodeId,
                directMatch.nodeId,
                this.buildNodeId(callee),
              ]);
            }
          }
        }

        // If no callers but has callees
        if (callers.length === 0) {
          for (const callee of callees) {
            paths.push([directMatch.nodeId, this.buildNodeId(callee)]);
          }
        }
      }
    }

    return paths;
  }

  /**
   * Find symbols called by a given symbol (callees within its body range).
   */
  private findCallees(symbol: SymbolEntry, index: SymbolIndex): SymbolEntry[] {
    const callSites = index.callSites.get(symbol.filePath) ?? [];
    const callees: SymbolEntry[] = [];
    const seen = new Set<string>();

    for (const callSite of callSites) {
      if (
        callSite.line < symbol.bodyRange.startLine ||
        callSite.line > symbol.bodyRange.endLine
      ) {
        continue;
      }

      const targets = index.symbols.get(callSite.calleeName) ?? [];
      for (const target of targets) {
        const nodeId = this.buildNodeId(target);
        if (!seen.has(nodeId)) {
          seen.add(nodeId);
          callees.push(target);
        }
      }
    }

    return callees;
  }

  /**
   * Find the enclosing symbol for a given file and line number.
   */
  private findEnclosingSymbol(
    filePath: string,
    line: number,
    index: SymbolIndex,
  ): SymbolEntry | undefined {
    let bestMatch: SymbolEntry | undefined;
    let smallestRange = Infinity;

    for (const entries of index.symbols.values()) {
      for (const symbol of entries) {
        if (symbol.filePath !== filePath) continue;
        if (
          line >= symbol.bodyRange.startLine &&
          line <= symbol.bodyRange.endLine
        ) {
          const range =
            symbol.bodyRange.endLine - symbol.bodyRange.startLine;
          if (range < smallestRange) {
            smallestRange = range;
            bestMatch = symbol;
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Build a node ID from a symbol entry.
   */
  private buildNodeId(symbol: SymbolEntry): string {
    return `${symbol.filePath}:${symbol.line}:${symbol.name}`;
  }
}
