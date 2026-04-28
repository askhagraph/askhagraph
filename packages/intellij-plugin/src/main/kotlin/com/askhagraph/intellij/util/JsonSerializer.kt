/**
 * Shared JSON serialization utilities for the AskhaGraph IntelliJ plugin.
 *
 * Provides lightweight serialization without external dependencies,
 * used by both AnalyzeCurrentFunctionAction and AnalyzeFeatureAction.
 */
package com.askhagraph.intellij.util

object JsonSerializer {

    /**
     * Serialize a payload map to a JSON string.
     */
    fun serializePayload(payload: Map<String, Any?>): String {
        return buildString {
            append("{")
            val entries = payload.entries.toList()
            for ((index, entry) in entries.withIndex()) {
                append("\"${escapeJson(entry.key)}\":")
                append(valueToJson(entry.value))
                if (index < entries.size - 1) append(",")
            }
            append("}")
        }
    }

    private fun valueToJson(value: Any?): String {
        return when (value) {
            null -> "null"
            is String -> "\"${escapeJson(value)}\""
            is Number -> value.toString()
            is Boolean -> value.toString()
            is Map<*, *> -> {
                @Suppress("UNCHECKED_CAST")
                serializePayload(value as Map<String, Any?>)
            }
            is List<*> -> {
                "[${value.joinToString(",") { valueToJson(it) }}]"
            }
            else -> "\"${escapeJson(value.toString())}\""
        }
    }

    private fun escapeJson(str: String): String {
        return str.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }
}
