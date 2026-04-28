/**
 * @module lazy-index
 * Lazy symbol index that parses files on demand during graph traversal.
 * Instead of parsing the entire project upfront, it only parses files
 * when their symbols or call sites are needed.
 */

import type {
  SymbolIndex,
  SymbolEntry,
  ImportEntry,
  ExportEntry,
  CallSite,
  ConditionalNode,
} from './types.js';

/** Interface for the native parser addon. */
export interface LazyParserAddon {
  parseFiles(files: Array<{ filePath: string; languageId: string }>): Array<{
    filePath: string;
    languageId: string;
    symbols: Array<{
      name: string;
      qualifiedName: string;
      kind: string;
      filePath: string;
      line: number;
      column: number;
      signature: string;
      bodyStartLine: number;
      bodyEndLine: number;
      visibility: string;
      languageId: string;
    }>;
    callSites: Array<{
      calleeName: string;
      filePath: string;
      line: number;
      column: number;
      nameColumn: number;
    }>;
    conditionals: Array<{
      kind: string;
      filePath: string;
      line: number;
      column: number;
      endLine: number;
      branches: number;
      conditionText: string;
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
}

/**
 * A lazy symbol index that parses files on demand.
 * Implements the same SymbolIndex interface so the graph builder
 * doesn't need to change.
 */
export class LazySymbolIndex implements SymbolIndex {
  /** Map from symbol name to all definitions with that name. */
  symbols: Map<string, SymbolEntry[]>;
  /** Map from file path to its import declarations. */
  imports: Map<string, ImportEntry[]>;
  /** Map from file path to its export declarations. */
  exports: Map<string, ExportEntry[]>;
  /** Map from file path to content hash. */
  fileHashes: Map<string, string>;
  /** Map from file path to call sites. */
  callSites: Map<string, CallSite[]>;
  /** Map from file path to conditionals. */
  conditionals: Map<string, ConditionalNode[]>;

  /** Set of file paths that have already been parsed. */
  private parsedFiles = new Set<string>();
  /** All discoverable source files with their language IDs. */
  private allFiles: Map<string, string>;
  /** The native parser addon. */
  private parser: LazyParserAddon;
  /** Number of files parsed on demand. */
  private parseCount = 0;

  constructor(
    allFiles: Array<{ filePath: string; languageId: string }>,
    parser: LazyParserAddon,
  ) {
    this.symbols = new Map();
    this.imports = new Map();
    this.exports = new Map();
    this.fileHashes = new Map();
    this.callSites = new Map();
    this.conditionals = new Map();

    this.allFiles = new Map();
    for (const f of allFiles) {
      // Store with normalized path for consistent lookups
      this.allFiles.set(f.filePath, f.languageId);
      // Also store with forward slashes for cross-platform matching
      const normalized = f.filePath.replace(/\\/g, '/');
      if (normalized !== f.filePath) {
        this.allFiles.set(normalized, f.languageId);
      }
    }
    this.parser = parser;
  }

  /**
   * Ensure a specific file has been parsed and its data is in the index.
   * No-op if the file was already parsed.
   */
  ensureFileParsed(filePath: string): void {
    if (this.parsedFiles.has(filePath)) return;

    // Try normalized path too (forward slashes)
    const normalized = filePath.replace(/\\/g, '/');
    if (this.parsedFiles.has(normalized)) return;

    // Look up with original path first, then normalized
    let langId = this.allFiles.get(filePath);
    let actualPath = filePath;
    if (!langId) {
      langId = this.allFiles.get(normalized);
      actualPath = normalized;
    }
    if (!langId) return; // Not a known source file

    this.parseAndIndex(actualPath, langId);
  }

  /**
   * Ensure all files that might define a given symbol name are parsed.
   * Skips names that look like built-in/library calls to avoid unnecessary parsing.
   */
  ensureSymbolParsed(symbolName: string): void {
    // If we already have entries for this symbol, no need to search
    if (this.symbols.has(symbolName)) return;

    // Skip names that look like built-in/library calls — these will never
    // be found in project source files and would cause a full scan.
    if (this.isLikelyBuiltIn(symbolName)) return;

    // Parse unparsed files in small batches, stop when found or budget exhausted.
    // Budget is kept low to avoid speculative parsing that inflates memory for
    // symbols that are unlikely to exist in project source (e.g., library types).
    const MAX_SEARCH_FILES = 200;
    const unparsed: Array<{ filePath: string; languageId: string }> = [];
    for (const [fp, langId] of this.allFiles) {
      if (!this.parsedFiles.has(fp)) {
        unparsed.push({ filePath: fp, languageId: langId });
      }
    }

    const BATCH = 50;
    let searched = 0;
    for (let i = 0; i < unparsed.length && searched < MAX_SEARCH_FILES; i += BATCH) {
      const batch = unparsed.slice(i, i + BATCH);
      this.parseBatch(batch);
      searched += batch.length;

      if (this.symbols.has(symbolName)) {
        return; // Found it
      }
    }
  }

  /**
   * Resolve a symbol by following imports from a specific file.
   * Instead of searching all files, look at the file's imports to find
   * which file likely defines the symbol, then parse just that file.
   */
  ensureSymbolFromImports(symbolName: string, fromFilePath: string): void {
    if (this.symbols.has(symbolName)) return;

    // Get imports for the calling file
    const fileImports = this.imports.get(fromFilePath);
    if (!fileImports) return;

    // Find an import that includes this symbol name
    for (const imp of fileImports) {
      if (imp.specifiers.includes(symbolName) || imp.specifiers.includes('*')) {
        // Resolve the import source to an absolute file path
        const resolvedPath = this.resolveImportPath(imp.source, fromFilePath);
        if (resolvedPath) {
          this.ensureFileParsed(resolvedPath);
          if (this.symbols.has(symbolName)) return;
        }
      }
    }
  }

  /** Resolve a relative import path to an absolute file path. */
  private resolveImportPath(source: string, fromFilePath: string): string | null {
    // Skip package imports (not relative paths)
    if (!source.startsWith('.') && !source.startsWith('/')) return null;

    const path = fromFilePath.replace(/\\/g, '/');
    const dir = path.substring(0, path.lastIndexOf('/'));
    let resolved = source.startsWith('/')
      ? source
      : this.joinPath(dir, source);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

    // Try exact match first
    if (this.allFiles.has(resolved)) return resolved;

    // Try with extensions
    for (const ext of extensions) {
      if (this.allFiles.has(resolved + ext)) return resolved + ext;
    }

    // Try as directory with index file
    for (const ext of extensions) {
      if (this.allFiles.has(resolved + '/index' + ext)) return resolved + '/index' + ext;
    }

    return null;
  }

  /** Join path segments, resolving .. and . */
  private joinPath(base: string, relative: string): string {
    const parts = base.split('/');
    for (const segment of relative.split('/')) {
      if (segment === '..') {
        parts.pop();
      } else if (segment !== '.') {
        parts.push(segment);
      }
    }
    return parts.join('/');
  }
  private isLikelyBuiltIn(name: string): boolean {
    // Common JS/TS built-ins and well-known library objects
    const builtIns = new Set([
      'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
      'Boolean', 'Date', 'RegExp', 'Error', 'Promise', 'Map', 'Set',
      'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'parseInt',
      'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'setInterval',
      'clearTimeout', 'clearInterval', 'fetch', 'require', 'process',
      'Buffer', 'global', 'globalThis', 'window', 'document', 'navigator',
      // React / React Native
      'React', 'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
      'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
      'createElement', 'createContext', 'forwardRef', 'memo', 'lazy',
      'Suspense', 'Fragment', 'StrictMode', 'createRef',
      'StyleSheet', 'Platform', 'Dimensions', 'PixelRatio', 'Animated',
      'Alert', 'Linking', 'AppState', 'Keyboard', 'BackHandler',
      // Common library patterns
      'dispatch', 'emit', 'on', 'off', 'once', 'addEventListener',
      'removeEventListener', 'subscribe', 'unsubscribe',
      // Node.js built-ins
      'path', 'fs', 'os', 'url', 'http', 'https', 'crypto', 'stream',
      'events', 'util', 'child_process', 'cluster', 'net', 'tls', 'dns',
      'readline', 'zlib', 'assert', 'querystring',
      // Common third-party library objects
      'express', 'app', 'router', 'axios', 'lodash', '_', 'moment',
      'dayjs', 'chalk', 'debug', 'winston', 'pino', 'joi', 'yup', 'zod',
      'prisma', 'knex', 'sequelize', 'mongoose', 'redis', 'pg',
      'supertest', 'request', 'response', 'res', 'req', 'next',
      // Testing frameworks
      'describe', 'it', 'test', 'expect', 'jest', 'vi', 'cy',
      'beforeAll', 'afterAll', 'beforeEach', 'afterEach',
      // TypeScript utility types / decorators (sometimes appear as calls)
      'Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit',
      'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'InstanceType',
    ]);

    // Direct match
    if (builtIns.has(name)) return true;

    // Dotted name where the receiver is a built-in (e.g., "console.log", "Math.min")
    const dotIdx = name.indexOf('.');
    if (dotIdx > 0) {
      const receiver = name.slice(0, dotIdx);
      if (builtIns.has(receiver)) return true;
    }

    return false;
  }

  /** Get the number of files parsed on demand. */
  getParseCount(): number {
    return this.parseCount;
  }

  /** Get the total number of discoverable files. */
  getTotalFiles(): number {
    return this.allFiles.size;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private parseAndIndex(filePath: string, languageId: string): void {
    this.parseBatch([{ filePath, languageId }]);
  }

  private parseBatch(files: Array<{ filePath: string; languageId: string }>): void {
    const results = this.parser.parseFiles(files);
    const nativeIndex = this.parser.buildIndex(results);

    // Merge symbols
    for (const sym of nativeIndex.symbols) {
      const entry: SymbolEntry = {
        name: sym.name,
        qualifiedName: sym.qualifiedName,
        kind: sym.kind as SymbolEntry['kind'],
        filePath: sym.filePath,
        line: sym.line,
        column: sym.column,
        signature: sym.signature,
        bodyRange: { startLine: sym.bodyStartLine, endLine: sym.bodyEndLine },
        visibility: sym.visibility as SymbolEntry['visibility'],
        languageId: sym.languageId as 'typescript' | 'javascript' | 'java' | 'rust' | 'python' | 'go' | 'csharp',
      };
      const existing = this.symbols.get(sym.name);
      if (existing) {
        existing.push(entry);
      } else {
        this.symbols.set(sym.name, [entry]);
      }
    }

    // Merge imports
    for (const imp of nativeIndex.imports) {
      const entry: ImportEntry = { source: imp.source, specifiers: imp.specifiers, filePath: imp.filePath };
      const existing = this.imports.get(imp.filePath);
      if (existing) {
        existing.push(entry);
      } else {
        this.imports.set(imp.filePath, [entry]);
      }
    }

    // Merge exports
    for (const exp of nativeIndex.exports) {
      const entry: ExportEntry = { name: exp.name, kind: exp.kind as ExportEntry['kind'], filePath: exp.filePath };
      const existing = this.exports.get(exp.filePath);
      if (existing) {
        existing.push(entry);
      } else {
        this.exports.set(exp.filePath, [entry]);
      }
    }

    // Merge file hashes
    for (const fh of nativeIndex.fileHashes) {
      this.fileHashes.set(fh.filePath, fh.hash);
    }

    // Merge call sites and conditionals from parse results
    for (const result of results) {
      this.parsedFiles.add(result.filePath);
      // Also mark the normalized version as parsed
      const normalized = result.filePath.replace(/\\/g, '/');
      if (normalized !== result.filePath) {
        this.parsedFiles.add(normalized);
      }
      this.parseCount++;

      if (result.callSites.length > 0) {
        this.callSites.set(result.filePath, result.callSites.map((cs) => ({
          calleeName: cs.calleeName,
          filePath: cs.filePath,
          line: cs.line,
          column: cs.column,
        })));
        // Also store with normalized path for cross-platform lookup
        if (normalized !== result.filePath) {
          this.callSites.set(normalized, this.callSites.get(result.filePath)!);
        }
      }
      if (result.conditionals.length > 0) {
        this.conditionals.set(result.filePath, result.conditionals.map((c) => ({
          kind: c.kind as ConditionalNode['kind'],
          filePath: c.filePath,
          line: c.line,
          column: c.column,
          endLine: c.endLine,
          branches: c.branches,
          conditionText: c.conditionText || undefined,
        })));
        // Also store with normalized path
        if (normalized !== result.filePath) {
          this.conditionals.set(normalized, this.conditionals.get(result.filePath)!);
        }
      }
    }
  }
}
