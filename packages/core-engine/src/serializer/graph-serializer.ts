/**
 * @module serializer/graph-serializer
 * Converts call graphs to and from various output formats (JSON, Mermaid, text tree).
 */

import type { CallGraph, Edge, GraphMetadata, GraphNode } from '../types.js';
import type { IGraphSerializer } from '../interfaces.js';

/** JSON schema version for serialized call graphs. */
const SCHEMA_VERSION = '1.0.0';

/**
 * Serializes and deserializes call graphs to JSON, Mermaid, and text tree formats.
 */
export class GraphSerializer implements IGraphSerializer {
  /**
   * Serialize a call graph to a JSON string.
   * Converts the internal Map-based node storage to a plain array for portability.
   */
  serialize(graph: CallGraph): string {
    const output = {
      version: SCHEMA_VERSION,
      metadata: graph.metadata,
      nodes: Array.from(graph.nodes.values()),
      edges: graph.edges,
      overlays: {},
    };
    return JSON.stringify(output, null, 2);
  }

  /**
   * Deserialize a JSON string back into a CallGraph.
   * Validates required fields and reconstructs the Map-based node storage.
   */
  deserialize(json: string): CallGraph {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid CallGraph JSON: malformed JSON — ${message}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid CallGraph JSON: expected a JSON object at root');
    }

    const obj = parsed as Record<string, unknown>;

    if (!('version' in obj)) {
      throw new Error("Invalid CallGraph JSON: missing required field 'version'");
    }
    if (!('metadata' in obj)) {
      throw new Error("Invalid CallGraph JSON: missing required field 'metadata'");
    }
    if (!('nodes' in obj)) {
      throw new Error("Invalid CallGraph JSON: missing required field 'nodes'");
    }
    if (!('edges' in obj)) {
      throw new Error("Invalid CallGraph JSON: missing required field 'edges'");
    }

    const nodesArray = obj.nodes as GraphNode[];
    const edges = obj.edges as Edge[];
    const metadata = obj.metadata as GraphMetadata;

    if (!Array.isArray(nodesArray)) {
      throw new Error("Invalid CallGraph JSON: 'nodes' must be an array");
    }
    if (!Array.isArray(edges)) {
      throw new Error("Invalid CallGraph JSON: 'edges' must be an array");
    }

    const nodes = new Map<string, GraphNode>();
    for (const node of nodesArray) {
      nodes.set(node.id, node);
    }

    // Determine entryPointId from metadata.entryPoint and the nodes
    let entryPointId = '';
    for (const [id, node] of nodes) {
      const qualifiedMatch = node.qualifiedName === metadata.entryPoint;
      const nameMatch = node.name === metadata.entryPoint;
      if (qualifiedMatch || nameMatch) {
        entryPointId = id;
        break;
      }
    }

    // Fallback: use the first node if no match found
    if (!entryPointId && nodes.size > 0) {
      entryPointId = nodes.keys().next().value!;
    }

