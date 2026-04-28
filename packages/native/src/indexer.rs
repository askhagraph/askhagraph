// @askhagraph/native — Symbol Indexer implementation
// Builds cross-file symbol index from parse results and resolves call sites to definitions.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;

use crate::types::{NativeCallSite, NativeParseResult, NativeSymbolEntry};

// ─── Exported Types ──────────────────────────────────────────────────────────

/// A flattened symbol entry in the cross-file index.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeIndexedSymbol {
    /// Simple name of the symbol.
    pub name: String,
    /// Fully qualified name (e.g., "MyClass.myMethod").
    pub qualified_name: String,
    /// Classification of the symbol (function, method, class, constructor, getter, setter).
    pub kind: String,
    /// File where the symbol is defined.
    pub file_path: String,
    /// Line number of the symbol definition (0-indexed).
    pub line: u32,
    /// Column number of the symbol definition (0-indexed).
    pub column: u32,
    /// Function/method signature string.
    pub signature: String,
    /// Start line of the symbol's body.
    pub body_start_line: u32,
    /// End line of the symbol's body.
    pub body_end_line: u32,
    /// Access visibility (public, private, protected, default).
    pub visibility: String,
    /// Language the symbol was parsed from.
    pub language_id: String,
}

/// An import declaration extracted from a source file.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeImportEntry {
    /// Module specifier or path being imported from.
    pub source: String,
    /// Names of imported bindings.
    pub specifiers: Vec<String>,
    /// File containing the import declaration.
    pub file_path: String,
}

/// An export declaration extracted from a source file.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeExportEntry {
    /// Name of the exported binding.
    pub name: String,
    /// Kind of the exported symbol.
    pub kind: String,
    /// File containing the export declaration.
    pub file_path: String,
}

/// A file path and its content hash for cache invalidation.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeFileHash {
    /// Absolute path to the file.
    pub file_path: String,
    /// SHA-256 content hash of the file.
    pub hash: String,
}

/// The complete cross-file symbol index.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeSymbolIndex {
    /// All symbols flattened from all parsed files.
    pub symbols: Vec<NativeIndexedSymbol>,
    /// All import declarations.
    pub imports: Vec<NativeImportEntry>,
    /// All export declarations.
    pub exports: Vec<NativeExportEntry>,
    /// File path to content hash mapping.
    pub file_hashes: Vec<NativeFileHash>,
}

/// A resolved call site linking a call expression to its definition.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeResolvedCall {
    /// Name of the function or method being called.
    pub callee_name: String,
    /// File where the call occurs.
    pub file_path: String,
    /// Line number of the call expression.
    pub line: u32,
    /// Column number of the call expression.
    pub column: u32,
    /// File where the definition is located (None if unresolved).
    pub resolved_file_path: Option<String>,
    /// Line number of the resolved definition.
    pub resolved_line: Option<u32>,
    /// Resolved symbol name (may differ from callee_name for qualified names).
    pub resolved_name: Option<String>,
    /// Whether the call was successfully resolved to a definition.
    pub is_resolved: bool,
}


// ─── Public API ──────────────────────────────────────────────────────────────

/// Build a cross-file symbol index from parse results.
///
/// Collects all symbols, infers imports/exports, and computes file content hashes.
#[napi]
pub fn build_index(parse_results: Vec<NativeParseResult>) -> NativeSymbolIndex {
    let mut symbols: Vec<NativeIndexedSymbol> = Vec::new();
    let mut imports: Vec<NativeImportEntry> = Vec::new();
    let mut exports: Vec<NativeExportEntry> = Vec::new();
    let mut file_hashes: Vec<NativeFileHash> = Vec::new();

    for result in &parse_results {
        // Collect symbols
        for sym in &result.symbols {
            symbols.push(symbol_entry_to_indexed(sym));
        }

        // Extract imports by reading the source file and scanning for import patterns
        let file_imports = extract_imports_from_file(&result.file_path, &result.language_id);
        imports.extend(file_imports);

        // Extract exports: symbols with "public" visibility or exported markers
        for sym in &result.symbols {
            if sym.visibility == "public" {
                exports.push(NativeExportEntry {
                    name: sym.name.clone(),
                    kind: sym.kind.clone(),
                    file_path: sym.file_path.clone(),
                });
            }
        }

        // Compute file content hash
        if let Some(hash) = compute_file_hash(&result.file_path) {
            file_hashes.push(hash);
        }
    }

    NativeSymbolIndex {
        symbols,
        imports,
        exports,
        file_hashes,
    }
}

