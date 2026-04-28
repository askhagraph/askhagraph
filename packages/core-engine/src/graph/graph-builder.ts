/**
 * @module graph/graph-builder
 * Constructs directed call graphs from entry points using the symbol index.
 */

import type {
  CallGraph,
  CallSite,
  ConditionalNode,
  Edge,
  GraphMetadata,
  GraphNode,
  NodeKind,
  SymbolEntry,
  SymbolIndex,
  TraversalOptions,
} from '../types.js';
import type { IGraphBuilder } from '../interfaces.js';
import { ENGINE_VERSION } from '../constants.js';
import { LazySymbolIndex } from '../lazy-index.js';

/**
 * Builds directed call graphs by traversing the symbol index.
 *
 * Supports downstream (callees), upstream (callers), and bidirectional traversal
 * with cycle detection and depth limiting.
 */
export class GraphBuilder implements IGraphBuilder {
  /**
   * Build a downstream call graph from an entry point.
   * Follows all call sites from the entry point's body range using DFS.
   */
  buildDownstream(
    entryPoint: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
  ): CallGraph {
    const nodes = new Map<string, GraphNode>();
    const edges: Edge[] = [];
    const entryNode = this.symbolToGraphNode(entryPoint);
    const entryPointId = entryNode.id;

    nodes.set(entryPointId, entryNode);

    const traversalStack = new Set<string>();
    this.traverseDownstream(entryNode, index, options, nodes, edges, traversalStack, 0);

    // Prune conditional nodes that don't lead anywhere
    const pruned = this.pruneDeadEndConditionals(nodes, edges);

    const metadata: GraphMetadata = {
      projectRoot: '',
      entryPoint: entryPoint.qualifiedName || entryPoint.name,
      traversalDirection: 'downstream',
      maxDepth: options.maxDepth ?? null,
      maxNodes: options.maxNodes ?? GraphBuilder.DEFAULT_MAX_NODES,
      truncated: this.isNodeCapReached(pruned.nodes, options),
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
    };

    return { nodes: pruned.nodes, edges: pruned.edges, entryPointId, metadata };
  }

  /**
   * Build an upstream caller graph to a target.
   * Finds all call sites that resolve to the target and traverses callers recursively.
   */
  buildUpstream(
    target: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
  ): CallGraph {
    const nodes = new Map<string, GraphNode>();
    const edges: Edge[] = [];
    const targetNode = this.symbolToGraphNode(target);
    const entryPointId = targetNode.id;

    nodes.set(entryPointId, targetNode);

    const traversalStack = new Set<string>();
    this.traverseUpstream(targetNode, target, index, options, nodes, edges, traversalStack, 0);

    // Prune conditional nodes that don't lead anywhere
    const pruned = this.pruneDeadEndConditionals(nodes, edges);

    const metadata: GraphMetadata = {
      projectRoot: '',
      entryPoint: target.qualifiedName || target.name,
      traversalDirection: 'upstream',
      maxDepth: options.maxDepth ?? null,
      maxNodes: options.maxNodes ?? GraphBuilder.DEFAULT_MAX_NODES,
      truncated: this.isNodeCapReached(pruned.nodes, options),
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
    };

    return { nodes: pruned.nodes, edges: pruned.edges, entryPointId, metadata };
  }

  /**
   * Build a bidirectional graph combining upstream and downstream from a target.
   */
  buildBidirectional(
    target: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
  ): CallGraph {
    const downstream = this.buildDownstream(target, index, options);
    const upstream = this.buildUpstream(target, index, options);

    // Merge nodes (dedup by ID)
    const mergedNodes = new Map<string, GraphNode>();
    for (const [id, node] of downstream.nodes) {
      mergedNodes.set(id, node);
    }
    for (const [id, node] of upstream.nodes) {
      if (!mergedNodes.has(id)) {
        mergedNodes.set(id, node);
      }
    }

    // Merge edges (dedup by sourceId+targetId+kind)
    const edgeKeys = new Set<string>();
    const mergedEdges: Edge[] = [];

    for (const edge of downstream.edges) {
      const key = `${edge.sourceId}|${edge.targetId}|${edge.kind}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        mergedEdges.push(edge);
      }
    }
    for (const edge of upstream.edges) {
      const key = `${edge.sourceId}|${edge.targetId}|${edge.kind}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        mergedEdges.push(edge);
      }
    }

