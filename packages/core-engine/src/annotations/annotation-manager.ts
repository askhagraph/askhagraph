/**
 * @module annotations/annotation-manager
 * Manages persistence and retrieval of node annotations in a
 * version-control-friendly sidecar file.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CallGraph } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A user annotation attached to a graph node. */
export interface Annotation {
  /** Unique annotation identifier. */
  id: string;
  /** References GraphNode.id (e.g., "src/checkout.ts:42:processOrder"). */
  nodeId: string;
  /** Annotation text content. */
  text: string;
  /** Author of the annotation (IDE user name). */
  author: string;
  /** ISO 8601 timestamp of when the annotation was created. */
  timestamp: string;
}

/** On-disk format for the annotations sidecar file. */
interface AnnotationFile {
  version: '1.0.0';
  annotations: Annotation[];
}

const SIDECAR_DIR = '.askhagraph';
const ANNOTATIONS_FILE = 'annotations.json';

/**
 * Annotation manager that persists and retrieves node annotations
 * in a version-control-friendly JSON sidecar file.
 */
export class AnnotationManager {
  /** Load annotations for a project. Returns empty array if file missing/malformed. */
  load(projectRoot: string): Annotation[] {
    const filePath = join(projectRoot, SIDECAR_DIR, ANNOTATIONS_FILE);
    if (!existsSync(filePath)) return [];

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!this.isValid(parsed)) return [];
      return parsed.annotations;
    } catch {
      return [];
    }
  }

  /** Add an annotation. Persists to sidecar file. */
  add(projectRoot: string, annotation: Annotation): void {
    const annotations = this.load(projectRoot);
    annotations.push(annotation);
    this.save(projectRoot, annotations);
  }

  /** Remove an annotation by ID. */
  remove(projectRoot: string, annotationId: string): void {
    const annotations = this.load(projectRoot);
    this.save(projectRoot, annotations.filter((a) => a.id !== annotationId));
  }

  /** Find orphaned annotations whose nodeId no longer exists in the graph. */
  findOrphans(annotations: Annotation[], graph: CallGraph): Annotation[] {
    return annotations.filter((a) => !graph.nodes.has(a.nodeId));
  }

  private save(projectRoot: string, annotations: Annotation[]): void {
    const dir = join(projectRoot, SIDECAR_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const file: AnnotationFile = {
      version: '1.0.0',
      annotations: annotations.map((a) => ({
        id: a.id, nodeId: a.nodeId, text: a.text, author: a.author, timestamp: a.timestamp,
      })),
    };

    writeFileSync(
      join(dir, ANNOTATIONS_FILE),
      JSON.stringify(file, ['version', 'annotations', 'id', 'nodeId', 'text', 'author', 'timestamp'], 2),
      'utf-8',
    );
  }

  private isValid(value: unknown): value is AnnotationFile {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (obj.version !== '1.0.0' || !Array.isArray(obj.annotations)) return false;
    return obj.annotations.every(
      (item: unknown) =>
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).nodeId === 'string' &&
        typeof (item as Record<string, unknown>).text === 'string',
    );
  }
}
