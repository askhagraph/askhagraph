/**
 * @module types
 * Shared type definitions for the AskhaGraph core engine.
 */

// ─── Literal Union Types ─────────────────────────────────────────────────────

/** Supported programming languages for parsing and analysis. */
export type LanguageId =
  | 'typescript'
  | 'javascript'
  | 'java'
  | 'rust'
  | 'python'
  | 'go'
  | 'csharp';

/** Classification of extracted symbols from source code. */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'constructor'
  | 'getter'
  | 'setter';

/** Classification of nodes in the call graph. */
export type NodeKind =
  | 'function'
  | 'method'
  | 'conditional'
  | 'loop'
  | 'callback'
  | 'unresolved';

/** Classification of edges connecting graph nodes. */
export type EdgeKind =
  | 'call'
  | 'conditional_flow'
  | 'callback'
  | 'cycle_back_edge'
  | 'depth_limited';

/** Supported output serialization formats. */
export type OutputFormat = 'json' | 'mermaid' | 'tree';

// ─── Parse-Related Types ─────────────────────────────────────────────────────

/** Result of parsing a single source file with tree-sitter. */
export interface ParseResult {
  /** Absolute path to the parsed file. */
  filePath: string;
  /** Detected or overridden language of the file. */
  languageId: LanguageId;
  /** Symbols (functions, methods, classes) extracted from the file. */
  symbols: SymbolEntry[];
  /** Call expressions found in the file. */
  callSites: CallSite[];
  /** Conditional/branching nodes found in the file. */
  conditionals: ConditionalNode[];
  /** Parse errors encountered during analysis. */
  errors: ParseError[];
}

/** A call expression found in source code. */
export interface CallSite {
  /** Name of the function or method being called. */
  calleeName: string;
  /** File where the call occurs. */
  filePath: string;
  /** Line number of the call expression. */
  line: number;
  /** Column number of the call expression start. */
  column: number;
  /** Column of the actual function/method name (for precise navigation). */
  nameColumn?: number;
  /** Optional stringified argument expressions. */
  arguments?: string[];
}

/** A conditional or branching node in source code. */
export interface ConditionalNode {
  /** Type of conditional construct. */
  kind: 'if' | 'switch' | 'ternary' | 'match';
  /** File where the conditional occurs. */
  filePath: string;
  /** Line number of the conditional. */
  line: number;
  /** Column number of the conditional. */
  column: number;
  /** End line of the conditional's body (from tree-sitter). */
  endLine: number;
  /** Number of branches in the conditional. */
  branches: number;
  /** The condition expression text (e.g., "this.webviewReady", "cart.isEmpty()"). */
  conditionText?: string;
}

/** An error encountered during file parsing. */
export interface ParseError {
  /** File where the error occurred. */
  filePath: string;
  /** Line number of the error. */
  line: number;
  /** Column number of the error. */
  column: number;
  /** Human-readable error message. */
  message: string;
}

// ─── Symbol Index Types ──────────────────────────────────────────────────────

/** A symbol (function, method, class) extracted from source code. */
export interface SymbolEntry {
  /** Simple name of the symbol. */
  name: string;
  /** Fully qualified name (e.g., "MyClass.myMethod"). */
  qualifiedName: string;
  /** Classification of the symbol. */
  kind: SymbolKind;
  /** File where the symbol is defined. */
  filePath: string;
  /** Line number of the symbol definition. */
  line: number;
  /** Column number of the symbol definition. */
  column: number;
  /** Function/method signature string. */
  signature: string;
  /** Line range of the symbol's body. */
  bodyRange: { startLine: number; endLine: number };
  /** Access visibility of the symbol. */
  visibility: 'public' | 'private' | 'protected' | 'default';
  /** Language the symbol was parsed from. */
  languageId: LanguageId;
}

/** An import declaration extracted from a source file. */
export interface ImportEntry {
  /** Module specifier or path being imported from. */
  source: string;
  /** Names of imported bindings. */
  specifiers: string[];
  /** File containing the import declaration. */
  filePath: string;
}

/** An export declaration extracted from a source file. */
export interface ExportEntry {
  /** Name of the exported binding. */
  name: string;
  /** Kind of the exported symbol. */
  kind: SymbolKind;
  /** File containing the export declaration. */
  filePath: string;
}

/** Cross-file symbol index for resolving references. */
export interface SymbolIndex {
  /** Map from symbol name to all definitions with that name. */
  symbols: Map<string, SymbolEntry[]>;
  /** Map from file path to its import declarations. */
  imports: Map<string, ImportEntry[]>;
  /** Map from file path to its export declarations. */
  exports: Map<string, ExportEntry[]>;
  /** Map from file path to content hash for cache invalidation. */
  fileHashes: Map<string, string>;
  /** Map from file path to call sites found in that file. */
  callSites: Map<string, CallSite[]>;
  /** Map from file path to conditional nodes found in that file. */
  conditionals: Map<string, ConditionalNode[]>;
}

/** A successfully resolved symbol reference (the definition). */
export type ResolvedSymbol = SymbolEntry;

/** A symbol reference that could not be resolved to a definition. */
export interface UnresolvedSymbol {
  /** Simple name that was referenced. */
  name: string;
  /** Callee name from the call site. */
  calleeName: string;
  /** File where the unresolved reference occurs. */
  filePath: string;
  /** Line number of the unresolved reference. */
  line: number;
  /** Column number of the unresolved reference. */
  column: number;
}

// ─── Graph Types ─────────────────────────────────────────────────────────────