    const entryPointId = this.createNodeId(target);

    // Prune conditional nodes that don't lead anywhere
    const pruned = this.pruneDeadEndConditionals(mergedNodes, mergedEdges);

    const metadata: GraphMetadata = {
      projectRoot: '',
      entryPoint: target.qualifiedName || target.name,
      traversalDirection: 'bidirectional',
      maxDepth: options.maxDepth ?? null,
      maxNodes: options.maxNodes ?? GraphBuilder.DEFAULT_MAX_NODES,
      truncated: this.isNodeCapReached(pruned.nodes, options),
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
    };

    return { nodes: pruned.nodes, edges: pruned.edges, entryPointId, metadata };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Create a unique node ID from a symbol entry.
   */
  private createNodeId(symbol: SymbolEntry): string {
    return `${symbol.filePath}:${symbol.line}:${symbol.name}`;
  }

  /**
   * Convert a SymbolEntry to a GraphNode with default metadata.
   */
  private symbolToGraphNode(symbol: SymbolEntry): GraphNode {
    const kind: NodeKind = symbol.kind === 'function' || symbol.kind === 'method'
      ? symbol.kind
      : 'function';

    return {
      id: this.createNodeId(symbol),
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind,
      filePath: symbol.filePath,
      line: symbol.line,
      column: symbol.column,
      signature: symbol.signature,
      body: '', // Lazy loading — populated during serialization
      metadata: {
        visibility: symbol.visibility,
        isDepthLimited: false,
        isUnresolved: false,
        isCycleParticipant: false,
      },
    };
  }

  /**
   * Create an unresolved graph node for a call site that couldn't be resolved.
   */
  private createUnresolvedNode(callSite: CallSite): GraphNode {
    const id = `${callSite.filePath}:${callSite.line}:${callSite.calleeName}`;
    return {
      id,
      name: callSite.calleeName,
      qualifiedName: callSite.calleeName,
      kind: 'unresolved',
      filePath: callSite.filePath,
      line: callSite.line,
      column: callSite.nameColumn ?? callSite.column,
      signature: '',
      body: '',
      metadata: {
        visibility: 'default',
        isDepthLimited: false,
        isUnresolved: true,
        isCycleParticipant: false,
      },
    };
  }

  /**
   * Get all call sites within a function's body range from the index.
   */
  private getCallSitesInRange(
    filePath: string,
    startLine: number,
    endLine: number,
    index: SymbolIndex,
  ): CallSite[] {
    // Trigger lazy parsing if needed
    if (index instanceof LazySymbolIndex) {
      index.ensureFileParsed(filePath);
    }
    const fileCallSites = index.callSites.get(filePath);
    if (!fileCallSites) {
      return [];
    }
    return fileCallSites.filter(
      (cs) => cs.line >= startLine && cs.line <= endLine,
    );
  }

  /**
   * Get all conditional nodes within a function's body range from the index.
   */
  private getConditionalsInRange(
    filePath: string,
    startLine: number,
    endLine: number,
    index: SymbolIndex,
  ): ConditionalNode[] {
    // Trigger lazy parsing if needed
    if (index instanceof LazySymbolIndex) {
      index.ensureFileParsed(filePath);
    }
    const fileConditionals = index.conditionals.get(filePath);
    if (!fileConditionals) {
      return [];
    }
    return fileConditionals.filter(
      (c) => c.line >= startLine && c.line <= endLine,
    );
  }