/// Incrementally update an existing index with changed file results.
///
/// Removes all entries for changed files, then adds new entries from the changed results.
#[napi]
pub fn update_index(
    existing_index: NativeSymbolIndex,
    changed_results: Vec<NativeParseResult>,
) -> NativeSymbolIndex {
    // Collect the set of changed file paths
    let changed_files: Vec<&str> = changed_results
        .iter()
        .map(|r| r.file_path.as_str())
        .collect();

    // Remove entries for changed files from existing index
    let mut symbols: Vec<NativeIndexedSymbol> = existing_index
        .symbols
        .into_iter()
        .filter(|s| !changed_files.contains(&s.file_path.as_str()))
        .collect();

    let mut imports: Vec<NativeImportEntry> = existing_index
        .imports
        .into_iter()
        .filter(|i| !changed_files.contains(&i.file_path.as_str()))
        .collect();

    let mut exports: Vec<NativeExportEntry> = existing_index
        .exports
        .into_iter()
        .filter(|e| !changed_files.contains(&e.file_path.as_str()))
        .collect();

    let mut file_hashes: Vec<NativeFileHash> = existing_index
        .file_hashes
        .into_iter()
        .filter(|h| !changed_files.contains(&h.file_path.as_str()))
        .collect();

    // Add new entries from changed results
    for result in &changed_results {
        for sym in &result.symbols {
            symbols.push(symbol_entry_to_indexed(sym));
        }

        let file_imports = extract_imports_from_file(&result.file_path, &result.language_id);
        imports.extend(file_imports);

        for sym in &result.symbols {
            if sym.visibility == "public" {
                exports.push(NativeExportEntry {
                    name: sym.name.clone(),
                    kind: sym.kind.clone(),
                    file_path: sym.file_path.clone(),
                });
            }
        }

        if let Some(hash) = compute_file_hash(&result.file_path) {
            file_hashes.push(hash);
        }
    }

    NativeSymbolIndex {
        symbols,
        imports,
        exports,
        file_hashes,
    }
}

/// Resolve call sites to their definitions using the symbol index.
///
/// Resolution strategy:
/// 1. Exact name match in the same file → resolved
/// 2. Name match + import from that file → resolved
/// 3. Qualified name match (e.g., "MyClass.method") → resolved
/// 4. No match → unresolved
#[napi]
pub fn resolve_calls(
    call_sites: Vec<NativeCallSite>,
    index: NativeSymbolIndex,
) -> Vec<NativeResolvedCall> {
    // Build lookup structures for efficient resolution
    let symbols_by_name = build_name_lookup(&index.symbols);
    let imports_by_file = build_imports_by_file(&index.imports);

    call_sites
        .iter()
        .map(|call| resolve_single_call(call, &symbols_by_name, &imports_by_file))
        .collect()
}


// ─── Internal Helpers ────────────────────────────────────────────────────────

/// Convert a NativeSymbolEntry to a NativeIndexedSymbol.
fn symbol_entry_to_indexed(sym: &NativeSymbolEntry) -> NativeIndexedSymbol {
    NativeIndexedSymbol {
        name: sym.name.clone(),
        qualified_name: sym.qualified_name.clone(),
        kind: sym.kind.clone(),
        file_path: sym.file_path.clone(),
        line: sym.line,
        column: sym.column,
        signature: sym.signature.clone(),
        body_start_line: sym.body_start_line,
        body_end_line: sym.body_end_line,
        visibility: sym.visibility.clone(),
        language_id: sym.language_id.clone(),
    }
}

