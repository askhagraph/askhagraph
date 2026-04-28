#!/usr/bin/env node
/**
 * @module @askhagraph/cli
 * CLI entry point for AskhaGraph call graph explorer.
 *
 * Usage:
 *   askhagraph <entry-point> [options]
 *
 * Entry point can be:
 *   - file:function format (e.g., "src/auth.ts:login")
 *   - A natural language description (quoted)
 *
 * Options:
 *   --format <json|mermaid|tree>   Output format (default: json)
 *   --depth <number>               Max traversal depth
 *   --output <path>                Write to file instead of stdout
 *   --direction <downstream|upstream|bidirectional>  Traversal direction (default: downstream)
 *   --project <path>               Project root (default: cwd)
 *   --help                         Show usage
 *   --version                      Show version
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  ConfigLoader,
  GraphBuilder,
  GraphSerializer,
  LazySymbolIndex,
  ENGINE_VERSION,
} from '@askhagraph/core-engine';
import type {
  CallGraph,
  OutputFormat,
  SymbolEntry,
  SymbolIndex,
} from '@askhagraph/core-engine';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  entryPoint: string;
  format: OutputFormat;
  depth: number | undefined;
  output: string | undefined;
  direction: 'downstream' | 'upstream' | 'bidirectional';
  project: string;
  showUnresolved: boolean;
  help: boolean;
  version: boolean;
}

function printUsage(): void {
  const usage = `
AskhaGraph — Feature Call Graph Explorer

Usage:
  askhagraph <entry-point> [options]

Entry point:
  file:function       Analyze a specific function (e.g., "src/auth.ts:login")
  "description"       Natural language description (quoted)

Options:
  --format <format>   Output format: json, mermaid, tree (default: json)
  --depth <number>    Maximum traversal depth
  --output <path>     Write output to file instead of stdout
  --direction <dir>   Traversal direction: downstream, upstream, bidirectional (default: downstream)
  --project <path>    Project root directory (default: current directory)
  --show-unresolved   Include unresolved library/external calls (hidden by default)
  --help              Show this help message
  --version           Show version

Examples:
  askhagraph src/checkout.ts:processOrder
  askhagraph src/checkout.ts:processOrder --format mermaid --depth 5
  askhagraph "user authentication flow" --direction bidirectional
  askhagraph src/api.ts:handleRequest --output graph.json
`.trim();

  console.log(usage);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    entryPoint: '',
    format: 'json',
    depth: undefined,
    output: undefined,
    direction: 'downstream',
    project: process.cwd(),
    showUnresolved: false,
    help: false,
    version: false,
  };

  // Skip node and script path
  const rawArgs = argv.slice(2);
  let i = 0;

  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      i++;
    } else if (arg === '--version' || arg === '-v') {
      args.version = true;
      i++;
    } else if (arg === '--format') {
      i++;
      const value = rawArgs[i];
      if (value === 'json' || value === 'mermaid' || value === 'tree') {
        args.format = value;
      } else {
        console.error(`Error: Invalid format "${value}". Must be json, mermaid, or tree.`);
        process.exit(1);
      }
      i++;
    } else if (arg === '--depth') {
      i++;
      const value = rawArgs[i];
      const num = Number(value);
      if (!Number.isFinite(num) || num < 1) {
        console.error(`Error: Invalid depth "${value}". Must be a positive number.`);
        process.exit(1);
      }
      args.depth = num;
      i++;
    } else if (arg === '--output') {
      i++;
      args.output = rawArgs[i];
      i++;
    } else if (arg === '--direction') {
      i++;
      const value = rawArgs[i];
      if (value === 'downstream' || value === 'upstream' || value === 'bidirectional') {
        args.direction = value;
      } else {
        console.error(
          `Error: Invalid direction "${value}". Must be downstream, upstream, or bidirectional.`,
        );
        process.exit(1);
      }
      i++;
    } else if (arg === '--project') {
      i++;
      args.project = resolve(rawArgs[i] ?? '.');
      i++;
    } else if (arg === '--show-unresolved') {
      args.showUnresolved = true;
      i++;
    } else if (arg.startsWith('--')) {
      console.error(`Error: Unknown option "${arg}".`);
      process.exit(1);
    } else {
      // Positional argument: entry point
      args.entryPoint = arg;
      i++;
    }
  }

  return args;
}

// ─── Native Addon Helpers ────────────────────────────────────────────────────

interface NativeAddon {
  initialize(): void;
  parseFiles(files: Array<{ filePath: string; languageId: string }>): Array<{
    filePath: string;
    languageId: string;
    symbols: Array<{
      name: string; qualifiedName: string; kind: string; filePath: string;
      line: number; column: number; signature: string;
      bodyStartLine: number; bodyEndLine: number; visibility: string; languageId: string;
    }>;
    callSites: Array<{
      calleeName: string; filePath: string; line: number; column: number; nameColumn: number;
    }>;
    conditionals: Array<{
      kind: string; filePath: string; line: number; column: number;
      endLine: number; branches: number; conditionText: string;
    }>;
    errors: Array<{ filePath: string; line: number; column: number; message: string }>;
  }>;
  buildIndex(parseResults: unknown[]): {
    symbols: Array<{
      name: string; qualifiedName: string; kind: string; filePath: string;
      line: number; column: number; signature: string;
      bodyStartLine: number; bodyEndLine: number; visibility: string; languageId: string;
    }>;
    imports: Array<{ source: string; specifiers: string[]; filePath: string }>;
    exports: Array<{ name: string; kind: string; filePath: string }>;
    fileHashes: Array<{ filePath: string; hash: string }>;
  };
  extensionToLanguageId(ext: string): string | null;
}

function loadNativeAddon(): NativeAddon {
  try {
    const require = createRequire(import.meta.url);
    return require('@askhagraph/native') as NativeAddon;
  } catch {
    console.error(
      "Native addon not built. Run 'npm run build' in packages/native first.",
    );
    process.exit(1);
  }
}

// ─── Entry Point Resolution ──────────────────────────────────────────────────

function findEntryPointSymbol(
  entryPointStr: string,
  index: SymbolIndex,
): SymbolEntry | undefined {
  // Try file:function format — handle Windows paths (c:\path\file.ts:functionName)
  const colonIndex = findFunctionSeparator(entryPointStr);
  if (colonIndex > 0) {
    const filePart = entryPointStr.slice(0, colonIndex);
    const funcName = entryPointStr.slice(colonIndex + 1);

    if (funcName) {
      // Resolve to absolute path so it matches the lazy index (which stores absolute paths)
      const absoluteFilePart = resolve(filePart);

      // Trigger lazy parsing of the target file
      if (index instanceof LazySymbolIndex) {
        index.ensureFileParsed(absoluteFilePart);
        index.ensureFileParsed(absoluteFilePart.replace(/\\/g, '/'));
      }

      const entries = index.symbols.get(funcName);
      if (entries) {
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

  // Try fuzzy matching against all symbol names
  const lowerInput = entryPointStr.toLowerCase();
  for (const [name, symbolEntries] of index.symbols) {
    if (name.toLowerCase().includes(lowerInput)) {
      return symbolEntries[0];
    }
  }

  return undefined;
}

/** Find the colon separating file path from function name, skipping Windows drive letter. */
function findFunctionSeparator(str: string): number {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === ':' && i !== 1) {
      return i;
    }
  }
  return -1;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.version) {
    console.log(`askhagraph v${ENGINE_VERSION}`);
    return;
  }

  if (args.help || !args.entryPoint) {
    printUsage();
    return;
  }

  // Load config
  const configLoader = new ConfigLoader();
  const config = configLoader.load(args.project, {
    defaultFormat: args.format,
    defaultDepth: args.depth ?? Infinity,
  });

  // Load native addon
  const native = loadNativeAddon();

  // Initialize parser
  native.initialize();

  // Discover files using fast-glob
  const fg = await import('fast-glob');
  const files = await fg.default(config.include, {
    cwd: args.project,
    ignore: config.exclude,
    absolute: true,
    onlyFiles: true,
  });

  // Filter to supported files and map to file entries
  const fileEntries: Array<{ filePath: string; languageId: string }> = [];
  for (const filePath of files) {
    const ext = filePath.split('.').pop() ?? '';
    const langId = native.extensionToLanguageId(ext);
    if (langId) {
      fileEntries.push({ filePath, languageId: langId });
    }
  }

  if (fileEntries.length === 0) {
    console.error('Error: No supported source files found in the project.');
    process.exit(1);
  }

  // Use lazy on-demand parsing — only parse files when their symbols are needed.
  // This matches the stdio server behavior and avoids OOM on large projects.
  const symbolIndex = new LazySymbolIndex(fileEntries, native);

  // Find entry point symbol
  const entrySymbol = findEntryPointSymbol(args.entryPoint, symbolIndex);
  if (!entrySymbol) {
    console.error(`Error: Could not find symbol matching "${args.entryPoint}".`);
    process.exit(1);
  }

  // Build graph
  const graphBuilder = new GraphBuilder();
  const traversalOptions = {
    maxDepth: args.depth,
    includeConditionals: true,
    includeLoops: true,
    includeCallbacks: true,
  };

  let graph;
  switch (args.direction) {
    case 'upstream':
      graph = graphBuilder.buildUpstream(entrySymbol, symbolIndex, traversalOptions);
      break;
    case 'bidirectional':
      graph = graphBuilder.buildBidirectional(entrySymbol, symbolIndex, traversalOptions);
      break;
    case 'downstream':
    default:
      graph = graphBuilder.buildDownstream(entrySymbol, symbolIndex, traversalOptions);
      break;
  }

  // Update graph metadata with project root
  graph.metadata.projectRoot = args.project;

  // Filter out unresolved nodes by default (library/external calls).
  // Use --show-unresolved to include them.
  if (!args.showUnresolved) {
    const unresolvedIds = new Set<string>();
    for (const [id, node] of graph.nodes) {
      if (node.metadata.isUnresolved) {
        unresolvedIds.add(id);
      }
    }
    for (const id of unresolvedIds) {
      graph.nodes.delete(id);
    }
    graph.edges = graph.edges.filter(
      (e) => !unresolvedIds.has(e.sourceId) && !unresolvedIds.has(e.targetId),
    );
  }

  // Serialize output
  const serializer = new GraphSerializer();
  let output: string;
  switch (args.format) {
    case 'mermaid':
      output = serializer.toMermaid(graph);
      break;
    case 'tree':
      output = serializer.toTextTree(graph);
      break;
    case 'json':
    default:
      output = serializer.serialize(graph);
      break;
  }

  // Write output
  if (args.output) {
    const outputPath = resolve(args.output);
    writeFileSync(outputPath, output, 'utf-8');
    console.error(`Output written to ${outputPath}`);
  } else {
    console.log(output);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