  /**
   * Resolve a call site name to a SymbolEntry in the index.
   * Returns undefined if the symbol cannot be resolved.
   */
  private resolveCallSite(
    callSite: CallSite,
    index: SymbolIndex,
  ): SymbolEntry | undefined {
    let calleeName = callSite.calleeName;

    // For lazy index: ensure the file containing the call site is parsed
    // (so we have its imports for resolution), then try to find the symbol
    if (index instanceof LazySymbolIndex) {
      index.ensureFileParsed(callSite.filePath);
    }

    // Try direct lookup first
    let entries = index.symbols.get(calleeName);

    // For lazy index: if not found, try resolving via the file's imports first
    // (fast — only parses the specific imported file), then fall back to search
    // only for simple function names as a last resort.
    if (!entries && index instanceof LazySymbolIndex) {
      index.ensureSymbolFromImports(calleeName, callSite.filePath);
      entries = index.symbols.get(calleeName);

      // If still not found and it's a simple name, do a bounded search
      if (!entries && !calleeName.includes('.')) {
        index.ensureSymbolParsed(calleeName);
        entries = index.symbols.get(calleeName);
      }
    }
    if (entries && entries.length > 0) {
      const sameFile = entries.find((e) => e.filePath === callSite.filePath);
      return sameFile ?? entries[0];
    }

    // Strip `this.` prefix and try again (common in TS/JS class methods)
    if (calleeName.startsWith('this.')) {
      calleeName = calleeName.slice(5);
      entries = index.symbols.get(calleeName);
      if (!entries && index instanceof LazySymbolIndex) {
        index.ensureSymbolFromImports(calleeName, callSite.filePath);
        entries = index.symbols.get(calleeName);
      }
      if (entries && entries.length > 0) {
        const sameFile = entries.find((e) => e.filePath === callSite.filePath);
        return sameFile ?? entries[0];
      }
    }

    // Strip object prefix for member expressions (e.g., "obj.method" → "method")
    const dotIdx = calleeName.lastIndexOf('.');
    if (dotIdx > 0) {
      const receiverName = calleeName.slice(0, dotIdx);
      const methodName = calleeName.slice(dotIdx + 1);

      // For chained calls (e.g., "cy.elements().remove") — too ambiguous
      const isChainedCall = receiverName.includes('.');
      if (isChainedCall) {
        return undefined;
      }

      // Ensure the method name is in the index (may trigger lazy parsing)
      entries = index.symbols.get(methodName);
      if (!entries && index instanceof LazySymbolIndex) {
        index.ensureSymbolFromImports(methodName, callSite.filePath);
        entries = index.symbols.get(methodName);
      }

      if (entries && entries.length > 0) {
        // Strategy 1: Check if the receiver is a known project class/type by name.
        // e.g., receiver "graphBuilder" → check "graphBuilder" and "GraphBuilder"
        const receiverIsKnown =
          index.symbols.has(receiverName) ||
          index.symbols.has(receiverName.charAt(0).toUpperCase() + receiverName.slice(1));
        if (receiverIsKnown) {
          const sameFile = entries.find((e) => e.filePath === callSite.filePath);
          return sameFile ?? entries[0];
        }

        // Strategy 2: Check if the method is defined in a file that the calling
        // file imports. This handles the common pattern where a local variable
        // holds an instance of an imported class (e.g., `const svc = getService();
        // svc.doThing()` — the variable name doesn't match the class name, but
        // `doThing` is defined in the imported file).
        const callerImports = index.imports.get(callSite.filePath);
        if (callerImports) {
          const importedFilePaths = new Set<string>();
          // Build set of file paths that the calling file imports from.
          // Match import sources against method definition file paths.
          for (const imp of callerImports) {
            for (const entry of entries) {
              // Check if this method's file matches an import source.
              // The import source is a module specifier (e.g., '../lib/checkout/CheckoutService')
              // and the entry's filePath is absolute. Match by checking if the
              // absolute path ends with the import source (minus extension).
              const normalizedSource = imp.source.replace(/\\/g, '/');
              const normalizedEntryPath = entry.filePath.replace(/\\/g, '/');
              if (
                normalizedEntryPath.includes(normalizedSource) ||
                normalizedEntryPath.includes(normalizedSource.replace(/^\.\.?\/?/, ''))
              ) {
                importedFilePaths.add(entry.filePath);
              }
            }
          }

          // If any method definition lives in an imported file, resolve to it
          const fromImportedFile = entries.find((e) => importedFilePaths.has(e.filePath));
          if (fromImportedFile) {
            return fromImportedFile;
          }
        }

        // Strategy 3: Same-file method — the method is defined in the same file
        // as the call site (common for class methods calling other methods via
        // a local reference)
        const sameFile = entries.find((e) => e.filePath === callSite.filePath);
        if (sameFile) {
          return sameFile;
        }

        // Receiver not in index and method not from an imported file →
        // likely a library object or unrelated local variable, treat as unresolved
      }
    }

    return undefined;
  }

  /** Default maximum number of nodes before traversal stops expanding. */
  private static readonly DEFAULT_MAX_NODES = 500;

