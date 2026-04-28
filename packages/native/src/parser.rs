// @askhagraph/native — Tree-sitter parser implementation
// Parses source files using tree-sitter grammars and extracts symbols, call sites, and conditionals.

use rayon::prelude::*;
use std::fs;
use tree_sitter::{Node, Parser};

use crate::types::{
    NativeCallSite, NativeConditionalNode, NativeFileEntry, NativeParseError, NativeParseResult,
    NativeSymbolEntry,
};

/// Initialize the parser (no-op — grammars are loaded on demand per parse call).
#[napi]
pub fn initialize() {
    // Grammars are loaded on demand when parse_file is called.
    // This function exists for API compatibility.
}

/// Parse a single source file, extracting symbols, call sites, and conditionals.
#[napi]
pub fn parse_file(file_path: String, language_id: String) -> NativeParseResult {
    parse_file_internal(&file_path, &language_id)
}

/// Parse multiple files in parallel using rayon.
#[napi]
pub fn parse_files(files: Vec<NativeFileEntry>) -> Vec<NativeParseResult> {
    files
        .par_iter()
        .map(|entry| parse_file_internal(&entry.file_path, &entry.language_id))
        .collect()
}

/// Check if a file extension maps to a supported language.
#[napi]
pub fn is_supported(extension: String) -> bool {
    extension_to_language(&extension).is_some()
}

// ─── Internal Implementation ─────────────────────────────────────────────────

/// Internal parse implementation shared by parse_file and parse_files.
fn parse_file_internal(file_path: &str, language_id: &str) -> NativeParseResult {
    let mut result = NativeParseResult {
        file_path: file_path.to_string(),
        language_id: language_id.to_string(),
        symbols: Vec::new(),
        call_sites: Vec::new(),
        conditionals: Vec::new(),
        errors: Vec::new(),
    };

    // Read the file
    let source = match fs::read_to_string(file_path) {
        Ok(content) => content,
        Err(err) => {
            result.errors.push(NativeParseError {
                file_path: file_path.to_string(),
                line: 0,
                column: 0,
                message: format!("Failed to read file: {}", err),
            });
            return result;
        }
    };

    // Get the tree-sitter language
    let ts_language = match get_language(language_id) {
        Some(lang) => lang,
        None => {
            eprintln!(
                "Warning: unsupported language '{}' for file '{}'",
                language_id, file_path
            );
            result.errors.push(NativeParseError {
                file_path: file_path.to_string(),
                line: 0,
                column: 0,
                message: format!("Unsupported language: {}", language_id),
            });
            return result;
        }
    };

    // Create parser and set language
    let mut parser = Parser::new();
    if let Err(err) = parser.set_language(&ts_language) {
        result.errors.push(NativeParseError {
            file_path: file_path.to_string(),
            line: 0,
            column: 0,
            message: format!("Failed to set parser language: {}", err),
        });
        return result;
    }

    // Parse the source code
    let tree = match parser.parse(&source, None) {
        Some(tree) => tree,
        None => {
            result.errors.push(NativeParseError {
                file_path: file_path.to_string(),
                line: 0,
                column: 0,
                message: "Failed to parse file (parser returned None)".to_string(),
            });
            return result;
        }
    };

    let root_node = tree.root_node();

    // Check for parse errors in the tree
    if root_node.has_error() {
        collect_error_nodes(&root_node, file_path, &mut result.errors);
    }

    // Extract symbols, call sites, and conditionals by walking the tree
    let source_bytes = source.as_bytes();
    extract_from_node(
        &root_node,
        file_path,
        language_id,
        source_bytes,
        None, // no enclosing class
        &mut result,
    );

    result
}

/// Get the tree-sitter Language for a given language ID.
fn get_language(language_id: &str) -> Option<tree_sitter::Language> {
    match language_id {
        "typescript" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "javascript" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "java" => Some(tree_sitter_java::LANGUAGE.into()),
        "rust" => Some(tree_sitter_rust::LANGUAGE.into()),
        "python" => Some(tree_sitter_python::LANGUAGE.into()),
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        "csharp" => Some(tree_sitter_c_sharp::LANGUAGE.into()),
        _ => None,
    }
}

