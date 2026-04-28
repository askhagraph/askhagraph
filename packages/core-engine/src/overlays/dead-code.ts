/**
 * @module overlays/dead-code
 * Detects functions and methods with zero incoming call references in the symbol index.
 */

import type { SymbolEntry, SymbolIndex } from '../types.js';

/** Result of dead code detection. */
export interface DeadCodeResult {
  /** Symbols that have zero incoming call references and are dead code candidates. */
  deadFunctions: SymbolEntry[];
}

/** Symbol kinds that are candidates for dead code detection. */
const CALLABLE_KINDS = new Set(['function', 'method']);

/** Function names excluded from dead code detection (likely external entry points). */
const EXCLUDED_NAMES = new Set([
  'main',
  'constructor',
  'init',
  'setup',
  'teardown',
]);

/**
 * Identifies functions and methods that are never referenced by any call site
 * in the symbol index, making them dead code candidates.
 */
export class DeadCodeDetector {
  /**
   * Detect dead code candidates in the symbol index.
   *
   * A symbol is considered dead code if:
   * 1. It is a function or method
   * 2. No call site in the index references its name
   * 3. It is not a constructor, `main`, or other excluded entry point
   * 4. It is not exported (exported symbols may be called externally)
   *
   * @param index - The symbol index to analyze.
   * @returns Dead code result with candidate symbols.
   */
  detect(index: SymbolIndex): DeadCodeResult {
    const allCalleeNames = this.collectAllCalleeNames(index);
    const exportedNames = this.collectExportedNames(index);
    const deadFunctions: SymbolEntry[] = [];

    for (const entries of index.symbols.values()) {
      for (const entry of entries) {
        if (!CALLABLE_KINDS.has(entry.kind)) {
          continue;
        }

        if (this.isExcluded(entry, exportedNames)) {
          continue;
        }

        if (!allCalleeNames.has(entry.name)) {
          deadFunctions.push(entry);
        }
      }
    }

    return { deadFunctions };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Collect all unique callee names from every call site in the index.
   */
  private collectAllCalleeNames(index: SymbolIndex): Set<string> {
    const names = new Set<string>();

    for (const callSites of index.callSites.values()) {
      for (const callSite of callSites) {
        names.add(callSite.calleeName);
      }
    }

    return names;
  }

  /**
   * Collect all exported symbol names from the index.
   */
  private collectExportedNames(index: SymbolIndex): Set<string> {
    const names = new Set<string>();

    for (const exports of index.exports.values()) {
      for (const exp of exports) {
        names.add(exp.name);
      }
    }

    return names;
  }

  /**
   * Check if a symbol should be excluded from dead code detection.
   */
  private isExcluded(entry: SymbolEntry, exportedNames: Set<string>): boolean {
    // Exclude well-known entry point names
    if (EXCLUDED_NAMES.has(entry.name.toLowerCase())) {
      return true;
    }

    // Exclude constructors by kind
    if (entry.kind === 'constructor') {
      return true;
    }

    // Exclude exported symbols (they may be called from outside the analyzed scope)
    if (exportedNames.has(entry.name)) {
      return true;
    }

    return false;
  }
}
