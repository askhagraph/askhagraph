/**
 * @module types
 * Internal types for the AskhaGraph Graph Viewer.
 */

// ─── Graph Data Types (from serialized JSON) ─────────────────────────────────

/** Node kind classification matching core-engine types. */
export type NodeKind =
  | 'function'
  | 'method'
  | 'conditional'
  | 'loop'
  | 'callback'
  | 'unresolved';

/** Edge kind classification matching core-engine types. */
export type EdgeKind =
  | 'call'
  | 'conditional_flow'
  | 'callback'
  | 'cycle_back_edge'
  | 'depth_limited';

/** A node in the serialized call graph JSON. */
export interface SerializedNode {
  id: string;
  name: string;
  qualifiedName: string;
  kind: NodeKind;
  filePath: string;
  line: number;
  column: number;
  signature: string;
  body: string;
  metadata: SerializedNodeMetadata;
}

/** Metadata attached to a serialized node. */
export interface SerializedNodeMetadata {
  visibility: 'public' | 'private' | 'protected' | 'default';
  isDepthLimited: boolean;
  isUnresolved: boolean;
  isCycleParticipant: boolean;
  cyclomaticComplexity?: number;
  coverage?: number;
  churn?: number;
  annotations?: string[];
  dataFlow?: Record<string, unknown>;
  featureBoundary?: string;
}

/** A directed edge in the serialized call graph JSON. */
export interface SerializedEdge {
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  metadata: Record<string, unknown>;
}

/** The serialized call graph JSON format produced by GraphSerializer. */
export interface SerializedCallGraph {
  version: string;
  metadata: SerializedGraphMetadata;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  overlays: Record<string, unknown>;
}

/** Metadata about how the graph was generated. */
export interface SerializedGraphMetadata {
  projectRoot: string;
  entryPoint: string;
  traversalDirection: 'downstream' | 'upstream' | 'bidirectional';
  maxDepth: number | null;
  generatedAt: string;
  engineVersion: string;
  partialIndex?: boolean;
}

// ─── IDE Messaging Types ─────────────────────────────────────────────────────

/** Message types sent from the Graph Viewer to the IDE host. */
export type MessageType =
  | 'navigate'
  | 'askAi'
  | 'addAnnotation'
  | 'expandNode'
  | 'collapseNode';

/** Base message structure for IDE communication. */
export interface ViewerMessage {
  type: MessageType;
  payload: Record<string, unknown>;
}

/** Navigate to a source file at a specific line. */
export interface NavigateMessage extends ViewerMessage {
  type: 'navigate';
  payload: {
    filePath: string;
    line: number;
    column: number;
  };
}

/** Request AI analysis of a node. */
export interface AskAiMessage extends ViewerMessage {
  type: 'askAi';
  payload: {
    nodeId: string;
    name: string;
    qualifiedName: string;
    filePath: string;
    line: number;
  };
}

/** Request to add an annotation to a node. */
export interface AddAnnotationMessage extends ViewerMessage {
  type: 'addAnnotation';
  payload: {
    nodeId: string;
    name: string;
  };
}

/** Notify IDE that a node was expanded. */
export interface ExpandNodeMessage extends ViewerMessage {
  type: 'expandNode';
  payload: {
    nodeId: string;
  };
}

/** Notify IDE that a node was collapsed. */
export interface CollapseNodeMessage extends ViewerMessage {
  type: 'collapseNode';
  payload: {
    nodeId: string;
  };
}

// ─── Event Types ─────────────────────────────────────────────────────────────

/** Events emitted by the graph renderer. */
export type GraphEventType =
  | 'nodeSelected'
  | 'nodeExpanded'
  | 'nodeCollapsed'
  | 'viewChanged';

/** Event payload for node selection. */
export interface NodeSelectedEvent {
  type: 'nodeSelected';
  nodeId: string;
  node: SerializedNode;
}

/** Event payload for node expansion. */
export interface NodeExpandedEvent {
  type: 'nodeExpanded';
  nodeId: string;
}

/** Event payload for node collapse. */
export interface NodeCollapsedEvent {
  type: 'nodeCollapsed';
  nodeId: string;
}

/** Event payload for view change (graph/list toggle). */
export interface ViewChangedEvent {
  type: 'viewChanged';
  view: 'graph' | 'list';
}

export type GraphEvent =
  | NodeSelectedEvent
  | NodeExpandedEvent
  | NodeCollapsedEvent
  | ViewChangedEvent;

/** Listener function for graph events. */
export type GraphEventListener = (event: GraphEvent) => void;

// ─── View State Types ────────────────────────────────────────────────────────

/** Current view mode. */
export type ViewMode = 'graph' | 'list';

/** Filter preset identifiers. */
export type FilterPreset =
  | 'all'
  | 'functions'
  | 'conditionals'
  | 'by-file'
  | 'uncovered'
  | 'high-complexity'
  | 'dead-code'
  | 'hide-library';

/** Context menu item definition. */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  action: (nodeId: string) => void;
}
