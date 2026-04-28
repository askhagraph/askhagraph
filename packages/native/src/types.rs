// @askhagraph/native — Shared types for FFI boundary
// These structs are exposed to TypeScript via napi-rs #[napi(object)]

/// Result of parsing a single source file.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeParseResult {
    /// Absolute path to the parsed file.
    pub file_path: String,
    /// Detected or overridden language of the file.
    pub language_id: String,
    /// Symbols (functions, methods, classes) extracted from the file.
    pub symbols: Vec<NativeSymbolEntry>,
    /// Call expressions found in the file.
    pub call_sites: Vec<NativeCallSite>,
    /// Conditional/branching nodes found in the file.
    pub conditionals: Vec<NativeConditionalNode>,
    /// Parse errors encountered during analysis.
    pub errors: Vec<NativeParseError>,
}

/// A symbol (function, method, class) extracted from source code.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeSymbolEntry {
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

/// A call expression found in source code.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeCallSite {
    /// Name of the function or method being called.
    pub callee_name: String,
    /// File where the call occurs.
    pub file_path: String,
    /// Line number of the call expression.
    pub line: u32,
    /// Column number of the call expression start.
    pub column: u32,
    /// Column number of the actual function/method name (for precise navigation).
    /// For `obj.method()`, this points to `method`, not `obj`.
    pub name_column: u32,
}

/// A conditional or branching node in source code.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeConditionalNode {
    /// Type of conditional construct (if, switch, ternary, match).
    pub kind: String,
    /// File where the conditional occurs.
    pub file_path: String,
    /// Line number of the conditional (0-indexed).
    pub line: u32,
    /// Column number of the conditional (0-indexed).
    pub column: u32,
    /// End line of the conditional's body (0-indexed, from tree-sitter end_position).
    pub end_line: u32,
    /// Number of branches in the conditional.
    pub branches: u32,
    /// The condition expression text (e.g., "this.webviewReady", "cart.isEmpty()").
    pub condition_text: String,
}

/// An error encountered during file parsing.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeParseError {
    /// File where the error occurred.
    pub file_path: String,
    /// Line number of the error.
    pub line: u32,
    /// Column number of the error.
    pub column: u32,
    /// Human-readable error message.
    pub message: String,
}

/// A file entry for batch parsing.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeFileEntry {
    /// Absolute path to the file.
    pub file_path: String,
    /// Language identifier for the file.
    pub language_id: String,
}
