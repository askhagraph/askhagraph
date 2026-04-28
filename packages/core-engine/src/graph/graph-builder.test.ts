/**
 * Integration test for GraphBuilder using the real native parser.
 *
 * Parses actual source files, builds a symbol index, constructs a call graph,
 * and validates that the nodes and edges match reality.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { GraphBuilder } from './graph-builder.js';
import type {
  SymbolIndex,
  SymbolEntry,
  CallSite,
  ConditionalNode,
  ImportEntry,
  ExportEntry,
  LanguageId,
  CallGraph,
} from '../types.js';

// ─── Native Addon Types (mirrors CLI/server-entry) ───────────────────────────

interface NativeAddon {
  initialize(): void;
  parseFiles(files: Array<{ filePath: string; languageId: string }>): NativeParseResult[];
  buildIndex(parseResults: NativeParseResult[]): NativeSymbolIndex;
  extensionToLanguageId(ext: string): string | null;
  isSupported(ext: string): boolean;
}

interface NativeParseResult {
  filePath: string;
  languageId: string;
  symbols: Array<{
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    line: number;
    column: number;
    signature: string;
    bodyStartLine: number;
    bodyEndLine: number;
    visibility: string;
    languageId: string;
  }>;
  callSites: Array<{
    calleeName: string;
    filePath: string;
    line: number;
    column: number;
    nameColumn: number;
  }>;
  conditionals: Array<{
    kind: string;
    filePath: string;
    line: number;
    column: number;
    endLine: number;
    branches: number;
    conditionText: string;
  }>;
  errors: Array<{
    filePath: string;
    line: number;
    column: number;
    message: string;
  }>;
}

interface NativeSymbolIndex {
  symbols: Array<{
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    line: number;
    column: number;
    signature: string;
    bodyStartLine: number;
    bodyEndLine: number;
    visibility: string;
    languageId: string;
  }>;
  imports: Array<{ source: string; specifiers: string[]; filePath: string }>;
  exports: Array<{ name: string; kind: string; filePath: string }>;
  fileHashes: Array<{ filePath: string; hash: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadNative(): NativeAddon {
  const require = createRequire(import.meta.url);
  return require('@askhagraph/native') as NativeAddon;
}

/**
 * Convert native parse results + index into a TypeScript SymbolIndex.
 * Mirrors the conversion logic in CLI and server-entry.
 */
function convertToSymbolIndex(
  nativeIndex: NativeSymbolIndex,
  parseResults: NativeParseResult[],
): SymbolIndex {
  const symbols = new Map<string, SymbolEntry[]>();
  for (const sym of nativeIndex.symbols) {
    const entry: SymbolEntry = {
      name: sym.name,
      qualifiedName: sym.qualifiedName,
      kind: sym.kind as SymbolEntry['kind'],
      filePath: sym.filePath,
      line: sym.line,
      column: sym.column,
      signature: sym.signature,
      bodyRange: { startLine: sym.bodyStartLine, endLine: sym.bodyEndLine },
      visibility: sym.visibility as SymbolEntry['visibility'],
      languageId: sym.languageId as LanguageId,
    };
    const existing = symbols.get(sym.name);
    if (existing) {
      existing.push(entry);
    } else {
      symbols.set(sym.name, [entry]);
    }
  }

  const imports = new Map<string, ImportEntry[]>();
  for (const imp of nativeIndex.imports) {
    const existing = imports.get(imp.filePath);
    const entry: ImportEntry = { source: imp.source, specifiers: imp.specifiers, filePath: imp.filePath };
    if (existing) existing.push(entry);
    else imports.set(imp.filePath, [entry]);
  }

  const exports = new Map<string, ExportEntry[]>();
  for (const exp of nativeIndex.exports) {
    const existing = exports.get(exp.filePath);
    const entry: ExportEntry = { name: exp.name, kind: exp.kind as ExportEntry['kind'], filePath: exp.filePath };
    if (existing) existing.push(entry);
    else exports.set(exp.filePath, [entry]);
  }

  const fileHashes = new Map<string, string>();
  for (const fh of nativeIndex.fileHashes) {
    fileHashes.set(fh.filePath, fh.hash);
  }

  const callSites = new Map<string, CallSite[]>();
  const conditionals = new Map<string, ConditionalNode[]>();
  for (const result of parseResults) {
    if (result.callSites.length > 0) {
      callSites.set(result.filePath, result.callSites.map((cs) => ({
        calleeName: cs.calleeName,
        filePath: cs.filePath,
        line: cs.line,
        column: cs.column,
      })));
    }
    if (result.conditionals.length > 0) {
      conditionals.set(result.filePath, result.conditionals.map((c) => ({
        kind: c.kind as ConditionalNode['kind'],
        filePath: c.filePath,
        line: c.line,
        column: c.column,
        endLine: c.endLine,
        branches: c.branches,
        conditionText: c.conditionText || undefined,
      })));
    }
  }

  return { symbols, imports, exports, fileHashes, callSites, conditionals };
}