    return { nodes, edges, entryPointId, metadata };
  }

  /**
   * Convert a call graph to Mermaid diagram syntax.
   * Uses left-to-right layout for downstream, right-to-left for upstream.
   */
  toMermaid(graph: CallGraph): string {
    const direction =
      graph.metadata.traversalDirection === 'upstream' ? 'RL' : 'LR';
    const lines: string[] = [`graph ${direction}`];

    // Emit node definitions
    for (const [_id, node] of graph.nodes) {
      const safeId = this.toMermaidId(node.id);
      const label = this.toMermaidLabel(node);
      lines.push(`  ${safeId}["${label}"]`);
    }

    // Emit edges
    for (const edge of graph.edges) {
      const sourceId = this.toMermaidId(edge.sourceId);
      const targetId = this.toMermaidId(edge.targetId);
      const edgeSyntax = this.getMermaidEdgeSyntax(edge);
      lines.push(`  ${edgeSyntax(sourceId, targetId)}`);
    }

    return lines.join('\n');
  }

  /**
   * Convert a call graph to an indented text tree representation.
   * Uses an iterative approach to avoid stack overflow on deep graphs.
   */
  toTextTree(graph: CallGraph): string {
    if (graph.nodes.size === 0) {
      return '';
    }

    const entryNode = graph.nodes.get(graph.entryPointId);
    if (!entryNode) {
      return '';
    }

    // Build adjacency list from edges (source → targets)
    const adjacency = new Map<string, Edge[]>();
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.sourceId)) {
        adjacency.set(edge.sourceId, []);
      }
      adjacency.get(edge.sourceId)!.push(edge);
    }

    const lines: string[] = [];
    const visited = new Set<string>();

    // Iterative DFS using a stack
    interface StackEntry {
      nodeId: string;
      prefix: string;
      isLast: boolean;
      edge: Edge | null;
      isRoot: boolean;
    }

    const stack: StackEntry[] = [
      { nodeId: graph.entryPointId, prefix: '', isLast: true, edge: null, isRoot: true },
    ];

    while (stack.length > 0) {
      const { nodeId, prefix, isLast, edge, isRoot } = stack.pop()!;
      const node = graph.nodes.get(nodeId);
      if (!node) continue;

      // Build the line for this node
      const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
      const nodeLabel = this.toTreeLabel(node, edge);

      // Handle cycles
      if (visited.has(nodeId) && !isRoot) {
        lines.push(`${prefix}${connector}⟲ ${node.name} [cycle]`);
        continue;
      }

      lines.push(`${prefix}${connector}${nodeLabel}`);

      // Mark depth-limited nodes
      if (node.metadata.isDepthLimited) {
        continue;
      }

      visited.add(nodeId);

      // Get children edges
      const childEdges = adjacency.get(nodeId) || [];
      const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

      // Push children in reverse order so they come out in correct order from stack
      for (let i = childEdges.length - 1; i >= 0; i--) {
        const childEdge = childEdges[i];
        const childIsLast = i === childEdges.length - 1;
        stack.push({
          nodeId: childEdge.targetId,
          prefix: childPrefix,
          isLast: childIsLast,
          edge: childEdge,
          isRoot: false,
        });
      }
    }

    return lines.join('\n');
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Convert a node ID to a valid Mermaid identifier (alphanumeric + underscores).
   */
  private toMermaidId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  /**
   * Create a Mermaid node label from a GraphNode.
   * Shows function name and file:line, with length limiting.
   */
  private toMermaidLabel(node: GraphNode): string {
    const name = this.escapeForMermaid(this.truncate(node.name, 40));
    const fileName = node.filePath.split('/').pop() || node.filePath;
    const location = `${this.escapeForMermaid(this.truncate(fileName, 30))}:${node.line + 1}`;
    return `${name}<br/>${location}`;
  }

  /**
   * Escape characters that are special in Mermaid labels.
   */
  private escapeForMermaid(text: string): string {
    return text.replace(/"/g, '#quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Truncate a string to a maximum length, appending "..." if truncated.
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Get the Mermaid edge syntax function for a given edge kind.
   */
  private getMermaidEdgeSyntax(
    edge: Edge,
  ): (source: string, target: string) => string {
    switch (edge.kind) {
      case 'call':
        return (s, t) => `${s} -->|call| ${t}`;
      case 'conditional_flow':
        return (s, t) => `${s} -.->|conditional| ${t}`;
      case 'callback':
        return (s, t) => `${s} ==>|callback| ${t}`;
      case 'cycle_back_edge':
        return (s, t) => `${s} --x|cycle| ${t}`;
      case 'depth_limited':
        return (s, t) => `${s} -->|...| ${t}`;
      default:
        return (s, t) => `${s} --> ${t}`;
    }
  }

  /**
   * Create a text tree label for a node.
   */
  private toTreeLabel(node: GraphNode, edge: Edge | null): string {
    if (node.metadata.isUnresolved) {
      return `? ${node.name} [unresolved]`;
    }

    const fileName = node.filePath.split('/').pop() || node.filePath;
    const location = `${fileName}:${node.line + 1}`;
    let kindLabel = node.kind as string;

    // Add branch count for conditionals
    if (node.kind === 'conditional' && edge?.metadata?.['branches']) {
      kindLabel = `${kindLabel}, ${edge.metadata['branches']} branches`;
    }

    let suffix = '';
    if (node.metadata.isDepthLimited) {
      suffix = ' ...';
    }

    return `${node.name} (${location}) [${kindLabel}]${suffix}`;
  }
}