  /**
   * Check if the node cap has been reached.
   * When the cap is hit, no new nodes should be expanded — remaining
   * frontier nodes are marked as depth-limited.
   */
  private isNodeCapReached(nodes: Map<string, GraphNode>, options: TraversalOptions): boolean {
    const maxNodes = options.maxNodes ?? GraphBuilder.DEFAULT_MAX_NODES;
    return nodes.size >= maxNodes;
  }

  /**
   * DFS downstream traversal: follow call sites from a node's body range.
   *
   * Uses a `fullyVisited` set to avoid re-traversing subtrees that were
   * already explored via a different call path (diamond-shaped graphs).
   */
  private traverseDownstream(
    currentNode: GraphNode,
    index: SymbolIndex,
    options: TraversalOptions,
    nodes: Map<string, GraphNode>,
    edges: Edge[],
    traversalStack: Set<string>,
    depth: number,
    fullyVisited?: Set<string>,
  ): void {
    // Initialize fullyVisited on first call (entry point)
    if (!fullyVisited) {
      fullyVisited = new Set<string>();
    }

    traversalStack.add(currentNode.id);

    // Check depth limit
    if (options.maxDepth !== undefined && depth >= options.maxDepth) {
      currentNode.metadata.isDepthLimited = true;
      traversalStack.delete(currentNode.id);
      fullyVisited.add(currentNode.id);
      return;
    }

    // Check node cap — stop expanding if we've hit the limit
    if (this.isNodeCapReached(nodes, options)) {
      currentNode.metadata.isDepthLimited = true;
      traversalStack.delete(currentNode.id);
      fullyVisited.add(currentNode.id);
      return;
    }

    // Find the symbol entry for the current node to get body range
    // Trigger lazy parsing of the node's file if needed
    if (index instanceof LazySymbolIndex) {
      index.ensureFileParsed(currentNode.filePath);
    }
    const symbolEntries = index.symbols.get(currentNode.name);
    const symbol = symbolEntries?.find(
      (s) => s.filePath === currentNode.filePath && s.line === currentNode.line,
    );

    if (!symbol) {
      traversalStack.delete(currentNode.id);
      fullyVisited.add(currentNode.id);
      return;
    }

    const { startLine, endLine } = symbol.bodyRange;

    // Get conditionals first (needed for routing call sites through them)
    const conditionals = options.includeConditionals
      ? this.getConditionalsInRange(currentNode.filePath, startLine, endLine, index)
      : [];

    // Create conditional nodes first so call sites can be routed through them
    const conditionalNodes = new Map<string, { id: string; startLine: number; endLine: number; branches: number }>();
    if (options.includeConditionals) {
      for (const conditional of conditionals) {
        const condLabel = conditional.conditionText
          ? `${conditional.kind} (${conditional.conditionText})`
          : conditional.kind;
        const condId = `${conditional.filePath}:${conditional.line}:${conditional.kind}`;
        if (!nodes.has(condId)) {
          nodes.set(condId, {
            id: condId,
            name: condLabel,
            qualifiedName: `${currentNode.qualifiedName}.${condLabel}`,
            kind: 'conditional',
            filePath: conditional.filePath,
            line: conditional.line,
            column: conditional.column,
            signature: conditional.conditionText ?? '',
            body: '',
            metadata: {
              visibility: 'default',
              isDepthLimited: false,
              isUnresolved: false,
              isCycleParticipant: false,
            },
          });
        }
        edges.push({
          sourceId: currentNode.id,
          targetId: condId,
          kind: 'conditional_flow',
          metadata: { branches: conditional.branches },
        });
        conditionalNodes.set(condId, {
          id: condId,
          startLine: conditional.line,
          endLine: conditional.endLine,
          branches: conditional.branches,
        });
      }

      // No need to refine end lines — they come directly from tree-sitter's
      // node.end_position(), giving us the exact closing brace line for each
      // conditional across all supported languages.
    }

    // Process call sites — route through conditional nodes when applicable
    const callSites = this.getCallSitesInRange(currentNode.filePath, startLine, endLine, index);

    for (const callSite of callSites) {
      // Re-check node cap before processing each call site
      if (this.isNodeCapReached(nodes, options)) {
        break;
      }

      const resolved = this.resolveCallSite(callSite, index);

      // Determine the source node: only route through a conditional if:
      // 1. The call site line is within the conditional's range
      // 2. The conditional has more than 1 branch (not a guard clause)
      let sourceId = currentNode.id;
      if (options.includeConditionals) {
        for (const cond of conditionalNodes.values()) {
          // Skip single-branch conditionals (guard clauses like `if (!x) throw`)
          if (cond.branches <= 1) continue;

          if (callSite.line >= cond.startLine && callSite.line <= cond.endLine) {
            sourceId = cond.id;
            break;
          }
        }
      }

      if (resolved) {
        const calleeNode = this.symbolToGraphNode(resolved);
        const calleeId = calleeNode.id;

        // Cycle detection — node is on the current DFS path
        if (traversalStack.has(calleeId)) {
          if (!nodes.has(calleeId)) {
            nodes.set(calleeId, calleeNode);
          }
          nodes.get(calleeId)!.metadata.isCycleParticipant = true;
          currentNode.metadata.isCycleParticipant = true;
          edges.push({
            sourceId,
            targetId: calleeId,
            kind: 'cycle_back_edge',
            metadata: {},
          });
          continue;
        }

        if (!nodes.has(calleeId)) {
          nodes.set(calleeId, calleeNode);
        }

        edges.push({
          sourceId,
          targetId: calleeId,
          kind: 'call',
          metadata: {},
        });

        // Skip subtree if this node was already fully traversed via another path.
        // This prevents exponential re-traversal in diamond-shaped call graphs.
        if (fullyVisited.has(calleeId)) {
          continue;
        }

        // Recurse into callee if not already depth-limited
        if (!nodes.get(calleeId)!.metadata.isDepthLimited) {
          this.traverseDownstream(
            nodes.get(calleeId)!,
            index,
            options,
            nodes,
            edges,
            traversalStack,
            depth + 1,
            fullyVisited,
          );
        }
      } else {
        // Unresolved call site
        const unresolvedNode = this.createUnresolvedNode(callSite);
        if (!nodes.has(unresolvedNode.id)) {
          nodes.set(unresolvedNode.id, unresolvedNode);
        }
        edges.push({
          sourceId,
          targetId: unresolvedNode.id,
          kind: 'call',
          metadata: {},
        });
      }
    }

    traversalStack.delete(currentNode.id);
    fullyVisited.add(currentNode.id);
  }

