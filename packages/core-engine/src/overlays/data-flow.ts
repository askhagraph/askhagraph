/**
 * @module overlays/data-flow
 * Traces data flow from a source variable through the call graph,
 * detecting known sinks for security-relevant flow analysis.
 */

import type { CallGraph, SymbolIndex } from '../types.js';

/** A data flow source: a node and variable to trace from. */
export interface DataFlowSource {
  /** ID of the graph node where the variable originates. */
  nodeId: string;
  /** Name of the variable to trace. */
  variableName: string;
}

/** A path through the call graph carrying traced data. */
export interface DataFlowPath {
  /** Ordered list of node IDs in the path. */
  nodeIds: string[];
  /** Variable name at each step (may change through assignments). */
  variableNames: string[];
}

/** A detected sink where traced data reaches a security-sensitive operation. */
export interface SinkDetection {
  /** ID of the graph node containing the sink. */
  nodeId: string;
  /** Classification of the sink. */
  sinkType:
    | 'database_query'
    | 'http_response'
    | 'file_write'
    | 'command_execution'
    | 'logging';
  /** Variable name carrying the traced data at the sink. */
  variableName: string;
}

/** Result of a data flow trace. */
export interface DataFlowResult {
  /** All paths from the source through the call graph. */
  paths: DataFlowPath[];
  /** Detected sinks where traced data reaches security-sensitive operations. */
  sinks: SinkDetection[];
}

/** Sink detection patterns: callee name substrings mapped to sink types. */
const SINK_PATTERNS: Array<{
  type: SinkDetection['sinkType'];
  patterns: string[];
}> = [
  {
    type: 'database_query',
    patterns: ['query', 'execute', 'sql', 'find', 'save', 'insert', 'update', 'delete'],
  },
  {
    type: 'http_response',
    patterns: ['send', 'json', 'write', 'render', 'redirect', 'res.'],
  },
  {
    type: 'file_write',
    patterns: ['writeFile', 'appendFile', 'createWriteStream'],
  },
  {
    type: 'command_execution',
    patterns: ['exec', 'spawn', 'execSync'],
  },
  {
    type: 'logging',
    patterns: ['log', 'warn', 'error', 'debug', 'info', 'console.'],
  },
];

/**
 * Traces data flow from a source variable through the call graph,
 * following call edges downstream and detecting known sinks.
 */
