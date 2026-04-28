// @ts-check
/**
 * esbuild configuration for the AskhaGraph VS Code extension.
 *
 * Produces two bundles:
 *   1. dist/extension.js       – the VS Code extension host code
 *   2. dist/engine/engine-bundle.js – the Core Engine, fully self-contained
 *      (except for the native .node addon which is copied alongside)
 *
 * The native addon binaries are copied into dist/engine/native/ so the
 * packaged .vsix works standalone without `npm install`.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// ─── Native addon copy helper ────────────────────────────────────────────────

/**
 * Copy platform-specific native .node binaries into dist/engine/native/.
 * Also copies the index.js loader so require('@askhagraph/native') resolves.
 */
function copyNativeAddon() {
  const nativeSrc = path.resolve(__dirname, '..', 'native');
  const nativeDest = path.resolve(__dirname, 'dist', 'engine', 'native');

  // Ensure destination exists
  fs.mkdirSync(nativeDest, { recursive: true });

  // Copy the JS loader and type definitions
  for (const file of ['index.js', 'index.d.ts']) {
    const src = path.join(nativeSrc, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(nativeDest, file));
    }
  }

  // Copy all .node binary files (platform-specific)
  const entries = fs.readdirSync(nativeSrc);
  for (const entry of entries) {
    if (entry.endsWith('.node')) {
      fs.copyFileSync(
        path.join(nativeSrc, entry),
        path.join(nativeDest, entry),
      );
    }
  }

  // Also copy from npm/ subdirectories (published optional deps)
  const npmDir = path.join(nativeSrc, 'npm');
  if (fs.existsSync(npmDir)) {
    const platforms = fs.readdirSync(npmDir);
    for (const platform of platforms) {
      const platformDir = path.join(npmDir, platform);
      if (!fs.statSync(platformDir).isDirectory()) continue;
      const files = fs.readdirSync(platformDir);
      for (const file of files) {
        if (file.endsWith('.node')) {
          fs.copyFileSync(
            path.join(platformDir, file),
            path.join(nativeDest, file),
          );
        }
      }
    }
  }

  console.log('[build] Native addon files copied to dist/engine/native/');
}

// ─── esbuild plugin: resolve @askhagraph/native in engine bundle ─────────────

/**
 * Plugin that rewrites `@askhagraph/native` imports inside the engine bundle
 * to point at the co-located native/ directory instead of node_modules.
 *
 * Handles both static imports (onResolve) and dynamic createRequire calls
 * (onEnd text replacement).
 */
const nativeResolverPlugin = {
  name: 'native-resolver',
  setup(build) {
    // Handle static imports/requires
    build.onResolve({ filter: /^@askhagraph\/native$/ }, () => {
      return { path: './native/index.js', external: true };
    });

    // Handle dynamic createRequire() calls that esbuild can't intercept statically.
    // These appear as require2("@askhagraph/native") in the output.
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      const outfile = path.resolve(__dirname, 'dist', 'engine', 'engine-bundle.js');
      if (!fs.existsSync(outfile)) return;

      let content = fs.readFileSync(outfile, 'utf-8');
      const original = content;

      // Replace all occurrences of the package name in require calls
      // with a relative path to the co-located native directory.
      // Matches: require2("@askhagraph/native"), require("@askhagraph/native"), etc.
      content = content.replace(
        /require\w*\(\s*["']@askhagraph\/native["']\s*\)/g,
        (match) => match.replace('@askhagraph/native', './native/index.js'),
      );

      if (content !== original) {
        fs.writeFileSync(outfile, content);
        console.log('[build] Rewrote @askhagraph/native references to ./native/index.js');
      }
    });
  },
};

// ─── Build ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Bundle the VS Code extension host
  const extCtx = await esbuild.context({
    entryPoints: [path.resolve(__dirname, 'src', 'extension.ts')],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node20',
    outfile: path.resolve(__dirname, 'dist', 'extension.js'),
    external: ['vscode', '@askhagraph/core-engine/dist/server-entry.js'],
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin],
  });

  // 2. Bundle the Core Engine (server-entry) with all JS deps inlined
  const engineCtx = await esbuild.context({
    entryPoints: [path.resolve(__dirname, '..', 'core-engine', 'src', 'server-entry.ts')],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node20',
    outfile: path.resolve(__dirname, 'dist', 'engine', 'engine-bundle.js'),
    // Mark native addon as external — it's a compiled binary, can't be bundled
    external: ['@askhagraph/native'],
    logLevel: 'warning',
    plugins: [nativeResolverPlugin, esbuildProblemMatcherPlugin],
    // Needed for ESM output with node builtins
    banner: {
      js: [
        'import { createRequire as __createRequire } from "module";',
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  });

  // 3. Copy native addon binaries
  copyNativeAddon();

  // Write a package.json in the engine directory to enable ESM for the bundle
  const enginePkgPath = path.resolve(__dirname, 'dist', 'engine', 'package.json');
  fs.writeFileSync(enginePkgPath, JSON.stringify({ type: 'module' }, null, 2) + '\n');
  console.log('[build] engine/package.json written (ESM marker)');

  // Write a package.json in the native directory to keep it as CJS
  // (the NAPI-RS generated index.js uses require/module.exports)
  const nativePkgPath = path.resolve(__dirname, 'dist', 'engine', 'native', 'package.json');
  fs.writeFileSync(nativePkgPath, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
  console.log('[build] engine/native/package.json written (CJS marker)');

  // 5. Copy graph-viewer bundle
  const graphViewerSrc = path.resolve(__dirname, '..', 'graph-viewer', 'dist', 'graph-viewer.bundle.js');
  const graphViewerDest = path.resolve(__dirname, 'dist', 'graph-viewer.bundle.js');
  if (fs.existsSync(graphViewerSrc)) {
    fs.copyFileSync(graphViewerSrc, graphViewerDest);
    console.log('[build] graph-viewer.bundle.js copied');
  }

  if (watch) {
    await Promise.all([extCtx.watch(), engineCtx.watch()]);
    console.log('[watch] Watching for changes...');
  } else {
    await Promise.all([extCtx.rebuild(), engineCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), engineCtx.dispose()]);
    console.log('[build] Build complete');
  }
}

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[build] started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log('[build] finished');
    });
  },
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