/** A node in the call graph representing a function, method, or control flow construct. */
export interface GraphNode {
  /** Unique identifier: `${filePath}:${line}:${name}`. */
  id: string;
  /** Simple name of the node. */
  name: string;
  /** Fully qualified name. */
  qualifiedName: string;
  /** Classification of the node. */
  kind: NodeKind;
  /** File where the node is defined. */
  filePath: string;
  /** Line number of the node. */
  line: number;
  /** Column number of the node. */
  column: number;
  /** Function/method signature. */
  signature: string;
  /** Source code body (for AI context). */
  body: string;
  /** Additional metadata about the node. */
  metadata: NodeMetadata;
}

/** Metadata attached to a graph node. */
export interface NodeMetadata {
  /** Access visibility of the symbol. */
  visibility: 'public' | 'private' | 'protected' | 'default';
  /** Whether traversal was stopped at this node due to depth limit. */
  isDepthLimited: boolean;
  /** Whether the symbol could not be resolved to a definition. */
  isUnresolved: boolean;
  /** Whether this node participates in a call cycle. */
  isCycleParticipant: boolean;
  /** McCabe cyclomatic complexity (Phase 3). */
  cyclomaticComplexity?: number;
  /** Test coverage percentage (Phase 3). */
  coverage?: number;
  /** Git churn score (Phase 3). */
  churn?: number;
  /** User-defined annotations (Phase 2). */
  annotations?: string[];
  /** Data flow information (Phase 3). */
  dataFlow?: Record<string, unknown>;
  /** Feature boundary cluster identifier (Phase 3). */
  featureBoundary?: string;
}

/** A directed edge in the call graph. */
export interface Edge {
  /** ID of the source (caller) node. */
  sourceId: string;
  /** ID of the target (callee) node. */
  targetId: string;
  /** Classification of the edge. */
  kind: EdgeKind;
  /** Additional metadata about the edge. */
  metadata: EdgeMetadata;
}

/** Metadata attached to a graph edge. */
export interface EdgeMetadata {
  [key: string]: unknown;
}

/** The complete call graph produced by the graph builder. */
export interface CallGraph {
  /** Map from node ID to graph node. */
  nodes: Map<string, GraphNode>;
  /** All edges in the graph. */
  edges: Edge[];
  /** ID of the entry point node. */
  entryPointId: string;
  /** Metadata about how the graph was generated. */
  metadata: GraphMetadata;
}

/** Metadata describing how a call graph was generated. */
export interface GraphMetadata {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Entry point symbol or file path used for traversal. */
  entryPoint: string;
  /** Direction of graph traversal. */
  traversalDirection: 'downstream' | 'upstream' | 'bidirectional';
  /** Maximum traversal depth (null = unlimited). */
  maxDepth: number | null;
  /** Maximum node count limit used during traversal (null = unlimited). */
  maxNodes?: number | null;
  /** Whether the graph was truncated due to the node cap being reached. */
  truncated?: boolean;
  /** ISO 8601 timestamp of graph generation. */
  generatedAt: string;
  /** Version of the engine that produced this graph. */
  engineVersion: string;
  /** Whether the index was partial (e.g., some files failed to parse). */
  partialIndex?: boolean;
}

// ─── Configuration Types ─────────────────────────────────────────────────────

/** Options controlling graph traversal behavior. */
export interface TraversalOptions {
  /** Maximum depth to traverse (undefined = unlimited). */
  maxDepth?: number;
  /** Maximum number of nodes in the graph (default 500). Prevents OOM on highly connected codebases. */
  maxNodes?: number;
  /** Whether to include conditional nodes (if/switch/ternary). */
  includeConditionals: boolean;
  /** Whether to include loop nodes (for/while/do-while). */
  includeLoops: boolean;
  /** Whether to include callback/closure nodes. */
  includeCallbacks: boolean;
}

/** Project-level configuration for AskhaGraph. */
export interface ProjectConfig {
  /** Glob patterns for files to include in analysis. */
  include: string[];
  /** Glob patterns for files to exclude from analysis. */
  exclude: string[];
  /** Manual language overrides by file extension. */
  languageOverrides: Record<string, LanguageId>;
  /** Default traversal depth when not specified. */
  defaultDepth: number;
  /** Default output format. */
  defaultFormat: OutputFormat;
  /** Maximum cache size in megabytes. */
  cacheMaxSizeMB: number;
  /** Analysis timeout in seconds. */
  timeoutSeconds: number;
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

const LANGUAGE_IDS: ReadonlySet<string> = new Set<LanguageId>([
  'typescript',
  'javascript',
  'java',
  'rust',
  'python',
  'go',
  'csharp',
]);

const SYMBOL_KINDS: ReadonlySet<string> = new Set<SymbolKind>([
  'function',
  'method',
  'class',
  'constructor',
  'getter',
  'setter',
]);

const NODE_KINDS: ReadonlySet<string> = new Set<NodeKind>([
  'function',
  'method',
  'conditional',
  'loop',
  'callback',
  'unresolved',
]);

const EDGE_KINDS: ReadonlySet<string> = new Set<EdgeKind>([
  'call',
  'conditional_flow',
  'callback',
  'cycle_back_edge',
  'depth_limited',
]);

/** Type guard for LanguageId. */
export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && LANGUAGE_IDS.has(value);
}

/** Type guard for SymbolKind. */
export function isSymbolKind(value: unknown): value is SymbolKind {
  return typeof value === 'string' && SYMBOL_KINDS.has(value);
}

/** Type guard for NodeKind. */
export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === 'string' && NODE_KINDS.has(value);
}

/** Type guard for EdgeKind. */
export function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === 'string' && EDGE_KINDS.has(value);
}
