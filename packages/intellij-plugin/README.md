# AskhaGraph IntelliJ Plugin

Feature-scoped call graph explorer for multi-language codebases, integrated into IntelliJ IDEs.

## Prerequisites

- JDK 17+
- Gradle 8+ (or use the included wrapper)
- Node.js 18+ (for the Core Engine)
- The Core Engine must be built (`npm run build` in the monorepo root)

## Build

```bash
./gradlew buildPlugin
```

The plugin ZIP will be in `build/distributions/`.

## Run (Development)

```bash
./gradlew runIde
```

This launches a sandboxed IntelliJ instance with the plugin installed.

## Usage

1. Open a project in IntelliJ
2. Place your cursor inside a function/method
3. Use **Ctrl+Shift+G** (or **Tools → AskhaGraph → Analyze Current Function**)
4. The call graph will appear in the AskhaGraph tool window

### Analyze by Feature Description

1. Go to **Tools → AskhaGraph → Analyze Feature...**
2. Enter a natural language description of the feature
3. Select from candidate entry points if multiple are found
4. The call graph will appear in the AskhaGraph tool window

## Architecture

```
┌─────────────────────────────────────────────┐
│  IntelliJ Plugin (Kotlin)                   │
│                                             │
│  ┌─────────────┐    ┌───────────────────┐  │
│  │   Actions    │───▶│  EngineProcess    │  │
│  │  (menu/kbd)  │    │  (ProcessBuilder) │  │
│  └─────────────┘    └────────┬──────────┘  │
│                              │ stdio JSON   │
│  ┌─────────────────────┐    │              │
│  │  GraphViewerPanel    │    │              │
│  │  (JCEF WebView)      │◀───┘              │
│  │  ┌───────────────┐  │                   │
│  │  │ Graph Viewer   │  │                   │
│  │  │ (Cytoscape.js) │  │                   │
│  │  └───────────────┘  │                   │
│  └─────────────────────┘                    │
└─────────────────────────────────────────────┘
         │ stdio JSON
         ▼
┌─────────────────────────────────────────────┐
│  Core Engine (Node.js)                      │
│  - Tree-sitter parsing                      │
│  - Symbol indexing                          │
│  - Call graph construction                  │
└─────────────────────────────────────────────┘
```

## Configuration

The plugin looks for the Core Engine in these locations (in order):

1. `<project>/packages/core-engine/dist/server-entry.js` (monorepo)
2. `<project>/node_modules/@askhagraph/core-engine/dist/server-entry.js`

## Error Handling

- **Timeout**: If the Core Engine doesn't respond within 60 seconds, the process is terminated and a notification with a "Retry" option is shown.
- **Crash**: If the Core Engine exits unexpectedly, pending requests are rejected and a notification with "Retry" is shown.
- **Malformed response**: Invalid JSON responses are logged and an error notification is displayed.

## Development Notes

- The plugin uses JCEF (Chromium Embedded Framework) bundled with IntelliJ 2020.2+
- The Graph Viewer web assets are shared with the VS Code extension
- Bidirectional communication uses `JBCefJSQuery` bridge
- All logging goes through `com.intellij.openapi.diagnostic.Logger`
- User-facing notifications use `NotificationGroupManager`