/// Map file extension to language ID. Returns null if the extension is not supported.
#[napi]
pub fn extension_to_language_id(extension: String) -> Option<String> {
    extension_to_language(&extension).map(|s| s.to_string())
}

/// Internal: Map file extension to language ID (returns &str for internal use).
pub(crate) fn extension_to_language(ext: &str) -> Option<&str> {
    // Strip leading dot if present
    let ext = ext.strip_prefix('.').unwrap_or(ext);
    match ext {
        "ts" | "tsx" | "mts" | "cts" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "java" => Some("java"),
        "rs" => Some("rust"),
        "py" | "pyi" => Some("python"),
        "go" => Some("go"),
        "cs" => Some("csharp"),
        _ => None,
    }
}

// ─── Tree Walking & Extraction ───────────────────────────────────────────────

/// Recursively extract symbols, call sites, and conditionals from a node.
fn extract_from_node(
    node: &Node,
    file_path: &str,
    language_id: &str,
    source: &[u8],
    enclosing_class: Option<&str>,
    result: &mut NativeParseResult,
) {

    // Check if this node is a symbol definition
    if let Some(symbol) = try_extract_symbol(node, file_path, language_id, source, enclosing_class)
    {
        let new_class_name = if symbol.kind == "class" {
            Some(symbol.name.clone())
        } else {
            None
        };

        result.symbols.push(symbol);

        // If this is a class, recurse with the class name as context
        if let Some(ref class_name) = new_class_name {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_from_node(
                    &child,
                    file_path,
                    language_id,
                    source,
                    Some(class_name),
                    result,
                );
            }
            return; // Don't recurse again below
        }
    }

    // Check if this node is a call expression
    if let Some(call_site) = try_extract_call_site(node, file_path, language_id, source) {
        result.call_sites.push(call_site);
    }

    // Check if this node is a conditional
    // Skip if_statement/if_expression nodes that are inside an else_clause — these are
    // "else if" branches already counted by the parent if's branch count.
    let is_else_if = matches!(node.kind(), "if_statement" | "if_expression")
        && node.parent().map_or(false, |p| {
            matches!(p.kind(), "else_clause" | "elif_clause" | "else")
        });
    if !is_else_if {
        if let Some(conditional) = try_extract_conditional(node, file_path, language_id, source) {
            result.conditionals.push(conditional);
        }
    }

    // Recurse into children
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        extract_from_node(&child, file_path, language_id, source, enclosing_class, result);
    }
}

/// Try to extract a symbol definition from a node.
fn try_extract_symbol(
    node: &Node,
    file_path: &str,
    language_id: &str,
    source: &[u8],
    enclosing_class: Option<&str>,
) -> Option<NativeSymbolEntry> {
    let kind = node.kind();

    let symbol_kind = match language_id {
        "typescript" | "javascript" => match kind {
            "function_declaration" | "function" => Some("function"),
            "arrow_function" | "function_expression" => {
                // Check if this is assigned to a variable
                Some("function")
            }
            "method_definition" => {
                // Check for getter/setter/constructor
                let method_kind = get_method_kind_js(node, source);
                Some(method_kind)
            }
            "class_declaration" | "class" => Some("class"),
            _ => None,
        },
        "java" => match kind {
            "method_declaration" => Some("method"),
            "constructor_declaration" => Some("constructor"),
            "class_declaration" => Some("class"),
            _ => None,
        },
        "rust" => match kind {
            "function_item" => Some("function"),
            "struct_item" => Some("class"),
            "impl_item" => Some("class"),
            _ => None,
        },
        "python" => match kind {
            "function_definition" => {
                if enclosing_class.is_some() {
                    Some("method")
                } else {
                    Some("function")
                }
            }
            "class_definition" => Some("class"),
            _ => None,
        },
        "go" => match kind {
            "function_declaration" => Some("function"),
            "method_declaration" => Some("method"),
            _ => None,
        },
        "csharp" => match kind {
            "method_declaration" => Some("method"),
            "constructor_declaration" => Some("constructor"),
            "class_declaration" => Some("class"),
            _ => None,
        },
        _ => None,
    };

    let symbol_kind = symbol_kind?;

    // Extract the name
    let name = extract_symbol_name(node, language_id, source)?;

    // Build qualified name
    let qualified_name = match enclosing_class {
        Some(class_name) => format!("{}.{}", class_name, name),
        None => name.clone(),
    };

    // Extract signature (first line of the definition)
    let signature = get_node_first_line(node, source);

    // Determine visibility
    let visibility = extract_visibility(node, language_id, source);

    let start_pos = node.start_position();
    let end_pos = node.end_position();

    Some(NativeSymbolEntry {
        name,
        qualified_name,
        kind: symbol_kind.to_string(),
        file_path: file_path.to_string(),
        line: start_pos.row as u32,
        column: start_pos.column as u32,
        signature,
        body_start_line: start_pos.row as u32,
        body_end_line: end_pos.row as u32,
        visibility,
        language_id: language_id.to_string(),
    })
}

