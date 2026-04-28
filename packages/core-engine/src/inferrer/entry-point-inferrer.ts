/**
 * @module inferrer/entry-point-inferrer
 * Identifies candidate entry points from natural language descriptions
 * using fuzzy matching and framework-specific heuristics.
 */

import stringSimilarity from 'string-similarity';
import type { SymbolEntry, SymbolIndex } from '../types.js';

/** A ranked entry point candidate with relevance score and explanation. */
export interface RankedEntryPoint {
  symbol: SymbolEntry;
  score: number; // 0.0 - 1.0
  reason: string;
}

/** Stop words to filter out during tokenization. */
const STOP_WORDS = new Set([
  'the',
  'a',
  'in',
  'for',
  'to',
  'of',
  'and',
  'or',
  'is',
  'it',
]);

/** Framework-specific patterns that boost entry point likelihood. */
const FRAMEWORK_PATTERNS = {
  lifecycle: [
    'ngOnInit',
    'ngOnDestroy',
    'ngAfterViewInit',
    'useEffect',
    'useState',
    'componentDidMount',
    'componentWillUnmount',
    'componentDidUpdate',
  ],
  annotations: [
    '@RequestMapping',
    '@GetMapping',
    '@PostMapping',
    '@PutMapping',
    '@DeleteMapping',
    '@Scheduled',
  ],
  entryKeywords: [
    'Component',
    'Handler',
    'Controller',
    'route',
    'handler',
    'middleware',
  ],
  classPatterns: [/Controller$/, /Handler$/, /Service$/],
  filePatterns: [/route/i, /controller/i, /handler/i],
} as const;

/**
 * Infers likely entry points from a natural language description
 * by fuzzy-matching keywords against the symbol index and applying
 * framework-specific heuristic boosts.
 */
export class EntryPointInferrer {
  /**
   * Infer entry point candidates from a natural language description.
   *
   * @param description - Natural language description of the feature/flow to analyze
   * @param index - The cross-file symbol index to search
   * @returns Ranked list of up to 5 candidates, or empty array if none score above threshold
   */
  infer(description: string, index: SymbolIndex): RankedEntryPoint[] {
    const keywords = this.tokenize(description);
    if (keywords.length === 0) {
      return [];
    }

    const allSymbols = this.getAllSymbols(index);
    if (allSymbols.length === 0) {
      return [];
    }

    const scored = allSymbols.map((symbol) => {
      const nameSimilarity = this.computeNameSimilarity(keywords, symbol);
      const heuristicBoost = this.computeHeuristicBoost(symbol);
      const combinedScore = nameSimilarity * 0.6 + heuristicBoost * 0.4;
      const reason = this.buildReason(symbol, nameSimilarity, heuristicBoost);
      return { symbol, score: combinedScore, reason };
    });

    // Filter out low-scoring candidates
    const candidates = scored.filter((c) => c.score > 0.1);

    if (candidates.length === 0) {
      return [];
    }

    // Sort by score descending and return top 5
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 5);
  }

  /**
   * Tokenize a description into keywords, removing stop words.
   */
  private tokenize(description: string): string[] {
    return description
      .split(/\s+/)
      .map((word) => word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
      .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
  }

  /**
   * Collect all symbols from the index into a flat array.
   */
  private getAllSymbols(index: SymbolIndex): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    for (const entries of index.symbols.values()) {
      symbols.push(...entries);
    }
    return symbols;
  }

  /**
   * Compute fuzzy name similarity between keywords and a symbol.
   * Uses the best match across all keywords against the symbol name.
   */
  private computeNameSimilarity(
    keywords: string[],
    symbol: SymbolEntry,
  ): number {
    const symbolNameLower = symbol.name.toLowerCase();
    const qualifiedNameLower = symbol.qualifiedName.toLowerCase();

    let maxSimilarity = 0;

    for (const keyword of keywords) {
      // Compare against simple name
      const nameSim = stringSimilarity.compareTwoStrings(
        keyword,
        symbolNameLower,
      );
      // Compare against qualified name
      const qualSim = stringSimilarity.compareTwoStrings(
        keyword,
        qualifiedNameLower,
      );
      // Also check substring containment for a boost
      const containsBoost =
        symbolNameLower.includes(keyword) ||
        qualifiedNameLower.includes(keyword)
          ? 0.3
          : 0;

      maxSimilarity = Math.max(
        maxSimilarity,
        nameSim + containsBoost,
        qualSim + containsBoost,
      );
    }

    // Clamp to [0, 1]
    return Math.min(1.0, maxSimilarity);
  }

  /**
   * Compute heuristic boost based on framework-specific patterns.
   * Returns a value between 0.0 and 1.0.
   */
  private computeHeuristicBoost(symbol: SymbolEntry): number {
    let boost = 0;

    const name = symbol.name;
    const qualifiedName = symbol.qualifiedName;
    const signature = symbol.signature;
    const filePath = symbol.filePath;

    // Angular/React: lifecycle methods and component patterns
    if (FRAMEWORK_PATTERNS.lifecycle.some((lc) => name === lc)) {
      boost = Math.max(boost, 0.8);
    }

    // Angular/React: symbols containing "Component", "Handler", "Controller"
    if (
      FRAMEWORK_PATTERNS.entryKeywords.some(
        (kw) => name.includes(kw) || qualifiedName.includes(kw),
      )
    ) {
      boost = Math.max(boost, 0.6);
    }

    // Java/Spring: annotations in signature
    if (
      FRAMEWORK_PATTERNS.annotations.some((ann) => signature.includes(ann))
    ) {
      boost = Math.max(boost, 0.9);
    }

    // Java: main method
    if (name === 'main' && signature.includes('String[]')) {
      boost = Math.max(boost, 0.9);
    }

    // Express/Hono/Oak/Deno: file path patterns
    if (FRAMEWORK_PATTERNS.filePatterns.some((pat) => pat.test(filePath))) {
      boost = Math.max(boost, 0.5);
    }

    // General: public methods on *Controller, *Handler, *Service classes
    if (
      symbol.visibility === 'public' &&
      FRAMEWORK_PATTERNS.classPatterns.some((pat) =>
        pat.test(qualifiedName.split('.')[0] ?? ''),
      )
    ) {
      boost = Math.max(boost, 0.7);
    }

    return boost;
  }

  /**
   * Build a human-readable reason string explaining why a candidate was selected.
   */
  private buildReason(
    symbol: SymbolEntry,
    nameSimilarity: number,
    heuristicBoost: number,
  ): string {
    const parts: string[] = [];

    if (nameSimilarity > 0.3) {
      parts.push(`name similarity: ${(nameSimilarity * 100).toFixed(0)}%`);
    }

    if (heuristicBoost >= 0.9) {
      if (
        FRAMEWORK_PATTERNS.annotations.some((ann) =>
          symbol.signature.includes(ann),
        )
      ) {
        parts.push('Spring annotation detected');
      } else if (
        symbol.name === 'main' &&
        symbol.signature.includes('String[]')
      ) {
        parts.push('Java main method');
      }
    } else if (heuristicBoost >= 0.8) {
      parts.push('framework lifecycle method');
    } else if (heuristicBoost >= 0.7) {
      parts.push('public method on Controller/Handler/Service class');
    } else if (heuristicBoost >= 0.6) {
      parts.push('matches entry point naming pattern');
    } else if (heuristicBoost >= 0.5) {
      parts.push('located in route/controller/handler file');
    }

    if (parts.length === 0) {
      parts.push('fuzzy match against description keywords');
    }

    return parts.join('; ');
  }
}