/// Compute SHA-256 hash of a file's contents.
fn compute_file_hash(file_path: &str) -> Option<NativeFileHash> {
    let content = fs::read(file_path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let hash_bytes = hasher.finalize();
    let hash_hex = format!("{:x}", hash_bytes);
    Some(NativeFileHash {
        file_path: file_path.to_string(),
        hash: hash_hex,
    })
}

/// Build a name → symbols lookup map for efficient resolution.
fn build_name_lookup(symbols: &[NativeIndexedSymbol]) -> HashMap<String, Vec<&NativeIndexedSymbol>> {
    let mut map: HashMap<String, Vec<&NativeIndexedSymbol>> = HashMap::new();
    for sym in symbols {
        map.entry(sym.name.clone()).or_default().push(sym);
        // Also index by qualified name for "Class.method" lookups
        if sym.qualified_name != sym.name {
            map.entry(sym.qualified_name.clone())
                .or_default()
                .push(sym);
        }
    }
    map
}

/// Build a file_path → imports lookup map.
fn build_imports_by_file(imports: &[NativeImportEntry]) -> HashMap<String, Vec<&NativeImportEntry>> {
    let mut map: HashMap<String, Vec<&NativeImportEntry>> = HashMap::new();
    for imp in imports {
        map.entry(imp.file_path.clone()).or_default().push(imp);
    }
    map
}

/// Resolve a single call site to its definition.
fn resolve_single_call<'a>(
    call: &NativeCallSite,
    symbols_by_name: &HashMap<String, Vec<&'a NativeIndexedSymbol>>,
    imports_by_file: &HashMap<String, Vec<&NativeImportEntry>>,
) -> NativeResolvedCall {
    let callee = &call.callee_name;

    // Strategy 1: Exact name match in the same file
    if let Some(candidates) = symbols_by_name.get(callee) {
        // Prefer same-file match
        if let Some(same_file) = candidates.iter().find(|s| s.file_path == call.file_path) {
            return NativeResolvedCall {
                callee_name: call.callee_name.clone(),
                file_path: call.file_path.clone(),
                line: call.line,
                column: call.column,
                resolved_file_path: Some(same_file.file_path.clone()),
                resolved_line: Some(same_file.line),
                resolved_name: Some(same_file.name.clone()),
                is_resolved: true,
            };
        }

        // Strategy 2: Name match + import from that file
        if let Some(file_imports) = imports_by_file.get(&call.file_path) {
            for candidate in candidates {
                // Check if the calling file imports from the candidate's file
                let is_imported = file_imports.iter().any(|imp| {
                    // Check if the import source matches the candidate's file path
                    // (simplified: check if the import source is a suffix of the file path
                    //  or if the specifiers include the candidate name)
                    imp.specifiers.contains(&candidate.name)
                        || path_matches_import(&candidate.file_path, &imp.source)
                });

                if is_imported {
                    return NativeResolvedCall {
                        callee_name: call.callee_name.clone(),
                        file_path: call.file_path.clone(),
                        line: call.line,
                        column: call.column,
                        resolved_file_path: Some(candidate.file_path.clone()),
                        resolved_line: Some(candidate.line),
                        resolved_name: Some(candidate.name.clone()),
                        is_resolved: true,
                    };
                }
            }
        }

        // Strategy 3: If there's only one candidate globally, resolve to it
        if candidates.len() == 1 {
            let candidate = candidates[0];
            return NativeResolvedCall {
                callee_name: call.callee_name.clone(),
                file_path: call.file_path.clone(),
                line: call.line,
                column: call.column,
                resolved_file_path: Some(candidate.file_path.clone()),
                resolved_line: Some(candidate.line),
                resolved_name: Some(candidate.name.clone()),
                is_resolved: true,
            };
        }
    }

    // Strategy 4: Try qualified name match (e.g., "obj.method" → "Class.method")
    // Extract the method part from a member expression like "obj.method"
    if let Some(dot_pos) = callee.rfind('.') {
        let method_name = &callee[dot_pos + 1..];
        if let Some(candidates) = symbols_by_name.get(method_name) {
            // Look for a qualified name that ends with this method
            for candidate in candidates {
                if candidate.qualified_name.ends_with(method_name)
                    && candidate.qualified_name.contains('.')
                {
                    return NativeResolvedCall {
                        callee_name: call.callee_name.clone(),
                        file_path: call.file_path.clone(),
                        line: call.line,
                        column: call.column,
                        resolved_file_path: Some(candidate.file_path.clone()),
                        resolved_line: Some(candidate.line),
                        resolved_name: Some(candidate.qualified_name.clone()),
                        is_resolved: true,
                    };
                }
            }
        }
    }

    // Unresolved
    NativeResolvedCall {
        callee_name: call.callee_name.clone(),
        file_path: call.file_path.clone(),
        line: call.line,
        column: call.column,
        resolved_file_path: None,
        resolved_line: None,
        resolved_name: None,
        is_resolved: false,
    }
}

