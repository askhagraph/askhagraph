/**
 * @module config/config-loader
 * Loads and merges project configuration from file and CLI flags.
 */

import type { ProjectConfig } from '../types.js';
import type { IConfigLoader } from '../interfaces.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Sensible defaults when no config file is found. */
const DEFAULTS: ProjectConfig = {
  include: [
    '**/*.{ts,tsx,mts,cts}',
    '**/*.{js,jsx,mjs,cjs}',
    '**/*.java',
    '**/*.rs',
    '**/*.{py,pyi}',
    '**/*.go',
    '**/*.cs',
  ],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/vendor/**',
    '**/target/**',
    '**/__pycache__/**',
    '**/bin/**',
    '**/obj/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/coverage/**',
    '**/.askhagraph/**',
    '**/playwright-report/**',
    // Mobile / native
    '**/android/**',
    '**/ios/**',
    '**/Pods/**',
    '**/.expo/**',
    '**/.gradle/**',
    // Generated / bundled
    '**/*.bundle.js',
    '**/*.min.js',
    '**/*.d.ts',
    '**/generated/**',
    '**/__generated__/**',
    '**/.cache/**',
    '**/tmp/**',
    '**/temp/**',
  ],
  languageOverrides: {},
  defaultDepth: Infinity,
  defaultFormat: 'json',
  cacheMaxSizeMB: 500,
  timeoutSeconds: 60,
};

/**
 * Configuration loader that reads `.askhagraph.json` from the project root,
 * merges with defaults, and applies CLI flag overrides.
 */
export class ConfigLoader implements IConfigLoader {
  /**
   * Load project configuration, merging file config with optional CLI flags.
   *
   * Precedence: defaults ← file config ← CLI flags
   */
  load(projectRoot: string, cliFlags?: Partial<ProjectConfig>): ProjectConfig {
    const fileConfig = this.loadFromFile(projectRoot);
    return this.merge(DEFAULTS, fileConfig, cliFlags);
  }

  /** Attempt to load config from `.askhagraph.json` or detect `.askhagraph.config.ts`. */
  private loadFromFile(projectRoot: string): Partial<ProjectConfig> {
    const jsonPath = join(projectRoot, '.askhagraph.json');

    if (existsSync(jsonPath)) {
      try {
        const raw = readFileSync(jsonPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        return this.validate(parsed);
      } catch {
        // If the JSON is malformed, fall through to defaults
        return {};
      }
    }

    const tsPath = join(projectRoot, 'askhagraph.config.ts');
    if (existsSync(tsPath)) {
      // TS config requires compilation — log a warning and use defaults
      console.warn(
        '[AskhaGraph] Found askhagraph.config.ts but TS config loading requires compilation. Using defaults.',
      );
    }

    return {};
  }

  /** Validate a parsed JSON value against the ProjectConfig shape. */
  private validate(raw: unknown): Partial<ProjectConfig> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const obj = raw as Record<string, unknown>;
    const result: Partial<ProjectConfig> = {};

    if (Array.isArray(obj['include'])) {
      result.include = obj['include'].filter(
        (v): v is string => typeof v === 'string',
      );
    }

    if (Array.isArray(obj['exclude'])) {
      result.exclude = obj['exclude'].filter(
        (v): v is string => typeof v === 'string',
      );
    }

    if (
      obj['languageOverrides'] !== null &&
      typeof obj['languageOverrides'] === 'object' &&
      !Array.isArray(obj['languageOverrides'])
    ) {
      result.languageOverrides = obj['languageOverrides'] as Record<
        string,
        ProjectConfig['languageOverrides'][string]
      >;
    }

    if (typeof obj['defaultDepth'] === 'number' && obj['defaultDepth'] > 0) {
      result.defaultDepth = obj['defaultDepth'];
    }

    if (
      obj['defaultFormat'] === 'json' ||
      obj['defaultFormat'] === 'mermaid' ||
      obj['defaultFormat'] === 'tree'
    ) {
      result.defaultFormat = obj['defaultFormat'];
    }

    if (
      typeof obj['cacheMaxSizeMB'] === 'number' &&
      obj['cacheMaxSizeMB'] > 0
    ) {
      result.cacheMaxSizeMB = obj['cacheMaxSizeMB'];
    }

    if (
      typeof obj['timeoutSeconds'] === 'number' &&
      obj['timeoutSeconds'] > 0
    ) {
      result.timeoutSeconds = obj['timeoutSeconds'];
    }

    return result;
  }

  /** Merge defaults, file config, and CLI flags with proper precedence. */
  private merge(
    defaults: ProjectConfig,
    fileConfig: Partial<ProjectConfig>,
    cliFlags?: Partial<ProjectConfig>,
  ): ProjectConfig {
    return {
      ...defaults,
      ...fileConfig,
      ...(cliFlags ?? {}),
    };
  }
}