/// Try to extract a call site from a node.
fn try_extract_call_site(
    node: &Node,
    file_path: &str,
    language_id: &str,
    source: &[u8],
) -> Option<NativeCallSite> {
    let kind = node.kind();

    let is_call = match language_id {
        "typescript" | "javascript" => kind == "call_expression",
        "java" => kind == "method_invocation",
        "rust" => kind == "call_expression",
        "python" => kind == "call",
        "go" => kind == "call_expression",
        "csharp" => kind == "invocation_expression",
        _ => false,
    };

    if !is_call {
        return None;
    }

    // Extract the callee name and the precise column of the function/method name
    let callee_name = extract_callee_name(node, language_id, source)?;
    let name_column = extract_callee_name_column(node, language_id);

    Some(NativeCallSite {
        callee_name,
        file_path: file_path.to_string(),
        line: node.start_position().row as u32,
        column: node.start_position().column as u32,
        name_column: name_column.unwrap_or(node.start_position().column as u32),
    })
}

/// Try to extract a conditional node.
fn try_extract_conditional(
    node: &Node,
    file_path: &str,
    language_id: &str,
    source: &[u8],
) -> Option<NativeConditionalNode> {
    let kind = node.kind();

    let (conditional_kind, branches) = match language_id {
        "typescript" | "javascript" => match kind {
            "if_statement" => ("if", count_if_branches(node)),
            "switch_statement" => ("switch", count_switch_cases(node)),
            "ternary_expression" => ("ternary", 2),
            _ => return None,
        },
        "java" => match kind {
            "if_statement" => ("if", count_if_branches(node)),
            "switch_expression" | "switch_statement" => ("switch", count_switch_cases(node)),
            "ternary_expression" => ("ternary", 2),
            _ => return None,
        },
        "rust" => match kind {
            "if_expression" => ("if", count_if_branches(node)),
            "match_expression" => ("match", count_match_arms(node)),
            _ => return None,
        },
        "python" => match kind {
            "if_statement" => ("if", count_if_branches(node)),
            "match_statement" => ("match", count_match_arms(node)),
            _ => return None,
        },
        "go" => match kind {
            "if_statement" => ("if", count_if_branches(node)),
            "expression_switch_statement" | "type_switch_statement" => {
                ("switch", count_switch_cases(node))
            }
            _ => return None,
        },
        "csharp" => match kind {
            "if_statement" => ("if", count_if_branches(node)),
            "switch_statement" | "switch_expression" => ("switch", count_switch_cases(node)),
            "conditional_expression" => ("ternary", 2),
            _ => return None,
        },
        _ => return None,
    };

    // Extract the condition expression text
    let condition_text = extract_condition_text(node, conditional_kind, source);

    Some(NativeConditionalNode {
        kind: conditional_kind.to_string(),
        file_path: file_path.to_string(),
        line: node.start_position().row as u32,
        column: node.start_position().column as u32,
        end_line: node.end_position().row as u32,
        branches: branches as u32,
        condition_text,
    })
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/// Extract the name of a symbol from its AST node.
fn extract_symbol_name(node: &Node, language_id: &str, source: &[u8]) -> Option<String> {
    let kind = node.kind();

    // For different node types, the name is in different child positions
    match language_id {
        "typescript" | "javascript" => match kind {
            "function_declaration" | "class_declaration" | "class" => {
                node.child_by_field_name("name")
                    .map(|n| node_text(&n, source))
            }
            "method_definition" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            "arrow_function" | "function_expression" | "function" => {
                // Try to get name from parent (variable_declarator)
                if let Some(parent) = node.parent() {
                    if parent.kind() == "variable_declarator" {
                        return parent
                            .child_by_field_name("name")
                            .map(|n| node_text(&n, source));
                    }
                    // Check for pair in object (property assignment)
                    if parent.kind() == "pair" {
                        return parent
                            .child_by_field_name("key")
                            .map(|n| node_text(&n, source));
                    }
                }
                // Anonymous function
                Some("<anonymous>".to_string())
            }
            _ => None,
        },
        "java" => match kind {
            "method_declaration" | "constructor_declaration" | "class_declaration" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            _ => None,
        },
        "rust" => match kind {
            "function_item" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            "struct_item" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            "impl_item" => {
                // For impl blocks, get the type name
                node.child_by_field_name("type")
                    .map(|n| node_text(&n, source))
            }
            _ => None,
        },
        "python" => match kind {
            "function_definition" | "class_definition" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            _ => None,
        },
        "go" => match kind {
            "function_declaration" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            "method_declaration" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            _ => None,
        },
        "csharp" => match kind {
            "method_declaration" | "constructor_declaration" | "class_declaration" => node
                .child_by_field_name("name")
                .map(|n| node_text(&n, source)),
            _ => None,
        },
        _ => None,
    }
}

/// Extract the callee name from a call expression node.
fn extract_callee_name(node: &Node, language_id: &str, source: &[u8]) -> Option<String> {
    match language_id {
        "typescript" | "javascript" => {
            // call_expression has a "function" field
            let func_node = node.child_by_field_name("function")?;
            // For member expressions like this.method(), extract just the method name
            if func_node.kind() == "member_expression" {
                if let Some(prop) = func_node.child_by_field_name("property") {
                    let prop_text = node_text(&prop, source);
                    // Include the object for non-this calls (e.g., "console.log")
                    if let Some(obj) = func_node.child_by_field_name("object") {
                        let obj_text = node_text(&obj, source);
                        if obj_text == "this" || obj_text == "self" {
                            // Strip this./self. — return just the method name
                            return Some(prop_text);
                        }
                    }
                }
            }
            Some(node_text(&func_node, source))
        }
        "java" => {
            // method_invocation: object.method(args) or method(args)
            let name_node = node.child_by_field_name("name")?;
            let name = node_text(&name_node, source);
            // Check for object prefix
            if let Some(obj_node) = node.child_by_field_name("object") {
                let obj = node_text(&obj_node, source);
                Some(format!("{}.{}", obj, name))
            } else {
                Some(name)
            }
        }
        "rust" => {
            // call_expression has a "function" field
            let func_node = node.child_by_field_name("function")?;
            Some(node_text(&func_node, source))
        }
        "python" => {
            // call has a "function" field
            let func_node = node.child_by_field_name("function")?;
            Some(node_text(&func_node, source))
        }
        "go" => {
            // call_expression has a "function" field
            let func_node = node.child_by_field_name("function")?;
            Some(node_text(&func_node, source))
        }
        "csharp" => {
            // invocation_expression: the first child is typically the function/method reference
            let func_node = node.child_by_field_name("function").or_else(|| node.child(0))?;
            Some(node_text(&func_node, source))
        }
        _ => None,
    }
}

/// Extract the precise column of the function/method name in a call expression.
/// For `obj.method()`, returns the column of `method`, not `obj`.
/// For `functionName()`, returns the column of `functionName`.
fn extract_callee_name_column(node: &Node, language_id: &str) -> Option<u32> {
    match language_id {
        "typescript" | "javascript" | "rust" | "go" => {
            let func_node = node.child_by_field_name("function")?;
            // If it's a member expression (obj.method), get the property column
            if func_node.kind() == "member_expression" {
                if let Some(prop) = func_node.child_by_field_name("property") {
                    return Some(prop.start_position().column as u32);
                }
            }
            // If it's a field expression (Rust: obj.method)
            if func_node.kind() == "field_expression" {
                if let Some(field) = func_node.child_by_field_name("field") {
                    return Some(field.start_position().column as u32);
                }
            }
            Some(func_node.start_position().column as u32)
        }
        "java" => {
            // method_invocation: the "name" field is the method name
            if let Some(name_node) = node.child_by_field_name("name") {
                return Some(name_node.start_position().column as u32);
            }
            Some(node.start_position().column as u32)
        }
        "python" => {
            let func_node = node.child_by_field_name("function")?;
            // attribute access: obj.method
            if func_node.kind() == "attribute" {
                if let Some(attr) = func_node.child_by_field_name("attribute") {
                    return Some(attr.start_position().column as u32);
                }
            }
            Some(func_node.start_position().column as u32)
        }
        "csharp" => {
            // invocation_expression → member_access_expression → name
            let func_node = node.child_by_field_name("function").or_else(|| node.child(0))?;
            if func_node.kind() == "member_access_expression" {
                if let Some(name) = func_node.child_by_field_name("name") {
                    return Some(name.start_position().column as u32);
                }
            }
            Some(func_node.start_position().column as u32)
        }
        _ => None,
    }
}

/// Get the text content of a node.
fn node_text(node: &Node, source: &[u8]) -> String {
    node.utf8_text(source).unwrap_or("").to_string()
}

/// Extract the condition expression text from a conditional node.
/// For `if (x > 0)`, returns "x > 0".
/// For `switch (value)`, returns "value".
/// For ternary `a ? b : c`, returns "a".
fn extract_condition_text(node: &Node, conditional_kind: &str, source: &[u8]) -> String {
    match conditional_kind {
        "if" => {
            // Look for the "condition" field or "parenthesized_expression" child
            if let Some(cond) = node.child_by_field_name("condition") {
                let text = node_text(&cond, source);
                // Strip outer parentheses if present
                let trimmed = text.trim();
                if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    return trimmed[1..trimmed.len() - 1].trim().to_string();
                }
                return trimmed.to_string();
            }
            // Fallback: look for parenthesized_expression as first meaningful child
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "parenthesized_expression" {
                    let text = node_text(&child, source);
                    let trimmed = text.trim();
                    if trimmed.starts_with('(') && trimmed.ends_with(')') {
                        return trimmed[1..trimmed.len() - 1].trim().to_string();
                    }
                    return trimmed.to_string();
                }
            }
            String::new()
        }
        "switch" | "match" => {
            // Look for the "value" or "condition" field
            if let Some(val) = node.child_by_field_name("value")
                .or_else(|| node.child_by_field_name("condition"))
                .or_else(|| node.child_by_field_name("subject"))
            {
                let text = node_text(&val, source);
                let trimmed = text.trim();
                if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    return trimmed[1..trimmed.len() - 1].trim().to_string();
                }
                return trimmed.to_string();
            }
            String::new()
        }
        "ternary" => {
            // The first child is typically the condition
            if let Some(cond) = node.child_by_field_name("condition") {
                return node_text(&cond, source).trim().to_string();
            }
            // Fallback: first child
            if let Some(first) = node.child(0) {
                return node_text(&first, source).trim().to_string();
            }
            String::new()
        }
        _ => String::new(),
    }
}

