import { describe, it, expect } from 'vitest';
import { GraphSerializer } from './graph-serializer.js';
import type { CallGraph, Edge, GraphMetadata, GraphNode } from '../types.js';

/**
 * Helper to create a minimal GraphNode for testing.
 */
function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'src/app.ts:10:main',
    name: 'main',
    qualifiedName: 'main',
    kind: 'function',
    filePath: 'src/app.ts',
    line: 10,
    column: 0,
    signature: 'function main(): void',
    body: '',
    metadata: {
      visibility: 'public',
      isDepthLimited: false,
      isUnresolved: false,
      isCycleParticipant: false,
    },
    ...overrides,
  };
}

/**
 * Helper to create a minimal CallGraph for testing.
 */
function makeGraph(overrides: Partial<CallGraph> = {}): CallGraph {
  const entryNode = makeNode();
  const nodes = new Map<string, GraphNode>();
  nodes.set(entryNode.id, entryNode);

  const metadata: GraphMetadata = {
    projectRoot: '/project',
    entryPoint: 'main',
    traversalDirection: 'downstream',
    maxDepth: 5,
    generatedAt: '2024-01-01T00:00:00.000Z',
    engineVersion: '0.1.0',
  };

  return {
    nodes,
    edges: [],
    entryPointId: entryNode.id,
    metadata,
    ...overrides,
  };
}

