/**
 * @module server/stdio-server
 * JSON-over-stdio server for AskhaGraph Core Engine.
 *
 * Reads newline-delimited JSON requests from stdin, dispatches to handlers,
 * and writes JSON responses to stdout.
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { resolve } from 'node:path';
import type {
  CallGraph,
  SymbolEntry,
  SymbolIndex,
  TraversalOptions,
} from '../types.js';
import { GraphBuilder } from '../graph/index.js';
import { GraphSerializer } from '../serializer/index.js';
import { EntryPointInferrer } from '../inferrer/index.js';
import { ConditionTracer } from '../tracer/index.js';
import { LazySymbolIndex } from '../lazy-index.js';
import {
  ChangeImpactAnalyzer,
  DeadCodeDetector,
  ComplexityCalculator,
  CoverageMapper,
  FeatureBoundaryDetector,
  TemporalAnalyzer,
  DataFlowTracer,
} from '../overlays/index.js';

// ─── Protocol Types ──────────────────────────────────────────────────────────

/** Request envelope for stdio communication. */
export interface StdioRequest {
  /** Unique request correlation ID. */
  id: string;
  /** Request type determining which handler processes it. */
  type:
    | 'analyze'
    | 'analyze_nl'
    | 'search_condition'
    | 'annotate_add'
    | 'annotate_remove'
    | 'file_changed'
    | 'cancel'
    | 'overlay';
  /** Request-specific payload. */
  payload: Record<string, unknown>;
}

/** Response envelope for stdio communication. */
export interface StdioResponse {
  /** Matches the request ID. */
  id: string;
  /** Response type. */
  type: 'result' | 'candidates' | 'error' | 'progress';
  /** Response-specific payload. */
  payload: Record<string, unknown>;
}

// ─── StdioServer ─────────────────────────────────────────────────────────────

/**
 * A JSON-over-stdio server that accepts requests on stdin and writes
 * responses to stdout. Implements a single-request processing model
 * with cancellation and queuing.
 */
export class StdioServer {
  private readline: ReadlineInterface | null = null;
  private currentRequestId: string | null = null;
  private currentEntryPoint: string | null = null;
  private cancelled = new Set<string>();
  private queue: StdioRequest[] = [];
  private processing = false;

  private symbolIndex: SymbolIndex | null = null;
  private graphBuilder: GraphBuilder;
  private serializer: GraphSerializer;
  private inferrer: EntryPointInferrer;
  private conditionTracer: ConditionTracer;

  constructor() {
    this.graphBuilder = new GraphBuilder();
    this.serializer = new GraphSerializer();
    this.inferrer = new EntryPointInferrer();
    this.conditionTracer = new ConditionTracer();
  }

  /**
   * Set the symbol index used for analysis requests.
   * Called after initial indexing or after incremental updates.
   */
  setSymbolIndex(index: SymbolIndex): void {
    this.symbolIndex = index;
  }

  /**
   * Begin listening for JSON requests on stdin.
   */
  start(): void {
    this.readline = createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.readline.on('line', (line: string) => {
      this.onLine(line);
    });

    this.readline.on('close', () => {
      this.stop();
    });
  }

  /**
   * Stop listening and close the readline interface.
   */
  stop(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: StdioRequest;
    try {
      request = JSON.parse(trimmed) as StdioRequest;
    } catch {
      // Cannot parse — send error with empty ID
      this.sendError('', 'PARSE_ERROR', 'Invalid JSON request');
      return;
    }

    if (!request.id || !request.type) {
      this.sendError(
        request.id ?? '',
        'INVALID_REQUEST',
        "Request must include 'id' and 'type' fields",
      );
      return;
    }

    void this.handleRequest(request);
  }

  private async handleRequest(request: StdioRequest): Promise<void> {
    // Handle cancel immediately
    if (request.type === 'cancel') {
      const targetId = (request.payload?.['requestId'] as string) ?? '';
      if (targetId) {
        this.cancelled.add(targetId);
      }
      this.sendResponse({
        id: request.id,
        type: 'result',
        payload: { cancelled: targetId },
      });
      return;
    }

    // Determine entry point for concurrency logic
    const entryPoint = this.getEntryPointFromRequest(request);

    // If same entry point as current, cancel the current request
    if (this.processing && entryPoint && entryPoint === this.currentEntryPoint) {
      if (this.currentRequestId) {
        this.cancelled.add(this.currentRequestId);
      }
    }

    // If different entry point and currently processing, queue it
    if (this.processing && entryPoint !== this.currentEntryPoint) {
      this.queue.push(request);
      return;
    }

    await this.processRequest(request);
    await this.drainQueue();
  }

