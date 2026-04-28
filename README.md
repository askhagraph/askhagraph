# AskhaGraph

A feature-scoped call graph explorer for multi-language codebases. Analyze, visualize, and navigate call trees across TypeScript, JavaScript, Java, Rust, Python, Go, and C#.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  IDE Extensions                                              │
│  ┌──────────────────────┐  ┌─────────────────────────────┐  │
│  │ VS Code / Kiro       │  │ IntelliJ (Kotlin + JCEF)    │  │
│  │ (TypeScript WebView) │  │                             │  │
│  └──────────┬───────────┘  └──────────────┬──────────────┘  │
│             │ stdio JSON                   │ stdio JSON      │
│             ▼                              ▼                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Core Engine (TypeScript + Rust native addon)         │   │
│  │  - Tree-sitter parser (Rust, 7 languages, rayon)      │   │
│  │  - Symbol indexer (Rust, cross-file resolution)        │   │
│  │  - Graph builder (TypeScript, DFS/BFS)                 │   │
│  │  - Graph serializer (JSON, Mermaid, text tree)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                               │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Graph Viewer (Cytoscape.js + ELK.js, vanilla TS)     │   │
│  │  - Interactive graph visualization                     │   │
│  │  - Accessible list view (WAI-ARIA TreeView)            │   │
│  │  - Search & filter with presets                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 20 LTS | TypeScript runtime |
| npm | >= 10 | Package management |
| Rust | >= 1.75 | Native addon compilation |
| JDK | >= 17 | IntelliJ plugin (only if building the plugin) |

## Quick Start

```bash
# Clone and install dependencies
git clone <repo-url>
cd askhagraph
npm install

# Build the Rust native addon (required first)
cd packages/native
npm run build
cd ../..

# Build all TypeScript packages
npm run build

# Test the CLI
node packages/cli/dist/index.js src/some-file.ts:functionName --format tree
```

## Building

### 1. Native Addon (Rust)

The parser and indexer are written in Rust for performance. You need Rust installed.

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build the native addon for your platform
cd packages/native
npm run build          # Release build
npm run build:debug    # Debug build (faster compilation, slower runtime)
```

This produces a `.node` file (e.g., `askhagraph-native.win32-x64-msvc.node`) that the TypeScript code loads automatically.

### 2. TypeScript Packages

```bash
# From the monorepo root
npm run build
```

This builds all TypeScript packages: `core-engine`, `graph-viewer`, `vscode-extension`, and `cli`.

### 3. VS Code / Kiro Extension

```bash
# Build the extension
cd packages/vscode-extension
npm run build

# Package as .vsix (requires @vscode/vsce)
npx @vscode/vsce package --no-dependencies
```

### 4. IntelliJ Plugin

```bash
# Build the plugin
cd packages/intellij-plugin
./gradlew buildPlugin

# The plugin zip is at build/distributions/askhagraph-intellij-0.1.0.zip
```

## Local Testing

### Testing the CLI

The fastest way to verify everything works:

```bash
# Analyze a specific function
node packages/cli/dist/index.js src/checkout.ts:processOrder

# Output as Mermaid diagram
node packages/cli/dist/index.js src/checkout.ts:processOrder --format mermaid

# Output as text tree
node packages/cli/dist/index.js src/checkout.ts:processOrder --format tree

# Limit depth
node packages/cli/dist/index.js src/checkout.ts:processOrder --depth 3

# Upstream analysis (who calls this function?)
node packages/cli/dist/index.js src/checkout.ts:processOrder --direction upstream

# Analyze a different project
node packages/cli/dist/index.js src/auth.ts:login --project /path/to/other/project
```

### Testing the VS Code Extension

You can launch a development instance of VS Code with the extension loaded:

1. Open the monorepo in VS Code
2. Press `F5` (or Run → Start Debugging)
3. Select "Extension Development Host" if prompted
4. In the new VS Code window, open any project
5. Use the command palette: `AskhaGraph: Analyze Current Function`

Alternatively, without the VS Code debugger:

```bash
# Install the extension locally
cd packages/vscode-extension
npx @vscode/vsce package --no-dependencies
code --install-extension askhagraph-vscode-extension-0.1.0.vsix
```

### Testing the IntelliJ Plugin

Launch a sandboxed IntelliJ instance with the plugin loaded:

```bash
cd packages/intellij-plugin
./gradlew runIde
```

This opens a fresh IntelliJ Community instance with AskhaGraph installed. Then:
1. Open any project in the sandboxed IDE
2. Place your cursor in a function
3. Press `Ctrl+Shift+G` or use Tools → AskhaGraph → Analyze Current Function

### Testing the Stdio Server

You can interact with the Core Engine directly via stdin/stdout:

```bash
# Start the server
node packages/core-engine/dist/server-entry.js