  /**
   * Reverse traversal: find all callers of a target symbol.
   *
   * Uses a `fullyVisited` set to avoid re-traversing callers that were
   * already explored via a different call path.
   */
  private traverseUpstream(
    targetNode: GraphNode,
    targetSymbol: SymbolEntry,
    index: SymbolIndex,
    options: TraversalOptions,
    nodes: Map<string, GraphNode>,
    edges: Edge[],
    traversalStack: Set<string>,
    depth: number,
    fullyVisited?: Set<string>,
  ): void {
    // Initialize fullyVisited on first call (entry point)
    if (!fullyVisited) {
      fullyVisited = new Set<string>();
    }

    traversalStack.add(targetNode.id);

    // Check depth limit
    if (options.maxDepth !== undefined && depth >= options.maxDepth) {
      targetNode.metadata.isDepthLimited = true;
      traversalStack.delete(targetNode.id);
      fullyVisited.add(targetNode.id);
      return;
    }

    // Check node cap
    if (this.isNodeCapReached(nodes, options)) {
      targetNode.metadata.isDepthLimited = true;
      traversalStack.delete(targetNode.id);
      fullyVisited.add(targetNode.id);
      return;
    }

    // Find all call sites across all files that reference the target symbol's name
    const callers = this.findCallers(targetSymbol, index);

    for (const { callerSymbol, callSite: _callSite } of callers) {
      // Re-check node cap before processing each caller
      if (this.isNodeCapReached(nodes, options)) {
        break;
      }

      const callerNode = this.symbolToGraphNode(callerSymbol);
      const callerId = callerNode.id;

      // Cycle detection
      if (traversalStack.has(callerId)) {
        if (!nodes.has(callerId)) {
          nodes.set(callerId, callerNode);
        }
        nodes.get(callerId)!.metadata.isCycleParticipant = true;
        targetNode.metadata.isCycleParticipant = true;
        edges.push({
          sourceId: callerId,
          targetId: targetNode.id,
          kind: 'cycle_back_edge',
          metadata: {},
        });
        continue;
      }

      if (!nodes.has(callerId)) {
        nodes.set(callerId, callerNode);
      }

      edges.push({
        sourceId: callerId,
        targetId: targetNode.id,
        kind: 'call',
        metadata: {},
      });

      // Skip if this caller was already fully traversed via another path
      if (fullyVisited.has(callerId)) {
        continue;
      }

      // Recurse to find callers of the caller
      this.traverseUpstream(
        nodes.get(callerId)!,
        callerSymbol,
        index,
        options,
        nodes,
        edges,
        traversalStack,
        depth + 1,
        fullyVisited,
      );
    }

    traversalStack.delete(targetNode.id);
    fullyVisited.add(targetNode.id);
  }

