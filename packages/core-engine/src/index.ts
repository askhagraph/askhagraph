/**
 * @module @askhagraph/core-engine
 * Core analysis engine for AskhaGraph call graph explorer.
 *
 * Re-exports all shared types, interfaces, and type guards.
 */

export type {
  CallGraph,
  CallSite,
  ConditionalNode,
  Edge,
  EdgeKind,
  EdgeMetadata,
  ExportEntry,
  GraphMetadata,
  GraphNode,
  ImportEntry,
  LanguageId,
  NodeKind,
  NodeMetadata,
  OutputFormat,
  ParseError,
  ParseResult,
  ProjectConfig,
  ResolvedSymbol,
  SymbolEntry,
  SymbolIndex,
  SymbolKind,
  TraversalOptions,
  UnresolvedSymbol,
} from './types.js';

export {
  isEdgeKind,
  isLanguageId,
  isNodeKind,
  isSymbolKind,
} from './types.js';

export type {
  CachedIndex,
  FileEntry,
  ICacheManager,
  IConfigLoader,
  IGraphBuilder,
  IGraphSerializer,
  ISymbolIndexer,
  ITreeSitterParser,
} from './interfaces.js';

export { ENGINE_VERSION } from './constants.js';
export { LazySymbolIndex } from './lazy-index.js';

export { GraphBuilder } from './graph/index.js';

export { GraphSerializer } from './serializer/index.js';

export { ConfigLoader } from './config/index.js';

export { CacheManager } from './cache/index.js';

export { StdioServer } from './server/index.js';
export type { StdioRequest, StdioResponse } from './server/index.js';

export { EntryPointInferrer } from './inferrer/index.js';
export type { RankedEntryPoint } from './inferrer/index.js';

export { ConditionTracer } from './tracer/index.js';
export type { ConditionMatch, ConditionTraceResult } from './tracer/index.js';

export { AnnotationManager } from './annotations/index.js';
export type { Annotation } from './annotations/index.js';

export { ChangeImpactAnalyzer } from './overlays/index.js';
export type { ImpactResult } from './overlays/index.js';

export { DeadCodeDetector } from './overlays/index.js';
export type { DeadCodeResult } from './overlays/index.js';

export { ComplexityCalculator } from './overlays/index.js';

export { CoverageMapper } from './overlays/index.js';
export type { CoverageInfo, CoverageFormat } from './overlays/index.js';

export { FeatureBoundaryDetector } from './overlays/index.js';
export type { FeatureBoundary } from './overlays/index.js';

export { TemporalAnalyzer } from './overlays/index.js';
export type { TemporalOptions, TemporalInfo } from './overlays/index.js';

export { DataFlowTracer } from './overlays/index.js';
export type {
  DataFlowSource,
  DataFlowPath,
  SinkDetection,
  DataFlowResult,
} from './overlays/index.js';