# Then send JSON requests (one per line):
{"id":"1","type":"analyze","payload":{"entryPoint":"src/index.ts:main","direction":"downstream"}}
```

The server responds with newline-delimited JSON on stdout. Progress updates and errors are also sent as JSON responses.

## Project Structure

```
askhagraph/
├── packages/
│   ├── native/              # Rust native addon (tree-sitter parser + indexer)
│   │   ├── src/
│   │   │   ├── lib.rs       # Entry point
│   │   │   ├── parser.rs    # Tree-sitter parser (7 languages)
│   │   │   ├── indexer.rs   # Symbol indexer (cross-file resolution)
│   │   │   └── types.rs     # FFI types
│   │   ├── Cargo.toml
│   │   └── package.json
│   ├── core-engine/         # TypeScript core (graph builder, serializer, server)
│   │   └── src/
│   │       ├── graph/       # Graph builder (DFS/BFS, cycles, depth)
│   │       ├── serializer/  # JSON, Mermaid, text tree output
│   │       ├── server/      # Stdio JSON server
│   │       ├── config/      # Project configuration loader
│   │       ├── cache/       # Symbol index caching
│   │       ├── inferrer/    # Entry point inference from NL
│   │       ├── tracer/      # Condition/variable tracing
│   │       └── annotations/ # Node annotation persistence
│   ├── graph-viewer/        # Web-based graph visualization (Cytoscape.js)
│   │   └── src/
│   │       ├── graph-renderer.ts  # Cytoscape rendering
│   │       ├── list-view.ts       # Accessible tree view
│   │       ├── search.ts          # Search & filter
│   │       └── ...
│   ├── vscode-extension/    # VS Code / Kiro extension
│   │   └── src/
│   │       ├── extension.ts       # Commands, activation
│   │       ├── engine-process.ts  # Child process management
│   │       └── webview-panel.ts   # Graph Viewer WebView
│   ├── intellij-plugin/     # IntelliJ plugin (Kotlin)
│   │   └── src/main/kotlin/
│   │       ├── actions/     # Menu actions
│   │       ├── engine/      # Core Engine process management
│   │       ├── ui/          # JCEF WebView panel
│   │       └── util/        # Function detection
│   └── cli/                 # Command-line interface
│       └── src/
│           └── index.ts     # CLI entry point
├── .github/workflows/       # CI: native addon builds for 5 platforms
├── .askhagraph.json         # Project configuration (optional)
└── package.json             # Monorepo root (npm workspaces)
```

## Configuration

Create `.askhagraph.json` at your project root (optional):

```json
{
  "include": ["src/**/*", "lib/**/*"],
  "exclude": ["node_modules", "dist", "build", ".git", "**/*.test.*"],
  "defaultDepth": null,
  "defaultFormat": "json",
  "cache": { "maxSizeMB": 500 },
  "timeout": { "seconds": 60 }
}
```

Without a config file, sensible defaults are used (excludes `node_modules`, `dist`, `build`, `.git`, `vendor`, `target`, `__pycache__`, `bin`).

## Supported Languages

| Language | Extensions | Framework Detection |
|----------|-----------|-------------------|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` | Angular, React |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | Express, React |
| Java | `.java` | Spring Boot |
| Rust | `.rs` | — |
| Python | `.py`, `.pyi` | — |
| Go | `.go` | — |
| C# | `.cs` | — |

## Development

```bash
# Run tests
npm test

# Lint
npm run lint

# Format
npm run format

# Watch mode (TypeScript only, not Rust)
npm run test:watch
```

## License

MIT