/// Check if a file path matches an import source specifier.
/// Handles relative paths and module names.
fn path_matches_import(file_path: &str, import_source: &str) -> bool {
    // Normalize: strip quotes from import source
    let source = import_source.trim_matches(|c| c == '\'' || c == '"');

    // Direct path match (with or without extension)
    if file_path.ends_with(source) {
        return true;
    }

    // Strip extension from file_path and check
    let without_ext = strip_extension(file_path);
    if without_ext.ends_with(source) {
        return true;
    }

    // Handle relative imports: strip leading "./" or "../"
    let normalized_source = source
        .strip_prefix("./")
        .or_else(|| source.strip_prefix("../"))
        .unwrap_or(source);

    // Check if the file path contains the normalized source
    if file_path.contains(normalized_source) {
        return true;
    }

    // Check without extension
    if without_ext.contains(normalized_source) {
        return true;
    }

    false
}

/// Strip the file extension from a path.
fn strip_extension(path: &str) -> &str {
    if let Some(dot_pos) = path.rfind('.') {
        // Make sure the dot is after the last path separator
        let last_sep = path.rfind('/').unwrap_or(0);
        if dot_pos > last_sep {
            return &path[..dot_pos];
        }
    }
    path
}

/// Extract import declarations from a source file by reading and scanning it.
///
/// This is a lightweight regex-free scanner that looks for common import patterns
/// across supported languages.
fn extract_imports_from_file(file_path: &str, language_id: &str) -> Vec<NativeImportEntry> {
    let source = match fs::read_to_string(file_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };

    match language_id {
        "typescript" | "javascript" => extract_js_imports(&source, file_path),
        "python" => extract_python_imports(&source, file_path),
        "java" => extract_java_imports(&source, file_path),
        "rust" => extract_rust_imports(&source, file_path),
        "go" => extract_go_imports(&source, file_path),
        "csharp" => extract_csharp_imports(&source, file_path),
        _ => Vec::new(),
    }
}

/// Extract import statements from TypeScript/JavaScript source.
fn extract_js_imports(source: &str, file_path: &str) -> Vec<NativeImportEntry> {
    let mut imports = Vec::new();

    for line in source.lines() {
        let trimmed = line.trim();

        // Match: import { X, Y } from 'module'
        // Match: import X from 'module'
        // Match: import * as X from 'module'
        if trimmed.starts_with("import ") {
            if let Some(entry) = parse_js_import_line(trimmed, file_path) {
                imports.push(entry);
            }
        }

        // Match: const X = require('module')
        if trimmed.contains("require(") {
            if let Some(entry) = parse_require_line(trimmed, file_path) {
                imports.push(entry);
            }
        }
    }

    imports
}

/// Parse a single JS/TS import line into a NativeImportEntry.
fn parse_js_import_line(line: &str, file_path: &str) -> Option<NativeImportEntry> {
    // Extract the module source (between quotes)
    let source = extract_quoted_string(line)?;

    // Extract specifiers
    let specifiers = extract_js_specifiers(line);

    Some(NativeImportEntry {
        source,
        specifiers,
        file_path: file_path.to_string(),
    })
}

/// Parse a require() line into a NativeImportEntry.
fn parse_require_line(line: &str, file_path: &str) -> Option<NativeImportEntry> {
    // Find require('...')
    let req_start = line.find("require(")?;
    let after_req = &line[req_start + 8..];
    let source = extract_quoted_string(after_req)?;

    // Try to extract the variable name
    let mut specifiers = Vec::new();
    if let Some(eq_pos) = line.find('=') {
        let before_eq = line[..eq_pos].trim();
        // Handle: const X = require(...) or const { X, Y } = require(...)
        if let Some(name) = before_eq.strip_prefix("const ") {
            let name = name
                .strip_prefix("let ")
                .or_else(|| name.strip_prefix("var "))
                .unwrap_or(name)
                .trim();
            if name.starts_with('{') && name.ends_with('}') {
                // Destructured: { X, Y }
                let inner = &name[1..name.len() - 1];
                for spec in inner.split(',') {
                    let spec = spec.trim();
                    if !spec.is_empty() {
                        specifiers.push(spec.to_string());
                    }
                }
            } else {
                specifiers.push(name.to_string());
            }
        }
    }

    Some(NativeImportEntry {
        source,
        specifiers,
        file_path: file_path.to_string(),
    })
}