  private async processRequest(request: StdioRequest): Promise<void> {
    this.processing = true;
    this.currentRequestId = request.id;
    this.currentEntryPoint = this.getEntryPointFromRequest(request);

    try {
      // Check if already cancelled before starting
      if (this.cancelled.has(request.id)) {
        this.cancelled.delete(request.id);
        return;
      }

      switch (request.type) {
        case 'analyze':
          await this.handleAnalyze(request);
          break;
        case 'analyze_nl':
          await this.handleAnalyzeNl(request);
          break;
        case 'search_condition':
          await this.handleSearchCondition(request);
          break;
        case 'annotate_add':
          this.sendError(request.id, 'NOT_IMPLEMENTED', 'Not implemented yet');
          break;
        case 'annotate_remove':
          this.sendError(request.id, 'NOT_IMPLEMENTED', 'Not implemented yet');
          break;
        case 'file_changed':
          await this.handleFileChanged(request);
          break;
        case 'overlay':
          await this.handleOverlay(request);
          break;
        default:
          this.sendError(request.id, 'UNKNOWN_TYPE', `Unknown request type: ${request.type}`);
          break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(request.id, 'INTERNAL_ERROR', message);
    } finally {
      this.processing = false;
      this.currentRequestId = null;
      this.currentEntryPoint = null;
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Skip if cancelled while queued
      if (this.cancelled.has(next.id)) {
        this.cancelled.delete(next.id);
        continue;
      }
      await this.processRequest(next);
    }
  }

  private async handleAnalyze(request: StdioRequest): Promise<void> {
    if (!this.symbolIndex) {
      this.sendError(request.id, 'NO_INDEX', 'Symbol index not loaded. Parse files first.');
      return;
    }

    const payload = request.payload;
    const entryPointStr = payload['entryPoint'] as string | undefined;
    if (!entryPointStr) {
      this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'entryPoint' in payload");
      return;
    }

    // Send progress: parsing entry point
    this.sendProgress(request.id, 'resolving_entry_point', 10);

    // Check cancellation
    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    // Find the entry point symbol
    const entrySymbol = this.findSymbol(entryPointStr, this.symbolIndex);
    if (!entrySymbol) {
      this.sendError(
        request.id,
        'SYMBOL_NOT_FOUND',
        `Could not find symbol matching "${entryPointStr}"`,
      );
      return;
    }

    // Send progress: building graph
    this.sendProgress(request.id, 'building_graph', 50);

    // Check cancellation
    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    const direction = (payload['direction'] as string) ?? 'downstream';
    const options: TraversalOptions = {
      maxDepth: (payload['maxDepth'] as number | undefined) ?? 20,
      maxNodes: (payload['maxNodes'] as number | undefined) ?? undefined,
      includeConditionals: (payload['includeConditionals'] as boolean) ?? true,
      includeLoops: (payload['includeLoops'] as boolean) ?? true,
      includeCallbacks: (payload['includeCallbacks'] as boolean) ?? true,
    };

    let graph: CallGraph;
    switch (direction) {
      case 'upstream':
        graph = this.graphBuilder.buildUpstream(entrySymbol, this.symbolIndex, options);
        break;
      case 'bidirectional':
        graph = this.graphBuilder.buildBidirectional(entrySymbol, this.symbolIndex, options);
        break;
      case 'downstream':
      default:
        graph = this.graphBuilder.buildDownstream(entrySymbol, this.symbolIndex, options);
        break;
    }

    // Send progress: serializing
    this.sendProgress(request.id, 'serializing', 90);

    // Check cancellation
    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    const serialized = this.serializer.serialize(graph);

    this.sendResponse({
      id: request.id,
      type: 'result',
      payload: { graph: JSON.parse(serialized) as Record<string, unknown> },
    });
  }

  private async handleFileChanged(request: StdioRequest): Promise<void> {
    const filePath = request.payload['filePath'] as string | undefined;
    if (!filePath) {
      this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'filePath' in payload");
      return;
    }

    // For now, acknowledge the file change. Full incremental re-indexing
    // requires the native addon to re-parse the changed file.
    this.sendResponse({
      id: request.id,
      type: 'result',
      payload: { acknowledged: true, filePath },
    });
  }

  private async handleAnalyzeNl(request: StdioRequest): Promise<void> {
    if (!this.symbolIndex) {
      this.sendError(request.id, 'NO_INDEX', 'Symbol index not loaded. Parse files first.');
      return;
    }

    const description = request.payload['description'] as string | undefined;
    if (!description) {
      this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'description' in payload");
      return;
    }

    this.sendProgress(request.id, 'inferring_entry_point', 10);

    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    // Infer entry points from natural language
    const candidates = this.inferrer.infer(description, this.symbolIndex);

    if (candidates.length === 0) {
      this.sendError(
        request.id,
        'NO_CANDIDATES',
        `No entry point candidates found for "${description}". Try providing an explicit function reference (file:function).`,
      );
      return;
    }

    // If multiple candidates, return them for user selection
    if (candidates.length > 1) {
      this.sendResponse({
        id: request.id,
        type: 'candidates',
        payload: {
          candidates: candidates.map((c) => ({
            symbol: {
              name: c.symbol.name,
              qualifiedName: c.symbol.qualifiedName,
              filePath: c.symbol.filePath,
              line: c.symbol.line,
            },
            score: c.score,
            reason: c.reason,
          })),
        },
      });
      return;
    }

    // Single candidate — proceed with analysis
    const entrySymbol = candidates[0].symbol;
    this.sendProgress(request.id, 'building_graph', 50);

    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    const direction = (request.payload['direction'] as string) ?? 'downstream';
    const options: TraversalOptions = {
      maxDepth: (request.payload['maxDepth'] as number | undefined) ?? 20,
      maxNodes: (request.payload['maxNodes'] as number | undefined) ?? undefined,
      includeConditionals: (request.payload['includeConditionals'] as boolean) ?? true,
      includeLoops: (request.payload['includeLoops'] as boolean) ?? true,
      includeCallbacks: (request.payload['includeCallbacks'] as boolean) ?? true,
    };

    let graph: CallGraph;
    switch (direction) {
      case 'upstream':
        graph = this.graphBuilder.buildUpstream(entrySymbol, this.symbolIndex, options);
        break;
      case 'bidirectional':
        graph = this.graphBuilder.buildBidirectional(entrySymbol, this.symbolIndex, options);
        break;
      default:
        graph = this.graphBuilder.buildDownstream(entrySymbol, this.symbolIndex, options);
        break;
    }

    this.sendProgress(request.id, 'serializing', 90);

    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    const serialized = this.serializer.serialize(graph);
    this.sendResponse({
      id: request.id,
      type: 'result',
      payload: { graph: JSON.parse(serialized) as Record<string, unknown> },
    });
  }

  private async handleSearchCondition(request: StdioRequest): Promise<void> {
    if (!this.symbolIndex) {
      this.sendError(request.id, 'NO_INDEX', 'Symbol index not loaded. Parse files first.');
      return;
    }

    const condition = request.payload['condition'] as string | undefined;
    if (!condition) {
      this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'condition' in payload");
      return;
    }

    const transitiveDepth = (request.payload['transitiveDepth'] as number) ?? 10;

    this.sendProgress(request.id, 'tracing_condition', 30);

    if (this.cancelled.has(request.id)) {
      this.cancelled.delete(request.id);
      return;
    }

    const result = this.conditionTracer.trace(condition, this.symbolIndex, transitiveDepth);

    this.sendResponse({
      id: request.id,
      type: 'result',
      payload: {
        condition,
        directMatches: result.directMatches.map((m) => ({
          nodeId: m.nodeId,
          name: m.symbolEntry.name,
          filePath: m.symbolEntry.filePath,
          line: m.line,
          matchType: m.matchType,
          snippet: m.snippet,
        })),
        transitiveMatches: result.transitiveMatches.map((m) => ({
          nodeId: m.nodeId,
          name: m.symbolEntry.name,
          filePath: m.symbolEntry.filePath,
          line: m.line,
          matchType: m.matchType,
          snippet: m.snippet,
        })),
        affectedPaths: result.affectedPaths,
      },
    });
  }

  private findSymbol(entryPointStr: string, index: SymbolIndex): SymbolEntry | undefined {
    // Try file:function format — handle Windows paths (e.g., c:\path\file.ts:functionName)
    const colonIndex = this.findFunctionSeparator(entryPointStr);
    if (colonIndex > 0) {
      const filePart = entryPointStr.slice(0, colonIndex);
      const funcName = entryPointStr.slice(colonIndex + 1);

      if (funcName) {
        // Resolve to absolute path so it matches the lazy index (which stores absolute paths)
        const absoluteFilePart = resolve(filePart);

        // Trigger lazy parsing of the file before looking up the symbol
        if (index instanceof LazySymbolIndex) {
          index.ensureFileParsed(absoluteFilePart);
          // Also try with normalized path separators
          index.ensureFileParsed(absoluteFilePart.replace(/\\/g, '/'));
        }

        const entries = index.symbols.get(funcName);
        if (entries) {
          // Normalize path comparison: case-insensitive, handle both / and \
          const normalizedFile = absoluteFilePart.replace(/\\/g, '/').toLowerCase();
          const match = entries.find((e) =>
            e.filePath.replace(/\\/g, '/').toLowerCase() === normalizedFile ||
            e.filePath.replace(/\\/g, '/').toLowerCase().endsWith(normalizedFile),
          );
          if (match) return match;
        }
      }
    }

    // Try as a plain function name
    if (index instanceof LazySymbolIndex) {
      index.ensureSymbolParsed(entryPointStr);
    }
    const entries = index.symbols.get(entryPointStr);
    if (entries && entries.length > 0) {
      return entries[0];
    }

    // Try fuzzy matching against symbol names
    const lowerInput = entryPointStr.toLowerCase();
    for (const [name, symbolEntries] of index.symbols) {
      if (name.toLowerCase().includes(lowerInput)) {
        return symbolEntries[0];
      }
    }

    return undefined;
  }

  /**
   * Find the colon that separates file path from function name.
   * Skips the colon in Windows drive letters (e.g., c:).
   */
  private findFunctionSeparator(str: string): number {
    // Search from the end for a colon that's not at position 1 (drive letter)
    for (let i = str.length - 1; i >= 0; i--) {
      if (str[i] === ':' && i !== 1) {
        return i;
      }
    }
    return -1;
  }

  private getEntryPointFromRequest(request: StdioRequest): string | null {
    if (request.type === 'analyze' || request.type === 'analyze_nl') {
      return (request.payload?.['entryPoint'] as string) ??
        (request.payload?.['description'] as string) ??
        null;
    }
    return null;
  }

  private async handleOverlay(request: StdioRequest): Promise<void> {
    if (!this.symbolIndex) {
      this.sendError(request.id, 'NO_INDEX', 'Symbol index not loaded.');
      return;
    }

    const overlayType = request.payload['type'] as string | undefined;
    if (!overlayType) {
      this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'type' in overlay payload");
      return;
    }

    this.sendProgress(request.id, `computing_${overlayType}`, 30);

    try {
      let result: Record<string, unknown>;

      switch (overlayType) {
        case 'impact': {
          const analyzer = new ChangeImpactAnalyzer();
          // Build a graph first if entryPoint is provided, otherwise use empty graph
          const graph = await this.buildGraphForOverlay(request);
          const gitDiff = request.payload['gitDiff'] as string | undefined;
          const projectRoot = request.payload['projectRoot'] as string | undefined;
          const impact = analyzer.analyze(graph, gitDiff, projectRoot);
          result = {
            modifiedNodes: impact.modifiedNodes,
            blastRadius: Object.fromEntries(impact.blastRadius),
            externalDependents: impact.externalDependents,
          };
          break;
        }
        case 'deadcode': {
          const detector = new DeadCodeDetector();
          const deadCode = detector.detect(this.symbolIndex);
          result = {
            deadFunctions: deadCode.deadFunctions.map((f) => ({
              name: f.name,
              qualifiedName: f.qualifiedName,
              filePath: f.filePath,
              line: f.line,
              kind: f.kind,
            })),
          };
          break;
        }
        case 'complexity': {
          const calculator = new ComplexityCalculator();
          const graph = await this.buildGraphForOverlay(request);
          const complexity = calculator.compute(graph, this.symbolIndex);
          result = { complexity: Object.fromEntries(complexity) };
          break;
        }
        case 'coverage': {
          const mapper = new CoverageMapper();
          const graph = await this.buildGraphForOverlay(request);
          const coveragePath = request.payload['coveragePath'] as string | undefined;
          if (!coveragePath) {
            this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'coveragePath' for coverage overlay");
            return;
          }
          const coverage = mapper.map(graph, coveragePath);
          result = { coverage: Object.fromEntries(coverage) };
          break;
        }
        case 'boundary': {
          const detector = new FeatureBoundaryDetector();
          const graph = await this.buildGraphForOverlay(request);
          const boundaries = detector.detect(graph);
          result = { boundaries };
          break;
        }
        case 'temporal': {
          const analyzer = new TemporalAnalyzer();
          const graph = await this.buildGraphForOverlay(request);
          const gitRepoPath = request.payload['projectRoot'] as string ?? process.cwd();
          const timeWindowDays = request.payload['timeWindowDays'] as number | undefined;
          const temporal = analyzer.analyze(graph, gitRepoPath, timeWindowDays ? { timeWindowDays } : undefined);
          result = { temporal: Object.fromEntries(temporal) };
          break;
        }
        case 'dataflow': {
          const tracer = new DataFlowTracer();
          const graph = await this.buildGraphForOverlay(request);
          const nodeId = request.payload['nodeId'] as string | undefined;
          const variableName = request.payload['variableName'] as string | undefined;
          if (!nodeId || !variableName) {
            this.sendError(request.id, 'INVALID_PAYLOAD', "Missing 'nodeId' or 'variableName' for dataflow overlay");
            return;
          }
          const dataFlow = tracer.trace({ nodeId, variableName }, graph, this.symbolIndex);
          result = { paths: dataFlow.paths, sinks: dataFlow.sinks };
          break;
        }
        default:
          this.sendError(request.id, 'UNKNOWN_OVERLAY', `Unknown overlay type: ${overlayType}`);
          return;
      }

      this.sendResponse({ id: request.id, type: 'result', payload: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(request.id, 'OVERLAY_ERROR', message);
    }
  }

  /**
   * Build a graph for overlay analysis from the request's entryPoint.
   * If no entryPoint is provided, returns an empty graph.
   */
  private async buildGraphForOverlay(request: StdioRequest): Promise<CallGraph> {
    const entryPointStr = request.payload['entryPoint'] as string | undefined;
    if (!entryPointStr || !this.symbolIndex) {
      return { nodes: new Map(), edges: [], entryPointId: '', metadata: { projectRoot: '', entryPoint: '', traversalDirection: 'downstream', maxDepth: null, maxNodes: null, generatedAt: new Date().toISOString(), engineVersion: '0.1.0' } };
    }

    const entrySymbol = this.findSymbol(entryPointStr, this.symbolIndex);
    if (!entrySymbol) {
      return { nodes: new Map(), edges: [], entryPointId: '', metadata: { projectRoot: '', entryPoint: entryPointStr, traversalDirection: 'downstream', maxDepth: null, maxNodes: null, generatedAt: new Date().toISOString(), engineVersion: '0.1.0' } };
    }

    return this.graphBuilder.buildDownstream(entrySymbol, this.symbolIndex, {
      includeConditionals: true,
      includeLoops: true,
      includeCallbacks: true,
    });
  }

  private sendResponse(response: StdioResponse): void {
    const json = JSON.stringify(response);
    process.stdout.write(json + '\n');
  }

  private sendError(id: string, code: string, message: string): void {
    this.sendResponse({
      id,
      type: 'error',
      payload: { code, message },
    });
  }

  private sendProgress(id: string, phase: string, percent: number): void {
    this.sendResponse({
      id,
      type: 'progress',
      payload: { phase, percent },
    });
  }
}
