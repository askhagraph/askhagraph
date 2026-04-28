/**
 * @module cache/cache-manager
 * Manages persistence and retrieval of the symbol index cache.
 */

import type { SymbolIndex } from '../types.js';
import type { ICacheManager, CachedIndex } from '../interfaces.js';
import { ENGINE_VERSION } from '../constants.js';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';

/**
 * Get the platform-appropriate cache base directory.
 * - Windows: %LOCALAPPDATA%/AskhaGraph/cache
 * - macOS: ~/Library/Caches/AskhaGraph
 * - Linux: ~/.cache/askhagraph
 */
function getCacheBaseDir(): string {
  const p = platform();
  if (p === 'win32') {
    return join(process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'), 'AskhaGraph', 'cache');
  } else if (p === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'AskhaGraph');
  } else {
    return join(process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache'), 'askhagraph');
  }
}

/** Create a short hash of the project root for unique cache directories. */
function hashProjectRoot(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
}

/** Cache index filename. */
const CACHE_FILE = 'index.json';

/**
 * Serializable representation of a SymbolIndex where Maps are stored
 * as arrays of [key, value] entries for JSON compatibility.
 */
interface SerializedSymbolIndex {
  symbols: [string, SymbolIndex['symbols'] extends Map<string, infer V> ? V : never][];
  imports: [string, SymbolIndex['imports'] extends Map<string, infer V> ? V : never][];
  exports: [string, SymbolIndex['exports'] extends Map<string, infer V> ? V : never][];
  fileHashes: [string, string][];
  callSites: [string, SymbolIndex['callSites'] extends Map<string, infer V> ? V : never][];
  conditionals: [string, SymbolIndex['conditionals'] extends Map<string, infer V> ? V : never][];
}

/** Serialized cache format written to disk. */
interface SerializedCache {
  engineVersion: string;
  timestamp: string;
  index: SerializedSymbolIndex;
}

/**
 * Cache manager that persists and retrieves the SymbolIndex to avoid
 * re-parsing unchanged files.
 *
 * Cache location: `.askhagraph/cache/` in the project directory.
 */
export class CacheManager implements ICacheManager {
  /**
   * Get the cache directory for a given project root.
   * Uses AppData with a hashed project path for uniqueness.
   */
  private getCacheDir(projectRoot: string): string {
    return join(getCacheBaseDir(), hashProjectRoot(projectRoot));
  }

  /**
   * Load a cached index for the given project root.
   * Returns null if cache is not found, corrupted, or incompatible.
   */
  load(projectRoot: string): CachedIndex | null {
    const cachePath = join(this.getCacheDir(projectRoot), CACHE_FILE);

    if (!existsSync(cachePath)) {
      return null;
    }

    try {
      const raw = readFileSync(cachePath, 'utf-8');
      const parsed: SerializedCache = JSON.parse(raw);

      const cachedIndex: CachedIndex = {
        engineVersion: parsed.engineVersion,
        timestamp: parsed.timestamp,
        index: this.deserializeIndex(parsed.index),
      };

      if (!this.isCompatible(cachedIndex)) {
        return null;
      }

      return cachedIndex;
    } catch {
      // Corrupted or unreadable cache — discard
      return null;
    }
  }

  /**
   * Save a symbol index to the cache for the given project root.
   * Creates the cache directory if it doesn't exist.
   */
  save(projectRoot: string, index: SymbolIndex): void {
    const cacheDir = this.getCacheDir(projectRoot);

    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    const serialized: SerializedCache = {
      engineVersion: ENGINE_VERSION,
      timestamp: new Date().toISOString(),
      index: this.serializeIndex(index),
    };

    const cachePath = join(cacheDir, CACHE_FILE);
    writeFileSync(cachePath, JSON.stringify(serialized), 'utf-8');
  }

  /**
   * Check if a cached index is compatible with the current engine version.
   */
  isCompatible(cache: CachedIndex): boolean {
    return cache.engineVersion === ENGINE_VERSION;
  }

  /**
   * Evict cache entries to stay within the size limit.
   * Deletes oldest files (by modification time) until total size is under limit.
   */
  evict(projectRoot: string, maxSizeMB: number): void {
    const cacheDir = this.getCacheDir(projectRoot);

    if (!existsSync(cacheDir)) {
      return;
    }

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    const files = this.getCacheFiles(cacheDir);

    let totalSize = files.reduce((sum, f) => sum + f.size, 0);

    if (totalSize <= maxSizeBytes) {
      return;
    }

    // Sort by modification time ascending (oldest first)
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const file of files) {
      if (totalSize <= maxSizeBytes) {
        break;
      }
      try {
        unlinkSync(file.path);
        totalSize -= file.size;
      } catch {
        // Skip files that can't be deleted
      }
    }
  }

  /** Convert a SymbolIndex (with Maps) to a JSON-serializable format. */
  private serializeIndex(index: SymbolIndex): SerializedSymbolIndex {
    return {
      symbols: Array.from(index.symbols.entries()),
      imports: Array.from(index.imports.entries()),
      exports: Array.from(index.exports.entries()),
      fileHashes: Array.from(index.fileHashes.entries()),
      callSites: Array.from(index.callSites.entries()),
      conditionals: Array.from(index.conditionals.entries()),
    };
  }

  /** Reconstruct a SymbolIndex (with Maps) from serialized entries. */
  private deserializeIndex(serialized: SerializedSymbolIndex): SymbolIndex {
    return {
      symbols: new Map(serialized.symbols),
      imports: new Map(serialized.imports),
      exports: new Map(serialized.exports),
      fileHashes: new Map(serialized.fileHashes),
      callSites: new Map(serialized.callSites),
      conditionals: new Map(serialized.conditionals),
    };
  }

  /** Get all files in the cache directory with their size and modification time. */
  private getCacheFiles(
    cacheDir: string,
  ): Array<{ path: string; size: number; mtimeMs: number }> {
    try {
      const entries = readdirSync(cacheDir);
      return entries
        .map((entry) => {
          const filePath = join(cacheDir, entry);
          try {
            const stat = statSync(filePath);
            if (stat.isFile()) {
              return { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs };
            }
          } catch {
            // Skip entries that can't be stat'd
          }
          return null;
        })
        .filter(
          (f): f is { path: string; size: number; mtimeMs: number } =>
            f !== null,
        );
    } catch {
      return [];
    }
  }
}