describe('GraphSerializer', () => {
  const serializer = new GraphSerializer();

  describe('serialize', () => {
    it('should serialize an empty graph (single entry node, no edges)', () => {
      const graph = makeGraph();
      const json = serializer.serialize(graph);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.metadata).toEqual(graph.metadata);
      expect(parsed.nodes).toHaveLength(1);
      expect(parsed.edges).toHaveLength(0);
      expect(parsed.overlays).toEqual({});
    });

    it('should serialize nodes as an array', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'foo' });
      const nodeB = makeNode({ id: 'b.ts:2:bar', name: 'bar', qualifiedName: 'bar' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const graph = makeGraph({ nodes, entryPointId: nodeA.id });
      const json = serializer.serialize(graph);
      const parsed = JSON.parse(json);

      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.nodes[0].id).toBe('a.ts:1:foo');
      expect(parsed.nodes[1].id).toBe('b.ts:2:bar');
    });

    it('should serialize edges with all metadata', () => {
      const edge: Edge = {
        sourceId: 'a.ts:1:foo',
        targetId: 'b.ts:2:bar',
        kind: 'call',
        metadata: { custom: 'value' },
      };
      const graph = makeGraph({ edges: [edge] });
      const json = serializer.serialize(graph);
      const parsed = JSON.parse(json);

      expect(parsed.edges).toHaveLength(1);
      expect(parsed.edges[0]).toEqual(edge);
    });

    it('should produce 2-space indented JSON', () => {
      const graph = makeGraph();
      const json = serializer.serialize(graph);
      // Check indentation: second line should start with 2 spaces
      const lines = json.split('\n');
      expect(lines[1]).toMatch(/^ {2}"/);
    });
  });

  describe('deserialize', () => {
    it('should round-trip serialize → deserialize producing equivalent graph', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'Module.foo' });
      const nodeB = makeNode({ id: 'b.ts:2:bar', name: 'bar', qualifiedName: 'bar' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
      ];

      const metadata: GraphMetadata = {
        projectRoot: '/project',
        entryPoint: 'Module.foo',
        traversalDirection: 'downstream',
        maxDepth: 3,
        generatedAt: '2024-06-15T12:00:00.000Z',
        engineVersion: '0.1.0',
      };

      const original: CallGraph = {
        nodes,
        edges,
        entryPointId: nodeA.id,
        metadata,
      };

      const json = serializer.serialize(original);
      const restored = serializer.deserialize(json);

      // Nodes should be equivalent
      expect(restored.nodes.size).toBe(original.nodes.size);
      for (const [id, node] of original.nodes) {
        expect(restored.nodes.get(id)).toEqual(node);
      }

      // Edges should be equivalent
      expect(restored.edges).toEqual(original.edges);

      // Metadata should be equivalent
      expect(restored.metadata).toEqual(original.metadata);

      // Entry point should be resolved
      expect(restored.entryPointId).toBe(original.entryPointId);
    });

    it('should throw on malformed JSON', () => {
      expect(() => serializer.deserialize('not json {')).toThrow(
        /Invalid CallGraph JSON: malformed JSON/,
      );
    });

    it('should throw when root is not an object', () => {
      expect(() => serializer.deserialize('"just a string"')).toThrow(
        /expected a JSON object at root/,
      );
    });

    it("should throw when 'version' field is missing", () => {
      const json = JSON.stringify({ metadata: {}, nodes: [], edges: [] });
      expect(() => serializer.deserialize(json)).toThrow(
        /missing required field 'version'/,
      );
    });

    it("should throw when 'metadata' field is missing", () => {
      const json = JSON.stringify({ version: '1.0.0', nodes: [], edges: [] });
      expect(() => serializer.deserialize(json)).toThrow(
        /missing required field 'metadata'/,
      );
    });

    it("should throw when 'nodes' field is missing", () => {
      const json = JSON.stringify({ version: '1.0.0', metadata: {}, edges: [] });
      expect(() => serializer.deserialize(json)).toThrow(
        /missing required field 'nodes'/,
      );
    });

    it("should throw when 'edges' field is missing", () => {
      const json = JSON.stringify({ version: '1.0.0', metadata: {}, nodes: [] });
      expect(() => serializer.deserialize(json)).toThrow(
        /missing required field 'edges'/,
      );
    });

    it("should throw when 'nodes' is not an array", () => {
      const json = JSON.stringify({
        version: '1.0.0',
        metadata: { entryPoint: 'x' },
        nodes: 'not-array',
        edges: [],
      });
      expect(() => serializer.deserialize(json)).toThrow(
        /'nodes' must be an array/,
      );
    });

    it('should handle empty graph (no nodes)', () => {
      const json = JSON.stringify({
        version: '1.0.0',
        metadata: {
          projectRoot: '/p',
          entryPoint: 'main',
          traversalDirection: 'downstream',
          maxDepth: null,
          generatedAt: '2024-01-01T00:00:00.000Z',
          engineVersion: '0.1.0',
        },
        nodes: [],
        edges: [],
        overlays: {},
      });

      const graph = serializer.deserialize(json);
      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toHaveLength(0);
      expect(graph.entryPointId).toBe('');
    });
  });

  describe('toMermaid', () => {
    it('should use graph LR for downstream traversal', () => {
      const graph = makeGraph();
      const mermaid = serializer.toMermaid(graph);
      expect(mermaid).toMatch(/^graph LR/);
    });

    it('should use graph RL for upstream traversal', () => {
      const metadata: GraphMetadata = {
        projectRoot: '/p',
        entryPoint: 'main',
        traversalDirection: 'upstream',
        maxDepth: null,
        generatedAt: '2024-01-01T00:00:00.000Z',
        engineVersion: '0.1.0',
      };
      const graph = makeGraph({ metadata });
      const mermaid = serializer.toMermaid(graph);
      expect(mermaid).toMatch(/^graph RL/);
    });

    it('should generate node definitions with labels', () => {
      const graph = makeGraph();
      const mermaid = serializer.toMermaid(graph);
      // Should contain the node with its label
      expect(mermaid).toContain('main');
      expect(mermaid).toContain('app.ts:11');
    });

    it('should generate correct edge syntax for call edges', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo' });
      const nodeB = makeNode({ id: 'b.ts:2:bar', name: 'bar' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const mermaid = serializer.toMermaid(graph);
      expect(mermaid).toContain('-->|call|');
    });

    it('should generate dotted arrows for conditional_flow edges', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo' });
      const nodeB = makeNode({ id: 'b.ts:2:bar', name: 'bar' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'conditional_flow', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const mermaid = serializer.toMermaid(graph);
      expect(mermaid).toContain('-.->|conditional|');
    });

    it('should generate thick arrows for callback edges', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo' });
      const nodeB = makeNode({ id: 'b.ts:2:bar', name: 'bar' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'callback', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const mermaid = serializer.toMermaid(graph);
      expect(mermaid).toContain('==>|callback|');
    });

    it('should generate cross arrows for cycle_back_edge', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo' });
      const nodeB = makeNode({ id: 'b.ts:2:bar', name: 'bar' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'cycle_back_edge', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const mermaid = serializer.toMermaid(graph);
      expect(mermaid).toContain('--x|cycle|');
    });

    it('should escape quotes in node labels', () => {
      const node = makeNode({ id: 'a.ts:1:say"hi"', name: 'say"hi"' });
      const nodes = new Map<string, GraphNode>();
      nodes.set(node.id, node);

      const graph = makeGraph({ nodes, entryPointId: node.id });
      const mermaid = serializer.toMermaid(graph);
      // Should not contain raw quotes inside the label
      expect(mermaid).not.toMatch(/\["[^"]*"[^"]*"\]/);
    });
  });

  describe('toTextTree', () => {
    it('should return empty string for empty graph', () => {
      const graph = makeGraph({
        nodes: new Map(),
        edges: [],
        entryPointId: 'nonexistent',
      });
      const tree = serializer.toTextTree(graph);
      expect(tree).toBe('');
    });

    it('should render a single-node tree', () => {
      const graph = makeGraph();
      const tree = serializer.toTextTree(graph);
      expect(tree).toContain('main');
      expect(tree).toContain('app.ts:11');
      expect(tree).toContain('[function]');
    });

    it('should render parent-child relationships with box-drawing chars', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'foo' });
      const nodeB = makeNode({
        id: 'b.ts:2:bar',
        name: 'bar',
        qualifiedName: 'bar',
        filePath: 'b.ts',
        line: 2,
      });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const tree = serializer.toTextTree(graph);

      expect(tree).toContain('foo');
      expect(tree).toContain('└── bar');
    });

    it('should mark cycles with ⟲ symbol', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'foo' });
      const nodeB = makeNode({
        id: 'b.ts:2:bar',
        name: 'bar',
        qualifiedName: 'bar',
        filePath: 'b.ts',
        line: 2,
      });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
        { sourceId: nodeB.id, targetId: nodeA.id, kind: 'cycle_back_edge', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const tree = serializer.toTextTree(graph);

      expect(tree).toContain('⟲ foo [cycle]');
    });

    it('should mark unresolved nodes with ? prefix', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'foo' });
      const nodeB = makeNode({
        id: 'b.ts:2:unknown',
        name: 'unknown',
        qualifiedName: 'unknown',
        kind: 'unresolved',
        filePath: 'b.ts',
        line: 2,
        metadata: {
          visibility: 'default',
          isDepthLimited: false,
          isUnresolved: true,
          isCycleParticipant: false,
        },
      });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const tree = serializer.toTextTree(graph);

      expect(tree).toContain('? unknown [unresolved]');
    });

    it('should mark depth-limited nodes with ... suffix', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'foo' });
      const nodeB = makeNode({
        id: 'b.ts:2:bar',
        name: 'bar',
        qualifiedName: 'bar',
        filePath: 'b.ts',
        line: 2,
        metadata: {
          visibility: 'public',
          isDepthLimited: true,
          isUnresolved: false,
          isCycleParticipant: false,
        },
      });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const tree = serializer.toTextTree(graph);

      expect(tree).toContain('bar (b.ts:3) [function] ...');
    });

    it('should use ├── for non-last siblings and └── for last', () => {
      const nodeA = makeNode({ id: 'a.ts:1:foo', name: 'foo', qualifiedName: 'foo' });
      const nodeB = makeNode({
        id: 'b.ts:2:bar',
        name: 'bar',
        qualifiedName: 'bar',
        filePath: 'b.ts',
        line: 2,
      });
      const nodeC = makeNode({
        id: 'c.ts:3:baz',
        name: 'baz',
        qualifiedName: 'baz',
        filePath: 'c.ts',
        line: 3,
      });
      const nodes = new Map<string, GraphNode>();
      nodes.set(nodeA.id, nodeA);
      nodes.set(nodeB.id, nodeB);
      nodes.set(nodeC.id, nodeC);

      const edges: Edge[] = [
        { sourceId: nodeA.id, targetId: nodeB.id, kind: 'call', metadata: {} },
        { sourceId: nodeA.id, targetId: nodeC.id, kind: 'call', metadata: {} },
      ];

      const graph = makeGraph({ nodes, edges, entryPointId: nodeA.id });
      const tree = serializer.toTextTree(graph);

      expect(tree).toContain('├── bar');
      expect(tree).toContain('└── baz');
    });
  });
});
