/**
 * @module overlays
 * Analysis overlay modules that enrich call graphs with additional metadata.
 */

export { ChangeImpactAnalyzer } from './change-impact.js';
export type { ImpactResult } from './change-impact.js';

export { DeadCodeDetector } from './dead-code.js';
export type { DeadCodeResult } from './dead-code.js';

export { ComplexityCalculator } from './complexity.js';

export { CoverageMapper } from './coverage.js';
export type { CoverageInfo, CoverageFormat } from './coverage.js';

export { FeatureBoundaryDetector } from './feature-boundary.js';
export type { FeatureBoundary } from './feature-boundary.js';

export { TemporalAnalyzer } from './temporal.js';
export type { TemporalOptions, TemporalInfo } from './temporal.js';

export { DataFlowTracer } from './data-flow.js';
export type {
  DataFlowSource,
  DataFlowPath,
  SinkDetection,
  DataFlowResult,
} from './data-flow.js';
