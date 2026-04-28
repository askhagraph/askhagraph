// @askhagraph/native
// Rust native addon: tree-sitter parser and symbol indexer via napi-rs

#[macro_use]
extern crate napi_derive;

pub mod indexer;
pub mod louvain;
pub mod parser;
pub mod types;

/// Health check function to verify the native addon is loaded.
#[napi]
pub fn ping() -> String {
    "askhagraph-native is loaded".to_string()
}
