/**
 * Child process management for the AskhaGraph Core Engine.
 *
 * Spawns the Core Engine as a child process via ProcessBuilder,
 * communicates via newline-delimited JSON over stdio, and handles
 * timeouts, crashes, and malformed responses.
 */
package com.askhagraph.intellij.engine

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import org.jetbrains.annotations.VisibleForTesting
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Request envelope for stdio communication with the Core Engine.
 */
data class EngineRequest(
    val id: String,
    val type: String,
    val payload: Map<String, Any?>
)

/**
 * Response envelope from the Core Engine.
 */
data class EngineResponse(
    val id: String,
    val type: String,
    val payload: Map<String, Any?>
)

/**
 * Internal tracking for a pending request awaiting a response.
 */
private data class PendingRequest(
    val future: CompletableFuture<EngineResponse>,
    val timeoutMs: Long
)

// ─── EngineProcess ───────────────────────────────────────────────────────────

/**
 * Manages the Core Engine child process lifecycle.
 *
 * Handles spawning, stdio communication, configurable timeouts,
 * crash detection, and malformed response handling.
 */
class EngineProcess(
    private val project: Project,
    private val enginePath: String,
    private val projectRoot: String,
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS
) {
    private var process: Process? = null
    private var writer: OutputStreamWriter? = null
    private var readerThread: Thread? = null
    private val pending = ConcurrentHashMap<String, PendingRequest>()

    @Volatile
    private var running = false

    /**
     * Spawn the Core Engine child process.
     * If already running, this is a no-op.
     */
    fun start() {
        if (running && process?.isAlive == true) {
            return
        }

        LOG.info("Starting Core Engine: $enginePath")
        LOG.info("Working directory: $projectRoot")

        try {
            val processBuilder = ProcessBuilder("node", "--max-old-space-size=4096", enginePath)
                .directory(java.io.File(projectRoot))
                .redirectErrorStream(false)

            processBuilder.environment().putAll(System.getenv())

            process = processBuilder.start()
            writer = OutputStreamWriter(process!!.outputStream, Charsets.UTF_8)
            running = true

            // Start stdout reader thread
            readerThread = Thread({
                readStdout()
            }, "AskhaGraph-EngineReader").apply {
                isDaemon = true
                start()
            }

            // Start stderr reader thread (for logging)
            Thread({
                readStderr()
            }, "AskhaGraph-EngineStderr").apply {
                isDaemon = true
                start()
            }

            // Monitor process lifecycle
            Thread({
                monitorProcess()
            }, "AskhaGraph-EngineMonitor").apply {
                isDaemon = true
                start()
            }

            LOG.info("Core Engine process started (PID: ${process!!.pid()})")
        } catch (e: Exception) {
            LOG.error("Failed to start Core Engine", e)
            running = false
            handleCrash("Failed to start Core Engine: ${e.message}")
        }
    }

    /**
     * Send a request to the Core Engine and wait for the response.
     *
     * @param request The request to send.
     * @return A CompletableFuture that resolves with the engine response.
     */
    fun sendRequest(request: EngineRequest): CompletableFuture<EngineResponse> {
        val future = CompletableFuture<EngineResponse>()

        if (!isRunning()) {
            future.completeExceptionally(
                IllegalStateException("Core Engine process is not running")
            )
            return future
        }

        val pendingRequest = PendingRequest(future, timeoutMs)
        pending[request.id] = pendingRequest

        // Schedule timeout
        CompletableFuture.delayedExecutor(timeoutMs, TimeUnit.MILLISECONDS).execute {
            if (pending.remove(request.id) != null && !future.isDone) {
                LOG.warn("Request ${request.id} timed out after ${timeoutMs}ms")
                future.completeExceptionally(
                    TimeoutException("Request timed out after ${timeoutMs}ms")
                )
                handleTimeout(request.id)
            }
        }

        // Write the request as newline-delimited JSON
        try {
            val json = serializeRequest(request)
            synchronized(this) {
                writer?.write(json + "\n")
                writer?.flush()
            }
        } catch (e: Exception) {
            pending.remove(request.id)
            future.completeExceptionally(
                RuntimeException("Failed to write to engine stdin: ${e.message}", e)
            )
        }

        return future
    }

    /**
     * Stop the Core Engine child process.
     */
    fun stop() {
        if (process?.isAlive == true) {
            LOG.info("Stopping Core Engine process")
            process?.destroy()

            // Give it a moment to terminate gracefully
            if (process?.waitFor(5, TimeUnit.SECONDS) == false) {
                process?.destroyForcibly()
            }
        }

        running = false
        process = null
        writer = null

        // Reject all pending requests
        for ((id, pendingRequest) in pending) {
            pendingRequest.future.completeExceptionally(
                RuntimeException("Core Engine process stopped")
            )
            pending.remove(id)
        }
    }

    /**
     * Check if the Core Engine process is currently running.
     */
    fun isRunning(): Boolean {
        return running && process?.isAlive == true
    }

    // ─── Private Methods ─────────────────────────────────────────────────────────

    private fun readStdout() {
        try {
            val reader = BufferedReader(InputStreamReader(process!!.inputStream, Charsets.UTF_8))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val trimmed = line!!.trim()
                if (trimmed.isNotEmpty()) {
                    onResponseLine(trimmed)
                }
            }
        } catch (e: Exception) {
            if (running) {
                LOG.warn("Error reading engine stdout", e)
            }
        }
    }

    private fun readStderr() {
        try {
            val reader = BufferedReader(InputStreamReader(process!!.errorStream, Charsets.UTF_8))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                LOG.info("[AskhaGraph stderr] ${line!!.trim()}")
            }
        } catch (e: Exception) {
            if (running) {
                LOG.warn("Error reading engine stderr", e)
            }
        }
    }

    private fun monitorProcess() {
        try {
            val exitCode = process?.waitFor() ?: return
            running = false

            LOG.info("Core Engine process exited (code=$exitCode)")

            // If there are pending requests, this is an unexpected crash
            if (pending.isNotEmpty()) {
                handleCrash("Core Engine exited unexpectedly (code=$exitCode)")
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun onResponseLine(line: String) {
        val response: EngineResponse
        try {
            response = deserializeResponse(line)
        } catch (e: Exception) {
            LOG.warn("Malformed response from Core Engine: $line", e)
            handleMalformedResponse(line)
            return
        }

        if (response.id.isEmpty() || response.type.isEmpty()) {
            LOG.warn("Response missing id or type: $line")
            handleMalformedResponse(line)
            return
        }

        // Progress messages don't resolve the pending request
        if (response.type == "progress") {
            LOG.info("Engine progress: ${response.payload}")
            return
        }

        val pendingRequest = pending.remove(response.id)
        if (pendingRequest != null) {
            pendingRequest.future.complete(response)
        } else {
            LOG.warn("Received response for unknown request: ${response.id}")
        }
    }

    private fun handleTimeout(requestId: String) {
        // Kill the unresponsive process
        if (process?.isAlive == true) {
            LOG.warn("Killing unresponsive Core Engine process (request: $requestId)")
            process?.destroyForcibly()
            process = null
            running = false
        }

        showErrorNotification(
            "Core Engine timed out after ${timeoutMs / 1000} seconds.",
            showRetry = true
        )
    }

    private fun handleCrash(reason: String) {
        LOG.error("Core Engine crash: $reason")

        // Reject all pending requests
        for ((id, pendingRequest) in pending) {
            pendingRequest.future.completeExceptionally(
                RuntimeException("Core Engine crashed: $reason")
            )
            pending.remove(id)
        }

        showErrorNotification(
            "Core Engine crashed — $reason",
            showRetry = true
        )
    }

    private fun handleMalformedResponse(rawResponse: String) {
        LOG.error("Malformed response from Core Engine: $rawResponse")

        showErrorNotification(
            "Received malformed response from Core Engine. Check the IDE log for details.",
            showRetry = false
        )
    }

    private fun showErrorNotification(message: String, showRetry: Boolean) {
        val notification = NotificationGroupManager.getInstance()
            .getNotificationGroup(NOTIFICATION_GROUP_ID)
            .createNotification("AskhaGraph: $message", NotificationType.ERROR)

        if (showRetry) {
            notification.addAction(RetryAction(this))
        }

        notification.notify(project)
    }

    companion object {
        private val LOG = Logger.getInstance(EngineProcess::class.java)
        const val DEFAULT_TIMEOUT_MS = 60_000L
        const val NOTIFICATION_GROUP_ID = "AskhaGraph"
    }
}

// ─── JSON Serialization Helpers ──────────────────────────────────────────────

/**
 * Serialize an EngineRequest to JSON string.
 * Uses a minimal manual serialization to avoid external dependencies.
 */
@VisibleForTesting
internal fun serializeRequest(request: EngineRequest): String {
    val payloadJson = serializeMap(request.payload)
    return """{"id":"${escapeJson(request.id)}","type":"${escapeJson(request.type)}","payload":$payloadJson}"""
}

/**
 * Deserialize a JSON string to an EngineResponse.
 */
@VisibleForTesting
internal fun deserializeResponse(json: String): EngineResponse {
    // Simple JSON parsing using regex for the expected flat structure
    val idMatch = """"id"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"""".toRegex().find(json)
    val typeMatch = """"type"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"""".toRegex().find(json)

    val id = idMatch?.groupValues?.get(1)?.unescapeJson() ?: ""
    val type = typeMatch?.groupValues?.get(1)?.unescapeJson() ?: ""

    // Extract payload as a raw map (simplified parsing)
    val payloadMatch = """"payload"\s*:\s*(\{[^}]*\}|\{.*\})""".toRegex().find(json)
    val payload = if (payloadMatch != null) {
        parseSimpleJsonObject(payloadMatch.groupValues[1])
    } else {
        emptyMap()
    }

    return EngineResponse(id = id, type = type, payload = payload)
}

private fun serializeMap(map: Map<String, Any?>): String {
    val entries = map.entries.joinToString(",") { (key, value) ->
        """"${escapeJson(key)}":${serializeValue(value)}"""
    }
    return "{$entries}"
}

private fun serializeValue(value: Any?): String {
    return when (value) {
        null -> "null"
        is String -> "\"${escapeJson(value)}\""
        is Number -> value.toString()
        is Boolean -> value.toString()
        is Map<*, *> -> {
            @Suppress("UNCHECKED_CAST")
            serializeMap(value as Map<String, Any?>)
        }
        is List<*> -> {
            val items = value.joinToString(",") { serializeValue(it) }
            "[$items]"
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

private fun String.unescapeJson(): String {
    return this.replace("\\\"", "\"")
        .replace("\\\\", "\\")
        .replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\t", "\t")
}

private fun parseSimpleJsonObject(json: String): Map<String, Any?> {
    // Simplified JSON object parser for flat key-value pairs
    val result = mutableMapOf<String, Any?>()
    val content = json.trim().removePrefix("{").removeSuffix("}")

    if (content.isBlank()) return result

    val keyValuePattern = """"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*("(?:[^"\\]*(?:\\.[^"\\]*)*)"|null|true|false|-?\d+(?:\.\d+)?)""".toRegex()
    for (match in keyValuePattern.findAll(content)) {
        val key = match.groupValues[1].unescapeJson()
        val rawValue = match.groupValues[2]
        result[key] = when {
            rawValue == "null" -> null
            rawValue == "true" -> true
            rawValue == "false" -> false
            rawValue.startsWith("\"") -> rawValue.removeSurrounding("\"").unescapeJson()
            rawValue.contains(".") -> rawValue.toDoubleOrNull()
            else -> rawValue.toLongOrNull()
        }
    }

    return result
}
