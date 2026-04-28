/**
 * @module overlays/coverage
 * Maps test coverage data from lcov, Istanbul JSON, or JaCoCo XML formats
 * onto call graph nodes.
 */

import { readFileSync } from 'node:fs';
import type { CallGraph } from '../types.js';

/** Coverage information for a single graph node. */
export interface CoverageInfo {
  /** Line coverage ratio (0.0 – 1.0). */
  lineCoverage: number;
  /** Number of lines within the node's body that are covered. */
  coveredLines: number;
  /** Total number of instrumented lines within the node's body. */
  totalLines: number;
  /** Coverage tier based on line coverage percentage. */
  tier: 'covered' | 'partial' | 'uncovered';
}

/** Supported coverage file formats. */
export type CoverageFormat = 'lcov' | 'istanbul' | 'jacoco';

/** Per-line hit data for a single source file. */
interface FileCoverage {
  /** Map of line number → hit count. */
  lineHits: Map<number, number>;
}

const SUPPORTED_FORMATS: CoverageFormat[] = ['lcov', 'istanbul', 'jacoco'];

/**
 * Parses test coverage files and maps coverage data onto call graph nodes
 * by matching file paths and line ranges.
 */
export class CoverageMapper {
  /**
   * Map coverage data from a file onto graph nodes.
   *
   * @param graph - The call graph to enrich with coverage data.
   * @param coveragePath - Path to the coverage data file.
   * @returns Map of node ID → coverage info.
   * @throws Error if the coverage format is unsupported.
   */
  map(graph: CallGraph, coveragePath: string): Map<string, CoverageInfo> {
    const coverageMap = new Map<string, CoverageInfo>();

    if (graph.nodes.size === 0) {
      return coverageMap;
    }

    let content: string;
    try {
      content = readFileSync(coveragePath, 'utf-8');
    } catch {
      return coverageMap;
    }

    if (!content.trim()) {
      return coverageMap;
    }

    const format = this.detectFormat(content);
    if (!format) {
      throw new Error(
        `Unsupported coverage format. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`,
      );
    }

    const fileCoverageData = this.parseCoverage(content, format);
    return this.mapToNodes(graph, fileCoverageData);
  }

  // ─── Format Detection ────────────────────────────────────────────────────────

  /**
   * Detect the coverage format from file content.
   *
   * - lcov: starts with `TN:` or `SF:` lines
   * - istanbul: JSON with `statementMap` keys
   * - jacoco: XML with `<report>` root element
   */
  private detectFormat(content: string): CoverageFormat | null {
    const trimmed = content.trimStart();

    // lcov format: lines start with TN: or SF:
    if (trimmed.startsWith('TN:') || trimmed.startsWith('SF:')) {
      return 'lcov';
    }

    // jacoco XML: starts with XML declaration or <report> tag
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<report')) {
      // Verify it's actually JaCoCo by checking for <report> element
      if (trimmed.includes('<report')) {
        return 'jacoco';
      }
    }

