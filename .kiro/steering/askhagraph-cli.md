---
inclusion: manual
---

# AskhaGraph — Call Graph Analysis

AskhaGraph is a call graph explorer for this project. It analyzes function call flows across TypeScript, JavaScript, Java, Rust, Python, Go, and C#.

## How to Run an Analysis

### From the AskhaGraph CLI Terminal

1. Open the terminal dropdown (`+` button in the terminal panel)
2. Select **"AskhaGraph CLI"** — this opens a PowerShell session with the `askhagraph` command ready
3. Run a command:

```bash
# What does this function call? (downstream)
askhagraph src/checkout.ts:processOrder --format tree

# Who calls this function? (upstream)
askhagraph src/auth.ts:validateToken --direction upstream --format tree

# Full JSON output saved to file
askhagraph src/checkout.ts:processOrder --output graph.json
```

### From the Editor (Visual)

- **Right-click** on a function → **"AskhaGraph: Analyze Current Function"** — opens the graph viewer panel
- **Command palette** → **"AskhaGraph: Analyze Feature..."** — describe a feature in natural language
- **Path finding**: right-click source → "Set as Path Source", right-click target → "Set as Path Target & Analyze"

## Feeding Results to the AI

When you need the AI to answer questions about call flows:

1. Run the CLI analysis with `--format tree` for a readable overview, or `--output graph.json` for full data
2. Paste the tree output into the chat, or attach/reference the JSON file
3. Ask your question — the AI can interpret the graph structure, identify call chains, spot cycles, and explain dependencies

**Example workflow:**
```
User runs:  askhagraph src/checkout.ts:processOrder --format tree
User pastes output into chat
User asks:  "Which of these functions touch the database?"
```

For large graphs, use `--output graph.json` and reference the file rather than pasting — terminal output is limited to ~3,000 lines.

## CLI Reference

### Syntax

```
askhagraph <entry-point> [options]
```

### Entry Point Formats

- **file:function** — `src/checkout.ts:processOrder` (relative or absolute path)
- **function name** — `processOrder` (searches the index for a match)
- **quoted description** — `"user checkout flow"` (fuzzy matches against symbol names)

### Options

| Option | Values | Default | Description |
|---|---|---|---|
| `--format` | `json`, `mermaid`, `tree` | `json` | Output format |
| `--depth` | positive integer | `20` | Maximum traversal depth |
| `--direction` | `downstream`, `upstream`, `bidirectional` | `downstream` | Traversal direction |
| `--show-unresolved` | | | Include unresolved library/external calls (hidden by default) |
| `--output` | file path | stdout | Write output to file instead of stdout |
| `--project` | directory path | cwd | Project root directory |
| `--help` | | | Show usage |
| `--version` | | | Show version |

### Direction Meanings

- **downstream** — "What does this function call?" Follows callees from the entry point.
- **upstream** — "Who calls this function?" Finds all callers recursively.
- **bidirectional** — Both directions combined. Useful for path analysis between two functions.

### Filtering

By default, unresolved nodes (library/external calls like `console.log`, `Array.push`, etc.) are **hidden** from the output. This keeps the graph focused on project code. Use `--show-unresolved` to include them.

### Examples

```bash
# Basic downstream analysis
askhagraph src/checkout.ts:processOrder

# Tree view (best for pasting into AI chat)
askhagraph src/checkout.ts:processOrder --format tree

# Upstream: who calls this function?
askhagraph src/auth.ts:validateToken --direction upstream --format tree

# Mermaid diagram with limited depth
askhagraph src/checkout.ts:processOrder --format mermaid --depth 5

# Save full JSON to file
askhagraph src/checkout.ts:processOrder --output graph.json

# Bidirectional for path analysis
askhagraph src/auth.ts:login --direction bidirectional --format tree

# Analyze a function in another project
askhagraph src/api.ts:handleRequest --project C:\Users\me\OtherProject
```

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (symbol not found, no files, invalid args, native addon missing) |

### Common Errors

- `Could not find symbol matching "X"` — Check the file path and function name. Use `file:function` format for precision.
- `No supported source files found` — Check `--project` path and `.askhagraph.json` include/exclude patterns.
- `Native addon not built` — Run `npm run build` in `packages/native` first.

## JSON Output Schema

The `json` format (default) returns a structured call graph:

```json
{
  "version": "1.0.0",
  "metadata": {
    "projectRoot": "/path/to/project",
    "entryPoint": "processOrder",
    "traversalDirection": "downstream",
    "maxDepth": 20,
    "maxNodes": 500,
    "truncated": false,
    "generatedAt": "2025-01-01T00:00:00.000Z",
    "engineVersion": "0.3.6"
  },
  "nodes": [
    {
      "id": "src/checkout.ts:42:processOrder",
      "name": "processOrder",
      "qualifiedName": "CheckoutService.processOrder",
      "kind": "method",
      "filePath": "src/checkout.ts",
      "line": 42,
      "column": 2,
      "signature": "async processOrder(cart: Cart): Promise<Order>",
      "body": "",
      "metadata": {
        "visibility": "public",
        "isDepthLimited": false,
        "isUnresolved": false,
        "isCycleParticipant": false
      }
    }
  ],
  "edges": [
    {
      "sourceId": "src/checkout.ts:42:processOrder",
      "targetId": "src/payment.ts:10:chargeCard",
      "kind": "call",
      "metadata": {}
    }
  ],
  "overlays": {}
}
```

### Key Fields

- **nodes[].line** — 0-indexed (add +1 for editor display)
- **nodes[].kind** — `function`, `method`, `conditional`, `loop`, `callback`, `unresolved`
- **nodes[].metadata.isUnresolved** — `true` for calls that couldn't be resolved (library/external calls)
- **nodes[].metadata.isDepthLimited** — `true` if traversal stopped at this node due to depth or node cap
- **nodes[].metadata.isCycleParticipant** — `true` if this node is part of a recursive cycle
- **edges[].kind** — `call`, `conditional_flow`, `callback`, `cycle_back_edge`, `depth_limited`
- **metadata.truncated** — `true` if the graph hit the 500-node cap and was truncated

## VS Code Commands (Extension-to-Extension)

These commands are for other VS Code extensions to call programmatically. The AI cannot invoke these directly.

### `askhagraph.analyze`
Returns structured graph JSON.

```typescript
const result = await vscode.commands.executeCommand('askhagraph.analyze', {
  entryPoint: 'src/services/auth.ts:validateToken',
  direction: 'downstream'
});
```

### `askhagraph.analyzeCurrentFunction`
Analyzes the function at the current cursor position. Opens the graph viewer panel.

### `askhagraph.analyzeFeature`
Prompts for a natural language feature description, then analyzes it.

## When to Use What

| Goal | Method |
|---|---|
| Quick visual exploration | Right-click → "Analyze Current Function" |
| AI-assisted analysis | CLI `--format tree`, paste output into chat |
| Large graph investigation | CLI `--output graph.json`, reference file in chat |
| Path between two functions | Editor context menu path source/target, or CLI `--direction bidirectional` |
| CI/scripting/automation | CLI `--format json --output` |
| Diagram for documentation | CLI `--format mermaid` |

## Project Data Files

- **Annotations**: `.askhagraph/annotations.json` — developer notes on graph nodes.
- **Cache**: `.askhagraph/cache/index.json` — symbol index cache. Delete to force a full re-index.
- **Config**: `.askhagraph.json` (project root) — include/exclude patterns, default depth, format, timeout.
