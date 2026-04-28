---
inclusion: always
---

# Agent Behavior

## Thoroughness & Verification

When asked to fix, replace, or audit something across the codebase:

1. Before making changes, search the entire relevant scope (grep/search all files, not just the ones currently open)
2. List all instances found and fix every one — don't stop after the first few files
3. After making changes, run a verification search to confirm zero remaining instances
4. Report the before/after count so the user can see completeness

When asked to "review for consistency" or "check for issues":
1. Use a subagent or systematic file-by-file scan — don't rely on memory or sampling
2. Create a checklist of what you're checking before you start
3. Report findings as a complete list, not just the first few

Never assume a task is done until you've verified it. "I fixed the ones I saw" is not complete — "I searched all files, found N instances, fixed all N, verified 0 remain" is complete.

## Propose Before Implementing

When a user request is ambiguous, open-ended, or could be solved in multiple reasonable ways, **do not jump straight to implementation**. Instead:

1. Briefly explain the current state or problem
2. Propose 2-4 concrete options with trade-offs
3. Wait for the user to choose before writing code

### When to propose first
- The request describes a problem but not a specific solution
- There are multiple valid approaches with different trade-offs
- The change involves new UI patterns, workflows, or data models
- The request is phrased as a question ("how does X work?", "I don't see a way to...")
- The request asks to "analyze", "investigate", "propose solutions", or "recommend"

### Wait for explicit confirmation
When you present options, **stop and wait for the user to choose**. Do not recommend a combination and start implementing it in the same response. The user needs time to evaluate trade-offs and may want a different combination, a different approach entirely, or may want to discuss further before any code is written.

Even if you have a strong recommendation, present it as a recommendation — not as a decision. Say "I'd recommend A + B, here's why" and then **stop**. Do not proceed until the user says "go ahead", "do it", "yes", or otherwise explicitly confirms.

### When it's fine to implement directly
- The request is a clear-cut bug fix with an obvious solution
- The user explicitly says "fix this" or "do X"
- The change is mechanical (rename, move, update import, swap component)
- The user already chose an approach in a previous message
- The user has explicitly confirmed a proposed approach

### Examples

**Propose first:**
- "I don't see a way to add notes" → Propose options for how notes could work
- "The search feels slow" → Propose debounce, pagination, or caching approaches
- "We need better error handling here" → Propose Toast vs QueryError vs inline

**Implement directly:**
- "Replace the native select with our Radix Select component" → Do it
- "Fix the TypeScript error on line 42" → Do it
- "The save button doesn't persist, wire it up to Supabase" → Do it

## Quality Check Before Completion

Before considering a task complete, briefly scan these perspectives:

**Developer** — Does the code follow existing patterns? Imports from the right locations (shared constants, ui components)? No hardcoded values that should be constants or translations?

**Completeness** — If fixing a pattern across files: did I search ALL files? If adding a new component pattern: did I check if similar components should also be updated? Did I run diagnostics on changed files?

**UX Consistency** — Does the change match the design system (tokens, spacing, colors)? Is the behavior consistent with similar features elsewhere?

**Security** — No sensitive data exposed in client-side code? Input validation and sanitization in place? RLS policies considered for new database operations?


## External API Version Verification

When writing code that calls external APIs (Notion, Stripe, OpenAI, etc.), always verify the latest API version and check for breaking changes before implementation. Use web search to confirm the current API contract.

## Debug Before Patching

When a bug is reported, **trace the full execution path before changing any code**. Do not guess at fixes based on symptoms alone.

### The process:
1. **Map the chain**: Starting from the trigger (e.g., a button click, an API call), trace every function, callback, event listener, and side effect that runs. Follow the data through all layers — not just the immediate handler, but everything it triggers downstream.
2. **Look for cycles**: If the system uses events, callbacks, or pub/sub patterns, check whether any listener triggers an action that re-fires the same event. Circular event chains are a common source of freezes and infinite loops.
3. **Identify the bottleneck**: Is it an infinite loop? Expensive synchronous work? A blocking call? A missing guard? Name the specific cause before proposing a fix.
4. **Fix the root cause**: Address the actual problem, not the symptom. If a circular event loop causes a freeze, add a re-entrancy guard — don't try to mask it with `setTimeout` or `requestAnimationFrame`.

