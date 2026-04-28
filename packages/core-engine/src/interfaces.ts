/**
 * @module interfaces
 * Component interfaces for the AskhaGraph core engine.
 */

import type {
  CallGraph,
  CallSite,
  LanguageId,
  ParseResult,
  ProjectConfig,
  ResolvedSymbol,
  SymbolEntry,
  SymbolIndex,
  TraversalOptions,
  UnresolvedSymbol,
} from './types.js';

// ─── Parser Interface ────────────────────────────────────────────────────────

/** A file entry for batch parsing. */
export interface FileEntry {
  /** Absolute path to the source file. */
  filePath: string;
  /** Language to use for parsing. */
  languageId: LanguageId;
}

/**
 * Native tree-sitter parser interface.
 *
 * Implemented in Rust via napi-rs. Parses source files into structured
 * results containing symbols, call sites, and conditionals.
 */
export interface ITreeSitterParser {
  /** Initialize the parser with grammars for all supported languages. */
  initialize(): void;

  /** Parse a single source file and extract symbols, call sites, and conditionals. */
  parseFile(filePath: string, languageId: LanguageId): ParseResult;

  /** Parse multiple files in parallel using Rust's rayon. */
  parseFiles(files: FileEntry[]): ParseResult[];

  /** Check if a file extension maps to a supported language. */
  isSupported(extension: string): boolean;
}

// ─── Symbol Indexer Interface ────────────────────────────────────────────────

/**
 * Symbol indexer interface.
 *
 * Builds and maintains the cross-file symbol index used for resolving
 * call sites to their definitions.
 */
export interface ISymbolIndexer {
  /** Build a complete symbol index from parse results. */
  buildIndex(parseResults: ParseResult[]): SymbolIndex;

  /** Incrementally update an existing index with changed file results. */
  updateIndex(index: SymbolIndex, changedFiles: ParseResult[]): SymbolIndex;

  /** Resolve a call site to its definition or mark it as unresolved. */
  resolveCall(
    callSite: CallSite,
    index: SymbolIndex,
  ): ResolvedSymbol | UnresolvedSymbol;
}

// ─── Graph Builder Interface ─────────────────────────────────────────────────

/**
 * Graph builder interface.
 *
 * Constructs directed call graphs from entry points using the symbol index.
 * Supports downstream (callees), upstream (callers), and bidirectional traversal.
 */
export interface IGraphBuilder {
  /** Build a downstream call graph from an entry point (who does this function call?). */
  buildDownstream(
    entryPoint: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
  ): CallGraph;

  /** Build an upstream caller graph to a target (who calls this function?). */
  buildUpstream(
    target: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
  ): CallGraph;

  /** Build a bidirectional graph combining upstream and downstream from a target. */
  buildBidirectional(
    target: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
  ): CallGraph;
}

// ─── Graph Serializer Interface ──────────────────────────────────────────────

/**
 * Graph serializer interface.
 *
 * Converts call graphs to and from various output formats (JSON, Mermaid, text tree).
 */
export interface IGraphSerializer {
  /** Serialize a call graph to a JSON string. */
  serialize(graph: CallGraph): string;

  /** Deserialize a JSON string back into a CallGraph. */
  deserialize(json: string): CallGraph;

  /** Convert a call graph to Mermaid diagram syntax. */
  toMermaid(graph: CallGraph): string;

  /** Convert a call graph to an indented text tree representation. */
  toTextTree(graph: CallGraph): string;
}

// ─── Cache Manager Interface ─────────────────────────────────────────────────

/** A cached symbol index with version and timestamp metadata. */
export interface CachedIndex {
  /** Engine version that produced this cache. */
  engineVersion: string;
  /** ISO 8601 timestamp when the cache was created. */
  timestamp: string;
  /** The cached symbol index. */
  index: SymbolIndex;
}

/**
 * Cache manager interface.
 *
 * Handles persistence and retrieval of symbol indexes to avoid
 * re-parsing unchanged files.
 */
export interface ICacheManager {
  /** Load a cached index for the given project root, or null if not found. */
  load(projectRoot: string): CachedIndex | null;

  /** Save a symbol index to the cache for the given project root. */
  save(projectRoot: string, index: SymbolIndex): void;

  /** Check if a cached index is compatible with the current engine version. */
  isCompatible(cache: CachedIndex): boolean;

  /** Evict cache entries to stay within the size limit. */
  evict(projectRoot: string, maxSizeMB: number): void;
}

// ─── Config Loader Interface ─────────────────────────────────────────────────

/**
 * Configuration loader interface.
 *
 * Loads project configuration from `.askhagraph.json` and merges with
 * CLI flags and defaults.
 */
export interface IConfigLoader {
  /** Load project configuration, merging file config with optional CLI flags. */
  load(projectRoot: string, cliFlags?: Partial<ProjectConfig>): ProjectConfig;
}