  /**
   * Find all symbols that contain a call site referencing the target symbol.
   */
  private findCallers(
    targetSymbol: SymbolEntry,
    index: SymbolIndex,
  ): Array<{ callerSymbol: SymbolEntry; callSite: CallSite }> {
    const results: Array<{ callerSymbol: SymbolEntry; callSite: CallSite }> = [];

    for (const [filePath, callSites] of index.callSites) {
      // Find call sites that reference the target's name
      const matchingCallSites = callSites.filter(
        (cs) => cs.calleeName === targetSymbol.name,
      );

      for (const callSite of matchingCallSites) {
        // Find the enclosing symbol for this call site
        const enclosingSymbol = this.findEnclosingSymbol(filePath, callSite.line, index);
        if (enclosingSymbol) {
          // Avoid self-references unless it's actually a recursive call
          const enclosingId = this.createNodeId(enclosingSymbol);
          const targetId = this.createNodeId(targetSymbol);
          if (enclosingId !== targetId) {
            results.push({ callerSymbol: enclosingSymbol, callSite });
          }
        }
      }
    }

    return results;
  }

  /**
   * Find the symbol whose body range contains the given line in the given file.
   */
  private findEnclosingSymbol(
    filePath: string,
    line: number,
    index: SymbolIndex,
  ): SymbolEntry | undefined {
    // Search all symbols for one that encloses this line
    for (const entries of index.symbols.values()) {
      for (const entry of entries) {
        if (
          entry.filePath === filePath &&
          line >= entry.bodyRange.startLine &&
          line <= entry.bodyRange.endLine
        ) {
          return entry;
        }
      }
    }
    return undefined;
  }

  /**
   * Remove conditional nodes that have no outgoing edges (dead-end conditionals).
   * These are conditions that don't lead to any further calls, so they add
   * visual noise without providing useful information.
   *
   * Runs iteratively since removing a conditional may leave its parent
   * conditional as a new dead end.
   */
  private pruneDeadEndConditionals(
    nodes: Map<string, GraphNode>,
    edges: Edge[],
  ): { nodes: Map<string, GraphNode>; edges: Edge[] } {
    let changed = true;
    while (changed) {
      changed = false;

      // Build outgoing edge map for conditionals
      const conditionalOutgoing = new Map<string, string[]>();
      for (const edge of edges) {
        const sourceNode = nodes.get(edge.sourceId);
        if (sourceNode && sourceNode.kind === 'conditional') {
          const targets = conditionalOutgoing.get(edge.sourceId) || [];
          targets.push(edge.targetId);
          conditionalOutgoing.set(edge.sourceId, targets);
        }
      }

      const toRemove = new Set<string>();
      for (const [id, node] of nodes) {
        if (node.kind !== 'conditional') continue;

        const targets = conditionalOutgoing.get(id);
        // Prune if no outgoing edges
        if (!targets || targets.length === 0) {
          toRemove.add(id);
          continue;
        }

        // Prune if all outgoing edges lead to unresolved nodes only
        const allTargetsUnresolved = targets.every((targetId) => {
          const targetNode = nodes.get(targetId);
          return targetNode && targetNode.metadata.isUnresolved;
        });
        if (allTargetsUnresolved) {
          toRemove.add(id);
        }
      }

      if (toRemove.size > 0) {
        changed = true;
        for (const id of toRemove) {
          nodes.delete(id);
        }
        // Remove edges pointing to or from pruned nodes
        edges = edges.filter((e) => !toRemove.has(e.targetId) && !toRemove.has(e.sourceId));
      }
    }

    return { nodes, edges };
  }
}
