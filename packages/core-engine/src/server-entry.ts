#!/usr/bin/env node
/**
 * @module server-entry
 * Standalone entry point for the AskhaGraph Core Engine stdio server.
 *
 * This script is spawned as a child process by IDE extensions.
 * It initializes the native parser, builds the symbol index for the project,
 * and starts the StdioServer to accept JSON requests on stdin.
 */

import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { StdioServer } from './server/index.js';
import { ConfigLoader } from './config/index.js';
import { LazySymbolIndex } from './lazy-index.js';

// ─── Native Addon Types ──────────────────────────────────────────────────────

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
  isSupported(ext: string): boolean;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const t0 = performance.now();

  const logMem = (label: string) => {
    const mem = process.memoryUsage();
    process.stderr.write(
      `[AskhaGraph] [mem] ${label}: heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, rss=${Math.round(mem.rss / 1024 / 1024)}MB\n`,
    );
  };

  logMem('startup');

  // Load config
  const configLoader = new ConfigLoader();
  const config = configLoader.load(projectRoot);

  // Load native addon
  let native: NativeAddon;
  try {
    const require = createRequire(import.meta.url);
    native = require('@askhagraph/native') as NativeAddon;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[AskhaGraph] Failed to load native addon: ${message}\n`,
    );
    process.stderr.write(
      "[AskhaGraph] Native addon not built. Run 'npm run build' in packages/native first.\n",
    );
    process.exit(1);
  }

  // Initialize parser
  native.initialize();
  const t1 = performance.now();
  process.stderr.write(`[AskhaGraph] Native addon loaded in ${Math.round(t1 - t0)}ms\n`);

  // Discover files
  const fg = await import('fast-glob');
  const files = await fg.default(config.include, {
    cwd: projectRoot,
    ignore: config.exclude,
    absolute: true,
    onlyFiles: true,
  });

  // Filter to supported files
  const fileEntries: Array<{ filePath: string; languageId: string }> = [];
  for (const filePath of files) {
    const ext = filePath.split('.').pop() ?? '';
    const langId = native.extensionToLanguageId(ext);
    if (langId) {
      fileEntries.push({ filePath, languageId: langId });
    }
  }

  const t2 = performance.now();
  process.stderr.write(`[AskhaGraph] File discovery: ${files.length} files found, ${fileEntries.length} supported in ${Math.round(t2 - t1)}ms\n`);
  logMem('after file discovery');

  // Use lazy on-demand parsing — only parse files when their symbols are needed.
  // This avoids the upfront cost of parsing thousands of files.
  const symbolIndex = new LazySymbolIndex(fileEntries, native);

  process.stderr.write(`[AskhaGraph] Lazy index created for ${fileEntries.length} files (0 parsed yet)\n`);
  logMem('after lazy index creation');

  // Start stdio server — files will be parsed on demand during graph traversal
  const server = new StdioServer();
  server.setSymbolIndex(symbolIndex);
  server.start();

  const tEnd = performance.now();
  process.stderr.write(`[AskhaGraph] Total startup: ${Math.round(tEnd - t0)}ms\n`);
  process.stderr.write('[AskhaGraph] Stdio server ready.\n');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[AskhaGraph] Fatal error: ${message}\n`);
  process.exit(1);
});