export class DataFlowTracer {
  /**
   * Trace data flow from a source through the call graph.
   *
   * @param source - The source node and variable to trace.
   * @param graph - The call graph to traverse.
   * @param index - The symbol index for resolving call site arguments.
   * @returns Data flow result with paths and sink detections.
   */
  trace(
    source: DataFlowSource,
    graph: CallGraph,
    index: SymbolIndex,
  ): DataFlowResult {
    const paths: DataFlowPath[] = [];
    const sinks: SinkDetection[] = [];

    if (graph.nodes.size === 0 || !graph.nodes.has(source.nodeId)) {
      return { paths, sinks };
    }

    // Build forward adjacency list: source → [{ targetId, calleeName }]
    const forwardAdj = this.buildForwardAdjacency(graph);

    // DFS from the source node, tracking variable propagation
    const visited = new Set<string>();
    this.dfs(
      source.nodeId,
      source.variableName,
      [source.nodeId],
      [source.variableName],
      forwardAdj,
      graph,
      index,
      visited,
      paths,
      sinks,
    );

    return { paths, sinks };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Build a forward adjacency list from the call graph edges.
   */
  private buildForwardAdjacency(
    graph: CallGraph,
  ): Map<string, Array<{ targetId: string }>> {
    const adj = new Map<string, Array<{ targetId: string }>>();

    for (const edge of graph.edges) {
      const targets = adj.get(edge.sourceId);
      const entry = { targetId: edge.targetId };
      if (targets) {
        targets.push(entry);
      } else {
        adj.set(edge.sourceId, [entry]);
      }
    }

    return adj;
  }

  /**
   * Depth-first traversal following data flow through call edges.
   */
  private dfs(
    currentNodeId: string,
    currentVarName: string,
    pathNodeIds: string[],
    pathVarNames: string[],
    forwardAdj: Map<string, Array<{ targetId: string }>>,
    graph: CallGraph,
    index: SymbolIndex,
    visited: Set<string>,
    paths: DataFlowPath[],
    sinks: SinkDetection[],
  ): void {
    // Check for sinks at the current node
    const currentNode = graph.nodes.get(currentNodeId);
    if (currentNode) {
      const sinkType = this.detectSink(currentNode.name, currentNode.qualifiedName);
      if (sinkType) {
        sinks.push({
          nodeId: currentNodeId,
          sinkType,
          variableName: currentVarName,
        });
      }
    }

    // Prevent cycles
    const visitKey = `${currentNodeId}:${currentVarName}`;
    if (visited.has(visitKey)) {
      // Record the path up to this point even if we hit a cycle
      if (pathNodeIds.length > 1) {
        paths.push({
          nodeIds: [...pathNodeIds],
          variableNames: [...pathVarNames],
        });
      }
      return;
    }
    visited.add(visitKey);

    const neighbors = forwardAdj.get(currentNodeId);
    if (!neighbors || neighbors.length === 0) {
      // Leaf node — record the path
      if (pathNodeIds.length > 1) {
        paths.push({
          nodeIds: [...pathNodeIds],
          variableNames: [...pathVarNames],
        });
      }
      return;
    }

    let hasDataFlowChild = false;

    for (const { targetId } of neighbors) {
      if (!graph.nodes.has(targetId)) {
        continue;
      }

      // Check if the variable propagates to this callee
      const propagatedVarName = this.resolveVariablePropagation(
        currentNodeId,
        targetId,
        currentVarName,
        graph,
        index,
      );

      if (propagatedVarName) {
        hasDataFlowChild = true;
        this.dfs(
          targetId,
          propagatedVarName,
          [...pathNodeIds, targetId],
          [...pathVarNames, propagatedVarName],
          forwardAdj,
          graph,
          index,
          visited,
          paths,
          sinks,
        );
      }
    }

    // If no children carried the data flow, record the path ending here
    if (!hasDataFlowChild && pathNodeIds.length > 1) {
      paths.push({
        nodeIds: [...pathNodeIds],
        variableNames: [...pathVarNames],
      });
    }
  }

  /**
   * Determine if a variable propagates from a caller to a callee.
   *
   * Checks if the variable name appears in the call site arguments
   * from the caller to the callee. If found, returns the corresponding
   * parameter name or the same variable name.
   */
  private resolveVariablePropagation(
    sourceNodeId: string,
    targetNodeId: string,
    variableName: string,
    graph: CallGraph,
    index: SymbolIndex,
  ): string | null {
    const sourceNode = graph.nodes.get(sourceNodeId);
    const targetNode = graph.nodes.get(targetNodeId);

    if (!sourceNode || !targetNode) {
      return null;
    }

    // Look up call sites in the source file that reference the target
    const callSites = index.callSites.get(sourceNode.filePath);
    if (!callSites) {
      // If no call site info, assume the variable propagates with the same name
      return variableName;
    }

    // Find call sites from the source that call the target
    for (const callSite of callSites) {
      if (
        callSite.calleeName === targetNode.name ||
        callSite.calleeName === targetNode.qualifiedName
      ) {
        // Check if the variable appears in the call arguments
        if (callSite.arguments) {
          for (const arg of callSite.arguments) {
            if (arg.includes(variableName)) {
              // The variable is passed as an argument — it propagates
              return variableName;
            }
          }
        } else {
          // No argument info available — assume propagation
          return variableName;
        }
      }
    }

    // No evidence of variable propagation through call arguments
    return null;
  }

  /**
   * Detect if a node name matches a known sink pattern.
   */
  private detectSink(
    name: string,
    qualifiedName: string,
  ): SinkDetection['sinkType'] | null {
    const lowerName = name.toLowerCase();
    const lowerQualified = qualifiedName.toLowerCase();

    for (const { type, patterns } of SINK_PATTERNS) {
      for (const pattern of patterns) {
        const lowerPattern = pattern.toLowerCase();
        if (
          lowerName.includes(lowerPattern) ||
          lowerQualified.includes(lowerPattern)
        ) {
          return type;
        }
      }
    }

    return null;
  }
}