/// Extract specifiers from a JS/TS import statement.
fn extract_js_specifiers(line: &str) -> Vec<String> {
    let mut specifiers = Vec::new();

    // Remove "import " prefix
    let rest = line.strip_prefix("import ").unwrap_or(line);

    // Check for: import { X, Y } from ...
    if let Some(brace_start) = rest.find('{') {
        if let Some(brace_end) = rest.find('}') {
            let inner = &rest[brace_start + 1..brace_end];
            for spec in inner.split(',') {
                let spec = spec.trim();
                // Handle "X as Y" — use the local name (Y)
                let name = if let Some(as_pos) = spec.find(" as ") {
                    spec[as_pos + 4..].trim()
                } else {
                    spec
                };
                if !name.is_empty() {
                    specifiers.push(name.to_string());
                }
            }
            return specifiers;
        }
    }

    // Check for: import * as X from ...
    if let Some(star_pos) = rest.find("* as ") {
        let after_as = &rest[star_pos + 5..];
        if let Some(space_pos) = after_as.find(' ') {
            let name = &after_as[..space_pos];
            specifiers.push(name.to_string());
            return specifiers;
        }
    }

    // Check for: import X from ... (default import)
    if let Some(from_pos) = rest.find(" from ") {
        let before_from = rest[..from_pos].trim();
        // Skip if it starts with "type" (TypeScript type-only import)
        let name = before_from.strip_prefix("type ").unwrap_or(before_from);
        if !name.is_empty() && !name.contains('{') && !name.contains('*') {
            specifiers.push(name.to_string());
        }
    }

    specifiers
}

/// Extract Python import statements.
fn extract_python_imports(source: &str, file_path: &str) -> Vec<NativeImportEntry> {
    let mut imports = Vec::new();

    for line in source.lines() {
        let trimmed = line.trim();

        // Match: from module import X, Y
        if trimmed.starts_with("from ") {
            if let Some(entry) = parse_python_from_import(trimmed, file_path) {
                imports.push(entry);
            }
        }
        // Match: import module
        else if trimmed.starts_with("import ") {
            let rest = &trimmed[7..];
            let modules: Vec<String> = rest
                .split(',')
                .map(|m| {
                    let m = m.trim();
                    // Handle "module as alias"
                    if let Some(as_pos) = m.find(" as ") {
                        m[..as_pos].trim().to_string()
                    } else {
                        m.to_string()
                    }
                })
                .filter(|m| !m.is_empty())
                .collect();

            for module in &modules {
                imports.push(NativeImportEntry {
                    source: module.clone(),
                    specifiers: vec![module.clone()],
                    file_path: file_path.to_string(),
                });
            }
        }
    }

    imports
}

/// Parse a Python "from X import Y" line.
fn parse_python_from_import(line: &str, file_path: &str) -> Option<NativeImportEntry> {
    // from module import X, Y
    let rest = line.strip_prefix("from ")?;
    let import_pos = rest.find(" import ")?;
    let module = rest[..import_pos].trim().to_string();
    let specs_str = &rest[import_pos + 8..];

    let specifiers: Vec<String> = specs_str
        .split(',')
        .map(|s| {
            let s = s.trim();
            if let Some(as_pos) = s.find(" as ") {
                s[as_pos + 4..].trim().to_string()
            } else {
                s.to_string()
            }
        })
        .filter(|s| !s.is_empty() && s != "*")
        .collect();

    Some(NativeImportEntry {
        source: module,
        specifiers,
        file_path: file_path.to_string(),
    })
}

/// Extract Java import statements.
fn extract_java_imports(source: &str, file_path: &str) -> Vec<NativeImportEntry> {
    let mut imports = Vec::new();

    for line in source.lines() {
        let trimmed = line.trim();

        // Match: import com.example.ClassName;
        if trimmed.starts_with("import ") && trimmed.ends_with(';') {
            let path = trimmed[7..trimmed.len() - 1].trim();
            // Skip static imports for now
            let path = path.strip_prefix("static ").unwrap_or(path);
            let class_name = path.rsplit('.').next().unwrap_or(path).to_string();

            imports.push(NativeImportEntry {
                source: path.to_string(),
                specifiers: vec![class_name],
                file_path: file_path.to_string(),
            });
        }
    }

    imports
}

