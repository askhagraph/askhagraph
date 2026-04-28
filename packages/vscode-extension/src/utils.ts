/**
 * @module utils
 * Utility functions for the AskhaGraph VS Code extension.
 */

import * as vscode from 'vscode';

/**
 * Simple heuristic to find the function/method name at or above the cursor position.
 * Scans upward from the cursor line looking for function/method declaration patterns.
 *
 * @param document - The active text document.
 * @param position - The cursor position.
 * @returns The function name if found, or undefined.
 */
export function findFunctionAtCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): string | undefined {
  // Patterns for function/method declarations across supported languages
  const patterns = [
    // TypeScript/JavaScript: function name(...), async function name(...)
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
    // TypeScript/JavaScript: name(...) { (method in class)
    /^\s*(?:public|private|protected|static|async|override|\*)*\s*(\w+)\s*\(/,
    // TypeScript/JavaScript: const name = (...) => or const name = function
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,
    // Python: def name(...)
    /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
    // Java/C#: visibility type name(...)
    /(?:public|private|protected|static|final|abstract|override|virtual|async)\s+\S+\s+(\w+)\s*\(/,
    // Rust: fn name(...)
    /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[<(]/,
    // Go: func name(...)
    /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
  ];

  // Scan upward from cursor position
  for (let line = position.line; line >= 0; line--) {
    const text = document.lineAt(line).text;

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match?.[1]) {
        // Skip common keywords that might match
        const name = match[1];
        if (['if', 'else', 'for', 'while', 'switch', 'catch', 'return', 'new', 'class'].includes(name)) {
          continue;
        }
        return name;
      }
    }
  }

  return undefined;
}

/**
 * Get the workspace folder root path.
 *
 * @returns The workspace root path, or undefined if no workspace is open.
 */
export function getProjectRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return undefined;
}