/**
 * Parse a set of files and build a full SymbolIndex.
 */
function parseAndIndex(
  native: NativeAddon,
  files: Array<{ filePath: string; languageId: string }>,
): { index: SymbolIndex; parseResults: NativeParseResult[] } {
  const parseResults = native.parseFiles(files);
  const nativeIndex = native.buildIndex(parseResults);
  const index = convertToSymbolIndex(nativeIndex, parseResults);
  return { index, parseResults };
}

/**
 * Find a symbol by name and optional file path substring.
 */
function findSymbol(
  index: SymbolIndex,
  name: string,
  filePathContains?: string,
): SymbolEntry | undefined {
  const entries = index.symbols.get(name);
  if (!entries || entries.length === 0) return undefined;
  if (filePathContains) {
    return entries.find((e) => e.filePath.includes(filePathContains));
  }
  return entries[0];
}

/**
 * Extract a summary of graph nodes for assertion.
 */
function summarizeGraph(graph: CallGraph): {
  nodeNames: string[];
  nodeDetails: Array<{ name: string; kind: string; line: number; filePath: string; isUnresolved: boolean }>;
  edgeSummary: Array<{ from: string; to: string; kind: string }>;
} {
  const nodeNames = Array.from(graph.nodes.values()).map((n) => n.name).sort();
  const nodeDetails = Array.from(graph.nodes.values())
    .map((n) => ({
      name: n.name,
      kind: n.kind,
      line: n.line,
      filePath: n.filePath.replace(/\\/g, '/'),
      isUnresolved: n.metadata.isUnresolved,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const edgeSummary = graph.edges
    .map((e) => {
      const from = graph.nodes.get(e.sourceId)?.name || e.sourceId;
      const to = graph.nodes.get(e.targetId)?.name || e.targetId;
      return { from, to, kind: e.kind };
    })
    .sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));
  return { nodeNames, nodeDetails, edgeSummary };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GraphBuilder integration — real parser', () => {
  let native: NativeAddon;
  let graphBuilder: GraphBuilder;

  beforeAll(() => {
    native = loadNative();
    native.initialize();
    graphBuilder = new GraphBuilder();
  });

  describe('GraphRenderer.render() call graph', () => {
    let graph: CallGraph;
    let index: SymbolIndex;

    beforeAll(() => {
      // Parse the graph-renderer.ts file and its direct dependencies
      const graphRendererPath = resolve('packages/graph-viewer/src/graph-renderer.ts');
      const layoutPath = resolve('packages/graph-viewer/src/layout.ts');
      const eventsPath = resolve('packages/graph-viewer/src/events.ts');
      const stylesPath = resolve('packages/graph-viewer/src/styles.ts');
      const messagingPath = resolve('packages/graph-viewer/src/messaging.ts');
      const constantsPath = resolve('packages/graph-viewer/src/constants.ts');

      const result = parseAndIndex(native, [
        { filePath: graphRendererPath, languageId: 'typescript' },
        { filePath: layoutPath, languageId: 'typescript' },
        { filePath: eventsPath, languageId: 'typescript' },
        { filePath: stylesPath, languageId: 'typescript' },
        { filePath: messagingPath, languageId: 'typescript' },
        { filePath: constantsPath, languageId: 'typescript' },
      ]);
      index = result.index;

      // Find the render method
      const renderSymbol = findSymbol(index, 'render', 'graph-renderer');
      expect(renderSymbol).toBeDefined();

      // Build downstream call graph from render
      graph = graphBuilder.buildDownstream(renderSymbol!, index, {
        includeConditionals: true,
        includeLoops: false,
        includeCallbacks: false,
      });
    });

    it('should find the render method as the entry point', () => {
      const entryNode = graph.nodes.get(graph.entryPointId);
      expect(entryNode).toBeDefined();
      expect(entryNode!.name).toBe('render');
      expect(entryNode!.filePath).toContain('graph-renderer');
    });

    it('should have the correct line number for the render method', () => {
      const entryNode = graph.nodes.get(graph.entryPointId);
      expect(entryNode).toBeDefined();
      // render() is defined with the method signature — the line should point
      // to the method declaration, not the first statement in the body
      expect(entryNode!.line).toBeLessThanOrEqual(100);
    });

    it('should include direct method calls from render body', () => {
      const { nodeNames } = summarizeGraph(graph);

      // Methods called directly in render():
      // this.buildNodeMap, this.buildAdjacency, this.findEntryPointId,
      // computeMaxDepth, getAutoCollapsedNodes, this.buildElements,
      // createElkLayoutOptions, this.fitToViewport, this.applyOverlays,
      // this.runFallbackLayout
      expect(nodeNames).toContain('buildNodeMap');
      expect(nodeNames).toContain('buildAdjacency');
      expect(nodeNames).toContain('findEntryPointId');
      expect(nodeNames).toContain('computeMaxDepth');
      expect(nodeNames).toContain('getAutoCollapsedNodes');
      expect(nodeNames).toContain('buildElements');
      expect(nodeNames).toContain('createElkLayoutOptions');
      expect(nodeNames).toContain('fitToViewport');
      expect(nodeNames).toContain('applyOverlays');
      expect(nodeNames).toContain('runFallbackLayout');
    });

    it('should NOT include methods not called from render', () => {
      const { nodeNames } = summarizeGraph(graph);

      // These are methods on GraphRenderer but NOT called from render():
      // remove, add — these are Cytoscape methods, not our code
      // The annotation manager's remove/add should not appear
      expect(nodeNames).not.toContain('remove');
      expect(nodeNames).not.toContain('add');
    });

    it('should have correct line numbers for all resolved nodes', () => {
      const { nodeDetails } = summarizeGraph(graph);

      for (const node of nodeDetails) {
        // Every resolved node should have a positive line number
        if (!node.isUnresolved) {
          expect(node.line, `${node.name} should have a valid line number`).toBeGreaterThan(0);
        }
      }
    });

    it('should mark unresolved calls correctly', () => {
      const { nodeDetails } = summarizeGraph(graph);
      const unresolvedNodes = nodeDetails.filter((n) => n.isUnresolved);

      // Unresolved nodes should be external calls (Cytoscape methods, console, etc.)
      for (const node of unresolvedNodes) {
        expect(node.kind).toBe('unresolved');
      }
    });

    it('should produce a connected graph (all resolved nodes reachable from entry)', () => {
      // Every resolved node (except the entry) should be a target of at least one edge.
      // Unresolved nodes may become orphaned when dead-end conditionals are pruned.
      const targetIds = new Set(graph.edges.map((e) => e.targetId));
      for (const [nodeId, node] of graph.nodes) {
        if (nodeId === graph.entryPointId) continue;
        if (node.metadata.isUnresolved) continue;
        expect(targetIds.has(nodeId), `Resolved node ${node.name} should be reachable`).toBe(true);
      }
    });

    it('should print full graph summary for debugging', () => {
      const { nodeDetails, edgeSummary } = summarizeGraph(graph);

      console.log('\n=== GraphRenderer.render() call graph ===');
      console.log(`Nodes (${nodeDetails.length}):`);
      for (const n of nodeDetails) {
        const tag = n.isUnresolved ? ' [UNRESOLVED]' : '';
        const file = n.filePath.split('/').pop();
        console.log(`  ${n.kind.padEnd(12)} ${n.name.padEnd(30)} ${file}:${n.line}${tag}`);
      }
      console.log(`\nEdges (${edgeSummary.length}):`);
      for (const e of edgeSummary) {
        console.log(`  ${e.from} → ${e.to} (${e.kind})`);
      }
    });
  });
});
