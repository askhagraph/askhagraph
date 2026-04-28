/**
 * @module constants
 * Centralized user-facing strings for the AskhaGraph VS Code extension.
 *
 * All warning messages, error messages, info messages, prompts, placeholders,
 * status bar text, and terminal labels should be defined here.
 */

// ─── Error Messages ──────────────────────────────────────────────────────────

export const ERR_NO_ACTIVE_EDITOR =
  'AskhaGraph: No active editor. Open a file and place your cursor in a function.';

export const ERR_NO_FUNCTION_AT_CURSOR =
  'AskhaGraph: Could not detect a function at the cursor position.';

export const ERR_NO_EDITOR =
  'AskhaGraph: No active editor.';

export const ERR_NO_FUNCTION =
  'AskhaGraph: No function found at cursor.';

export const ERR_NO_WORKSPACE =
  'AskhaGraph: No workspace folder open.';

export const ERR_ENGINE_START_FAILED =
  'AskhaGraph: Failed to start Core Engine.';

export const ERR_NO_ENTRY_POINT =
  'AskhaGraph: No entry point or description provided.';

export const ERR_MALFORMED_RESPONSE =
  'AskhaGraph: Received malformed response from Core Engine. Check the AskhaGraph output channel for details.';

export function errAnalysisFailed(message: string): string {
  return `AskhaGraph: Analysis failed — ${message}`;
}

export function errPathNotFound(source: string, target: string): string {
  return `AskhaGraph: Could not find a path between ${source} and ${target}. The source function may not exist in the index.`;
}

export function errEngineTimeout(seconds: number): string {
  return `AskhaGraph: Core Engine timed out after ${seconds} seconds.`;
}

export function errEngineCrash(reason: string): string {
  return `AskhaGraph: Core Engine crashed — ${reason}`;
}

export function errGeneric(message: string): string {
  return `AskhaGraph: ${message}`;
}

// ─── Info Messages ───────────────────────────────────────────────────────────

export function infoPathSourceSet(functionName: string): string {
  return `AskhaGraph: Path source set to ${functionName}`;
}

export function infoPathTargetSet(functionName: string): string {
  return `AskhaGraph: Path target set to ${functionName}. Now set a source function.`;
}

export const INFO_AI_CONTEXT_COPIED =
  'AskhaGraph: AI context copied to clipboard. Paste it into your AI chat (Ctrl+L).';

// ─── Progress & Prompts ──────────────────────────────────────────────────────

export const PROGRESS_ANALYZING = 'AskhaGraph: Analyzing...';

export const PROGRESS_SENDING = 'Sending request to Core Engine...';

export const PROMPT_DESCRIBE_FEATURE = 'Describe the feature to analyze';

export const PLACEHOLDER_FEATURE =
  'e.g., "user checkout flow" or "authentication middleware"';

export const PROMPT_SOURCE_FUNCTION = 'Source function (file:function)';

export const PLACEHOLDER_SOURCE = 'e.g., src/auth.ts:validateToken';

export const PROMPT_TARGET_FUNCTION = 'Target function (file:function)';

export const PLACEHOLDER_TARGET = 'e.g., src/db.ts:query';

export const PLACEHOLDER_ENTRY_POINT = 'Select an entry point';

export function promptAnnotation(name: string, isEdit: boolean): string {
  return isEdit ? `Edit annotation on "${name}"` : `Add annotation to "${name}"`;
}

export const PLACEHOLDER_ANNOTATION = 'Enter annotation text...';

// ─── Status Bar ──────────────────────────────────────────────────────────────

export const STATUSBAR_PATH_READY =
  'AskhaGraph: Path analysis ready. Click to clear.';

export const STATUSBAR_PATH_SOURCE_SET =
  'AskhaGraph: Path source set. Right-click a function → "Set as path target" to analyze.';

export const STATUSBAR_PATH_TARGET_SET =
  'AskhaGraph: Path target set. Right-click a function → "Set as path source" to complete.';

// ─── Terminal / CLI ──────────────────────────────────────────────────────────

export const CLI_TERMINAL_NAME = 'AskhaGraph CLI';

export const CLI_WELCOME_MESSAGE =
  'AskhaGraph CLI ready. Type: askhagraph --help';

// ─── Action Labels ───────────────────────────────────────────────────────────

export const ACTION_RETRY = 'Retry';