/// Get the first line of a node's text (used as signature).
fn get_node_first_line(node: &Node, source: &[u8]) -> String {
    let text = node_text(node, source);
    text.lines().next().unwrap_or("").to_string()
}

/// Determine the method kind for JS/TS method definitions.
fn get_method_kind_js(node: &Node, source: &[u8]) -> &'static str {
    // Check for getter/setter/constructor by looking at the node text or children
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        let kind = child.kind();
        match kind {
            "get" => return "getter",
            "set" => return "setter",
            _ => {}
        }
        // Check if name is "constructor"
        if child.kind() == "property_identifier" {
            let text = node_text(&child, source);
            if text == "constructor" {
                return "constructor";
            }
        }
    }
    "method"
}

/// Extract visibility from a node based on language conventions.
fn extract_visibility(node: &Node, language_id: &str, source: &[u8]) -> String {
    match language_id {
        "typescript" | "javascript" => {
            // Check for export keyword in parent or preceding siblings
            if let Some(parent) = node.parent() {
                if parent.kind() == "export_statement" {
                    return "public".to_string();
                }
            }
            // Check for accessibility modifier in class members
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                let text = node_text(&child, source);
                match text.as_str() {
                    "public" => return "public".to_string(),
                    "private" => return "private".to_string(),
                    "protected" => return "protected".to_string(),
                    _ => {}
                }
                if child.kind() == "accessibility_modifier" {
                    let mod_text = node_text(&child, source);
                    return mod_text;
                }
            }
            "default".to_string()
        }
        "java" | "csharp" => {
            // Check for modifiers child
            if let Some(modifiers) = node.child_by_field_name("modifiers") {
                let text = node_text(&modifiers, source);
                if text.contains("public") {
                    return "public".to_string();
                } else if text.contains("private") {
                    return "private".to_string();
                } else if text.contains("protected") {
                    return "protected".to_string();
                }
            }
            "default".to_string()
        }
        "rust" => {
            // Check for visibility_modifier child
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "visibility_modifier" {
                    return "public".to_string();
                }
            }
            "default".to_string()
        }
        "python" => {
            // Python uses naming conventions: _private, __dunder__
            let name = extract_symbol_name(node, language_id, source).unwrap_or_default();
            if name.starts_with("__") && name.ends_with("__") {
                "public".to_string() // dunder methods are public
            } else if name.starts_with("__") {
                "private".to_string()
            } else if name.starts_with('_') {
                "protected".to_string()
            } else {
                "public".to_string()
            }
        }
        "go" => {
            // Go uses capitalization: Exported vs unexported
            let name = extract_symbol_name(node, language_id, source).unwrap_or_default();
            if name.chars().next().map_or(false, |c| c.is_uppercase()) {
                "public".to_string()
            } else {
                "default".to_string()
            }
        }
        _ => "default".to_string(),
    }
}