/// Extract Rust use declarations.
fn extract_rust_imports(source: &str, file_path: &str) -> Vec<NativeImportEntry> {
    let mut imports = Vec::new();

    for line in source.lines() {
        let trimmed = line.trim();

        // Match: use crate::module::Item;
        // Match: use std::collections::HashMap;
        if trimmed.starts_with("use ") && trimmed.ends_with(';') {
            let path = trimmed[4..trimmed.len() - 1].trim();

            // Handle grouped imports: use module::{A, B};
            if let Some(brace_start) = path.find('{') {
                if let Some(brace_end) = path.find('}') {
                    let prefix = &path[..brace_start];
                    let inner = &path[brace_start + 1..brace_end];
                    let specifiers: Vec<String> = inner
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();

                    imports.push(NativeImportEntry {
                        source: prefix.trim_end_matches("::").to_string(),
                        specifiers,
                        file_path: file_path.to_string(),
                    });
                }
            } else {
                // Simple use: use module::Item
                let item = path.rsplit("::").next().unwrap_or(path).to_string();
                imports.push(NativeImportEntry {
                    source: path.to_string(),
                    specifiers: vec![item],
                    file_path: file_path.to_string(),
                });
            }
        }
    }

    imports
}

/// Extract Go import statements.
fn extract_go_imports(source: &str, file_path: &str) -> Vec<NativeImportEntry> {
    let mut imports = Vec::new();
    let mut in_import_block = false;

    for line in source.lines() {
        let trimmed = line.trim();

        // Single import: import "fmt"
        if trimmed.starts_with("import \"") || trimmed.starts_with("import `") {
            if let Some(source_path) = extract_quoted_string(trimmed) {
                let pkg_name = source_path.rsplit('/').next().unwrap_or(&source_path).to_string();
                imports.push(NativeImportEntry {
                    source: source_path,
                    specifiers: vec![pkg_name],
                    file_path: file_path.to_string(),
                });
            }
        }

        // Import block: import ( ... )
        if trimmed == "import (" {
            in_import_block = true;
            continue;
        }
        if in_import_block {
            if trimmed == ")" {
                in_import_block = false;
                continue;
            }
            if let Some(source_path) = extract_quoted_string(trimmed) {
                let pkg_name = source_path.rsplit('/').next().unwrap_or(&source_path).to_string();
                imports.push(NativeImportEntry {
                    source: source_path,
                    specifiers: vec![pkg_name],
                    file_path: file_path.to_string(),
                });
            }
        }
    }

    imports
}

/// Extract C# using directives.
fn extract_csharp_imports(source: &str, file_path: &str) -> Vec<NativeImportEntry> {
    let mut imports = Vec::new();

    for line in source.lines() {
        let trimmed = line.trim();

        // Match: using System.Collections.Generic;
        if trimmed.starts_with("using ") && trimmed.ends_with(';') && !trimmed.contains('=') {
            let ns = trimmed[6..trimmed.len() - 1].trim();
            // Skip "using static ..."
            let ns = ns.strip_prefix("static ").unwrap_or(ns);
            let last_part = ns.rsplit('.').next().unwrap_or(ns).to_string();

            imports.push(NativeImportEntry {
                source: ns.to_string(),
                specifiers: vec![last_part],
                file_path: file_path.to_string(),
            });
        }
    }

    imports
}

/// Extract the first quoted string (single or double quotes) from text.
fn extract_quoted_string(text: &str) -> Option<String> {
    // Try double quotes first
    if let Some(start) = text.find('"') {
        if let Some(end) = text[start + 1..].find('"') {
            return Some(text[start + 1..start + 1 + end].to_string());
        }
    }
    // Try single quotes
    if let Some(start) = text.find('\'') {
        if let Some(end) = text[start + 1..].find('\'') {
            return Some(text[start + 1..start + 1 + end].to_string());
        }
    }
    // Try backticks (Go)
    if let Some(start) = text.find('`') {
        if let Some(end) = text[start + 1..].find('`') {
            return Some(text[start + 1..start + 1 + end].to_string());
        }
    }
    None
}
