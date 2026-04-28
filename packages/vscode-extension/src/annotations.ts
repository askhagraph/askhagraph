/**
 * @module annotations
 * Lightweight annotation persistence for the VS Code extension.
 * Reads/writes .askhagraph/annotations.json without depending on core-engine.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Annotation {
  id: string;
  nodeId: string;
  text: string;
  author: string;
  timestamp: string;
}

interface AnnotationFile {
  version: '1.0.0';
  annotations: Annotation[];
}

const SIDECAR_DIR = '.askhagraph';
const ANNOTATIONS_FILE = 'annotations.json';

/** Load annotations from the project's sidecar file. */
export function loadAnnotations(projectRoot: string): Annotation[] {
  const filePath = join(projectRoot, SIDECAR_DIR, ANNOTATIONS_FILE);
  if (!existsSync(filePath)) return [];

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AnnotationFile;
    if (parsed.version !== '1.0.0' || !Array.isArray(parsed.annotations)) return [];
    return parsed.annotations;
  } catch {
    return [];
  }
}

/** Add an annotation and persist to the sidecar file. */
export function addAnnotation(projectRoot: string, annotation: Annotation): void {
  const annotations = loadAnnotations(projectRoot);
  annotations.push(annotation);
  saveAnnotations(projectRoot, annotations);
}

/** Set (add or replace) the annotation for a node. Replaces any existing annotation for the same nodeId. */
export function setAnnotation(projectRoot: string, annotation: Annotation): void {
  const annotations = loadAnnotations(projectRoot).filter((a) => a.nodeId !== annotation.nodeId);
  annotations.push(annotation);
  saveAnnotations(projectRoot, annotations);
}

/** Find the latest annotation for a given nodeId. */
export function getAnnotationForNode(projectRoot: string, nodeId: string): Annotation | undefined {
  const annotations = loadAnnotations(projectRoot);
  return annotations.filter((a) => a.nodeId === nodeId).pop();
}

function saveAnnotations(projectRoot: string, annotations: Annotation[]): void {
  const dir = join(projectRoot, SIDECAR_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const file: AnnotationFile = { version: '1.0.0', annotations };
  writeFileSync(join(dir, ANNOTATIONS_FILE), JSON.stringify(file, null, 2), 'utf-8');
}