### Anti-patterns to avoid:
- **Symptom patching**: Adding delays, deferring work, or changing focus behavior without understanding why the problem occurs.
- **Guessing at fixes**: Trying multiple surface-level changes hoping one sticks. Each failed attempt wastes the user's time rebuilding and testing.
- **Ignoring connected code**: Fixing a handler in isolation without checking what listeners, sync hooks, or side effects are registered elsewhere in the codebase.

### When you catch yourself guessing:
Stop. Read the code. Trace the chain. Then fix it once.

## Property Test Quality

When creating property tests, every tested function must be imported from the actual source module — not re-implemented or fully mocked in the test. If a test file mocks the entire module it's supposed to test, it has no value.


## Build & Reload Workflow

This project has three build targets that reload differently:
- **graph-viewer bundle** (webview): Reloads on window reload thanks to cache-busting query param.
- **vscode-extension** (extension host): Requires full IDE restart or "Developer: Restart Extension Host" to pick up changes. Window reload is NOT sufficient.
- **core-engine** (child process): Reloads on next analysis request (new process spawned).

Always build graph-viewer BEFORE vscode-extension — the extension build copies the bundle.
Build order: `npm run build --workspace=packages/graph-viewer && npm run build --workspace=packages/vscode-extension`

## Cross-IDE Parity

When adding features to the VS Code extension (`packages/vscode-extension/`), always check if the equivalent functionality needs to be added to the IntelliJ plugin (`packages/intellij-plugin/`). This includes: new commands, message types, webview messages, error handling, and UI features. The graph-viewer webview bundle is shared — only IDE-specific host code differs.

## User-Facing Strings

All user-facing strings in the graph-viewer package must be defined in `packages/graph-viewer/src/constants.ts` under `UI_STRINGS`. Never hardcode display text, toast messages, error messages, or labels in component files. Import from constants instead.

For the VS Code extension and IntelliJ plugin, user-facing strings should be centralized per package (not scattered across action handlers).

## Line Number Convention

- Internal data (SymbolEntry.line, GraphNode.line, CallSite.line): Always 0-indexed (from tree-sitter).
- VS Code Position: 0-indexed (matches internal data — pass directly).
- IntelliJ OpenFileDescriptor: 0-indexed (pass directly, do NOT subtract 1).
- Display labels (UI, tooltips, copy-to-clipboard): Always add +1 for 1-indexed editor display.
- Serialized JSON output: 0-indexed (matches internal data).

## Cytoscape Layout

Always use `cy.elements(':visible').layout(options)` instead of `cy.layout(options)`. The latter includes elements with `display: none` in the layout calculation, causing phantom gaps. This applies to initial render, re-render, and runLayout.

## ELK Layout Options

All ELK `layoutOptions` values must be strings. ELK.js (compiled from Java via GWT) silently ignores non-string values. Use `String(value)` or string literals: `'elk.spacing.nodeNode': '20'` (not `20`).

## Performance Budget

The core engine must handle projects with 10,000+ source files without crashing. Design for lazy/on-demand processing:
- Never parse all project files upfront. Use the LazySymbolIndex for on-demand parsing.
- Avoid holding all parse results in memory simultaneously.
- Cap search operations (ensureSymbolParsed) to prevent unbounded scanning.
- Use import-based resolution (ensureSymbolFromImports) as the primary cross-file resolution strategy.
- The Node.js process is spawned with `--max-old-space-size=4096` but should not need it for normal operation.

## Debug Logging

Temporary `console.log` / `console.error` statements added for debugging must be removed before considering a task complete. Use structured logging (`process.stderr.write` with `[AskhaGraph]` prefix) for permanent diagnostic output in the core engine. The graph-viewer webview should not have `console.log` in production code.