/// Count branches in an if statement (including else-if chains).
fn count_if_branches(node: &Node) -> usize {
    let mut count = 1; // The if branch itself
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "else_clause" | "elif_clause" | "else" => count += 1,
            _ => {}
        }
    }
    count
}

/// Count cases in a switch statement.
fn count_switch_cases(node: &Node) -> usize {
    let mut count = 0;
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "switch_case" | "case_clause" | "switch_default" | "default_clause"
            | "switch_section" => count += 1,
            // For switch body containers
            "switch_body" | "switch_block" => {
                let mut inner_cursor = child.walk();
                for inner_child in child.children(&mut inner_cursor) {
                    match inner_child.kind() {
                        "switch_case" | "case_clause" | "switch_default" | "default_clause"
                        | "switch_section" => count += 1,
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    if count == 0 {
        2 // Default minimum for a switch
    } else {
        count
    }
}

/// Count arms in a match/switch expression (Rust/Python).
fn count_match_arms(node: &Node) -> usize {
    let mut count = 0;
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "match_arm" | "case_clause" => count += 1,
            "match_block" | "block" => {
                let mut inner_cursor = child.walk();
                for inner_child in child.children(&mut inner_cursor) {
                    if inner_child.kind() == "match_arm" || inner_child.kind() == "case_clause" {
                        count += 1;
                    }
                }
            }
            _ => {}
        }
    }
    if count == 0 {
        2 // Default minimum
    } else {
        count
    }
}

/// Collect ERROR nodes from the parse tree.
fn collect_error_nodes(node: &Node, file_path: &str, errors: &mut Vec<NativeParseError>) {
    if node.is_error() || node.is_missing() {
        errors.push(NativeParseError {
            file_path: file_path.to_string(),
            line: node.start_position().row as u32,
            column: node.start_position().column as u32,
            message: "Parse error: unexpected or missing node at this position".to_string(),
        });
        return; // Don't recurse into error nodes
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_error_nodes(&child, file_path, errors);
    }
}