    // istanbul JSON: try parsing as JSON and check for statementMap
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        // Istanbul JSON has file paths as keys, each with a statementMap property
        const firstKey = Object.keys(parsed)[0];
        if (firstKey && parsed[firstKey]?.statementMap !== undefined) {
          return 'istanbul';
        }
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }

  // ─── Parsers ─────────────────────────────────────────────────────────────────

  /**
   * Parse coverage data into a normalized per-file line-hit map.
   */
  private parseCoverage(
    content: string,
    format: CoverageFormat,
  ): Map<string, FileCoverage> {
    switch (format) {
      case 'lcov':
        return this.parseLcov(content);
      case 'istanbul':
        return this.parseIstanbul(content);
      case 'jacoco':
        return this.parseJacoco(content);
    }
  }

  /**
   * Parse lcov format.
   *
   * Structure:
   *   TN:<test name>
   *   SF:<source file path>
   *   DA:<line number>,<hit count>
   *   ...
   *   end_of_record
   */
  private parseLcov(content: string): Map<string, FileCoverage> {
    const result = new Map<string, FileCoverage>();
    const lines = content.split('\n');
    let currentFile: string | null = null;
    let currentHits: Map<number, number> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('SF:')) {
        currentFile = trimmed.slice(3);
        currentHits = new Map();
        continue;
      }

      if (trimmed.startsWith('DA:') && currentHits) {
        const parts = trimmed.slice(3).split(',');
        if (parts.length >= 2) {
          const lineNum = parseInt(parts[0], 10);
          const hits = parseInt(parts[1], 10);
          if (!isNaN(lineNum) && !isNaN(hits)) {
            currentHits.set(lineNum, hits);
          }
        }
        continue;
      }

      if (trimmed === 'end_of_record' && currentFile && currentHits) {
        result.set(currentFile, { lineHits: currentHits });
        currentFile = null;
        currentHits = null;
      }
    }

    // Handle case where file doesn't end with end_of_record
    if (currentFile && currentHits) {
      result.set(currentFile, { lineHits: currentHits });
    }

    return result;
  }

  /**
   * Parse Istanbul JSON format.
   *
   * Structure: { [filePath]: { statementMap: { [id]: { start, end } }, s: { [id]: hitCount } } }
   */
  private parseIstanbul(content: string): Map<string, FileCoverage> {
    const result = new Map<string, FileCoverage>();

    let parsed: Record<string, IstanbulFileEntry>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return result;
    }

    for (const [filePath, fileData] of Object.entries(parsed)) {
      if (!fileData?.statementMap || !fileData?.s) {
        continue;
      }

      const lineHits = new Map<number, number>();

      for (const [stmtId, location] of Object.entries(fileData.statementMap)) {
        const hits = fileData.s[stmtId] ?? 0;
        if (location?.start?.line !== undefined) {
          const startLine = location.start.line;
          const endLine = location.end?.line ?? startLine;

          // Mark all lines in the statement range
          for (let line = startLine; line <= endLine; line++) {
            const existing = lineHits.get(line) ?? 0;
            lineHits.set(line, Math.max(existing, hits));
          }
        }
      }

      result.set(filePath, { lineHits });
    }

    return result;
  }

  /**
   * Parse JaCoCo XML format.
   *
   * Structure:
   *   <report>
   *     <package name="...">
   *       <sourcefile name="...">
   *         <line nr="..." mi="..." ci="..." ... />
   *       </sourcefile>
   *     </package>
   *   </report>
   *
   * Uses simple regex-based parsing to avoid XML parser dependencies.
   */
  private parseJacoco(content: string): Map<string, FileCoverage> {
    const result = new Map<string, FileCoverage>();

    // Extract package + sourcefile blocks
    const sourceFileRegex = /<package\s+name="([^"]*)"[^>]*>[\s\S]*?<\/package>/g;
    let packageMatch: RegExpExecArray | null;

    while ((packageMatch = sourceFileRegex.exec(content)) !== null) {
      const packageName = packageMatch[1].replace(/\//g, '/');
      const packageBlock = packageMatch[0];

      const sfRegex = /<sourcefile\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/sourcefile>/g;
      let sfMatch: RegExpExecArray | null;

      while ((sfMatch = sfRegex.exec(packageBlock)) !== null) {
        const fileName = sfMatch[1];
        const sfBlock = sfMatch[2];
        const filePath = packageName ? `${packageName}/${fileName}` : fileName;

        const lineHits = new Map<number, number>();
        const lineRegex = /<line\s+nr="(\d+)"\s+mi="(\d+)"\s+ci="(\d+)"/g;
        let lineMatch: RegExpExecArray | null;

        while ((lineMatch = lineRegex.exec(sfBlock)) !== null) {
          const lineNum = parseInt(lineMatch[1], 10);
          const missedInstructions = parseInt(lineMatch[2], 10);
          const coveredInstructions = parseInt(lineMatch[3], 10);

          // A line is "hit" if it has any covered instructions
          const hits = coveredInstructions > 0 ? 1 : 0;
          if (!isNaN(lineNum) && (missedInstructions > 0 || coveredInstructions > 0)) {
            lineHits.set(lineNum, hits);
          }
        }

        if (lineHits.size > 0) {
          result.set(filePath, { lineHits });
        }
      }
    }

    return result;
  }

  // ─── Node Mapping ────────────────────────────────────────────────────────────

  /**
   * Map parsed coverage data onto graph nodes by matching file paths and
   * computing per-node coverage within each node's line range.
   */
  private mapToNodes(
    graph: CallGraph,
    fileCoverageData: Map<string, FileCoverage>,
  ): Map<string, CoverageInfo> {
    const coverageMap = new Map<string, CoverageInfo>();

    if (fileCoverageData.size === 0) {
      return coverageMap;
    }

    for (const [nodeId, node] of graph.nodes) {
      // Only compute coverage for function and method nodes
      if (node.kind !== 'function' && node.kind !== 'method') {
        continue;
      }

      const fileCoverage = this.findFileCoverage(node.filePath, fileCoverageData);
      if (!fileCoverage) {
        continue;
      }

      // Use the node's line as a reference point.
      // Without explicit bodyRange on GraphNode, we look for coverage lines
      // near the node's definition line.
      const info = this.computeNodeCoverage(node.line, fileCoverage);
      if (info) {
        coverageMap.set(nodeId, info);
      }
    }

    return coverageMap;
  }

  /**
   * Find coverage data for a file, handling relative vs absolute path differences.
   */
  private findFileCoverage(
    nodePath: string,
    fileCoverageData: Map<string, FileCoverage>,
  ): FileCoverage | undefined {
    const normalizedNode = nodePath.replace(/\\/g, '/');

    // Direct match
    const direct = fileCoverageData.get(normalizedNode);
    if (direct) {
      return direct;
    }

    // Suffix match
    for (const [coveragePath, coverage] of fileCoverageData) {
      const normalizedCoverage = coveragePath.replace(/\\/g, '/');
      if (
        normalizedNode.endsWith(normalizedCoverage) ||
        normalizedCoverage.endsWith(normalizedNode)
      ) {
        return coverage;
      }
    }

    return undefined;
  }

  /**
   * Compute coverage info for a node given its definition line and file coverage data.
   *
   * Since GraphNode doesn't expose bodyRange directly, we scan all coverage lines
   * at and after the node's definition line until a gap is found, approximating
   * the function body. If the graph provides body range info in the future,
   * this can be refined.
   */
  private computeNodeCoverage(
    nodeLine: number,
    fileCoverage: FileCoverage,
  ): CoverageInfo | null {
    // Collect all instrumented lines at or after the node's definition line
    // that are within a reasonable range (up to 500 lines)
    const maxRange = 500;
    let coveredLines = 0;
    let totalLines = 0;

    for (const [line, hits] of fileCoverage.lineHits) {
      if (line >= nodeLine && line < nodeLine + maxRange) {
        totalLines++;
        if (hits > 0) {
          coveredLines++;
        }
      }
    }

    if (totalLines === 0) {
      return null;
    }

    const lineCoverage = coveredLines / totalLines;
    const tier = this.assignTier(lineCoverage);

    return { lineCoverage, coveredLines, totalLines, tier };
  }

  /**
   * Assign a coverage tier based on line coverage percentage.
   * - >80% → covered
   * - 20-80% → partial
   * - <20% → uncovered
   */
  private assignTier(lineCoverage: number): CoverageInfo['tier'] {
    if (lineCoverage > 0.8) {
      return 'covered';
    }
    if (lineCoverage >= 0.2) {
      return 'partial';
    }
    return 'uncovered';
  }
}

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Shape of a single file entry in Istanbul JSON coverage format. */
interface IstanbulFileEntry {
  statementMap: Record<string, IstanbulLocation>;
  s: Record<string, number>;
}

/** Shape of a location in Istanbul JSON coverage format. */
interface IstanbulLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}
