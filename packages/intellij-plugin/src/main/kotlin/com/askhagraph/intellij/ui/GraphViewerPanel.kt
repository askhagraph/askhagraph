/**
 * JCEF WebView panel for the AskhaGraph Graph Viewer.
 *
 * Creates a tool window with a JCEF browser component that hosts the same
 * Graph Viewer web application (Cytoscape.js + ELK.js) used by the VS Code extension.
 * Sets up JBCefJSQuery bridge for bidirectional JS ↔ Kotlin communication.
 */
package com.askhagraph.intellij.ui

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.handler.CefLoadHandlerAdapter
import javax.swing.JComponent

/**
 * Manages the JCEF-based Graph Viewer panel.
 *
 * Hosts the Graph Viewer web application and provides bidirectional
 * communication between JavaScript and Kotlin via JBCefJSQuery.
 */
class GraphViewerPanel(private val project: Project) {

    private val browser: JBCefBrowser = JBCefBrowser()
    private val navigateQuery: JBCefJSQuery = JBCefJSQuery.create(browser)
    private val askAiQuery: JBCefJSQuery = JBCefJSQuery.create(browser)
    private val addAnnotationQuery: JBCefJSQuery = JBCefJSQuery.create(browser)

    private var pendingGraphJson: String? = null

    init {
        setupJsBridge()
        loadViewerHtml()
    }

    /**
     * Get the Swing component for embedding in a tool window.
     */
    val component: JComponent
        get() = browser.component

    /**
     * Send graph data to the WebView for rendering.
     *
     * @param graphJson The serialized call graph JSON string.
     */
    fun loadGraph(graphJson: String, hideLibraryCalls: Boolean = true) {
        if (browser.cefBrowser.isLoading) {
            pendingGraphJson = graphJson
        } else {
            executeLoadGraph(graphJson, hideLibraryCalls)
        }
    }

    /**
     * Show a loading indicator in the WebView.
     */
    fun showLoading() {
        val script = """
            (function() {
                window.postMessage({ type: 'showLoading' }, '*');
            })();
        """.trimIndent()
        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    /**
     * Send a find-path request to the WebView to highlight the path between two functions.
     *
     * @param source The source function name.
     * @param target The target function name.
     */
    fun sendFindPath(source: String, target: String) {
        val escapedSource = escapeJs(source)
        val escapedTarget = escapeJs(target)
        val script = """
            (function() {
                window.postMessage({ type: 'findPath', payload: { source: '$escapedSource', target: '$escapedTarget' } }, '*');
            })();
        """.trimIndent()
        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    /**
     * Dispose the panel and clean up resources.
     */
    fun dispose() {
        navigateQuery.dispose()
        askAiQuery.dispose()
        addAnnotationQuery.dispose()
        browser.dispose()
    }

    // ─── Private Methods ─────────────────────────────────────────────────────────

    private fun setupJsBridge() {
        // JS → Kotlin: handle "navigate" messages
        navigateQuery.addHandler { request ->
            handleNavigate(request)
            JBCefJSQuery.Response("")
        }

        // JS → Kotlin: handle "askAi" messages
        askAiQuery.addHandler { request ->
            handleAskAi(request)
            JBCefJSQuery.Response("")
        }

        // JS → Kotlin: handle "addAnnotation" messages
        addAnnotationQuery.addHandler { request ->
            handleAddAnnotation(request)
            JBCefJSQuery.Response("")
        }

        // Inject bridge functions once the page loads
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser?, frame: org.cef.browser.CefFrame?, httpStatusCode: Int) {
                if (frame?.isMain == true) {
                    injectBridgeFunctions()

                    // Load any pending graph data
                    pendingGraphJson?.let { json ->
                        pendingGraphJson = null
                        executeLoadGraph(json, hideLibraryCalls = true)
                    }
                }
            }
        }, browser.cefBrowser)
    }

    private fun injectBridgeFunctions() {
        val navigateJs = navigateQuery.inject(
            "request",
            "function(response) {}",
            "function(errorCode, errorMessage) { console.error('Navigate error:', errorCode, errorMessage); }"
        )

        val askAiJs = askAiQuery.inject(
            "request",
            "function(response) {}",
            "function(errorCode, errorMessage) { console.error('AskAI error:', errorCode, errorMessage); }"
        )

        val addAnnotationJs = addAnnotationQuery.inject(
            "request",
            "function(response) {}",
            "function(errorCode, errorMessage) { console.error('Annotation error:', errorCode, errorMessage); }"
        )

        // Register the bridge on the window object so the Graph Viewer can call it
        val bridgeScript = """
            (function() {
                window.askhaGraphBridge = {
                    navigate: function(payload) {
                        var request = JSON.stringify(payload);
                        $navigateJs
                    },
                    askAi: function(payload) {
                        var request = JSON.stringify(payload);
                        $askAiJs
                    },
                    addAnnotation: function(payload) {
                        var request = JSON.stringify(payload);
                        $addAnnotationJs
                    }
                };

                // Notify the Graph Viewer that the bridge is ready
                if (window.onAskhaGraphBridgeReady) {
                    window.onAskhaGraphBridgeReady();
                }
                window.dispatchEvent(new CustomEvent('askhagraph-bridge-ready'));
            })();
        """.trimIndent()

        browser.cefBrowser.executeJavaScript(bridgeScript, browser.cefBrowser.url, 0)
    }

    private fun executeLoadGraph(graphJson: String, hideLibraryCalls: Boolean = true) {
        // Escape the JSON for embedding in JavaScript
        val escapedJson = graphJson
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")

        val script = """
            (function() {
                var graphData = JSON.parse('$escapedJson');
                var msg = { type: 'loadGraph', payload: graphData, settings: { hideLibraryCalls: $hideLibraryCalls } };
                window.postMessage(msg, '*');
            })();
        """.trimIndent()

        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    private fun handleNavigate(request: String) {
        try {
            // Parse the JSON payload: { "filePath": "...", "line": N, "column": N }
            val filePath = extractJsonString(request, "filePath") ?: return
            val line = extractJsonInt(request, "line") ?: 0
            val column = extractJsonInt(request, "column") ?: 0

            // Open the file in the editor at the specified position
            val virtualFile = LocalFileSystem.getInstance().findFileByPath(filePath)
            if (virtualFile != null) {
                val descriptor = OpenFileDescriptor(
                    project,
                    virtualFile,
                    maxOf(0, line),
                    maxOf(0, column)
                )
                FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
            } else {
                LOG.warn("File not found for navigation: $filePath")
            }
        } catch (e: Exception) {
            LOG.error("Error handling navigate message", e)
        }
    }

    private fun handleAskAi(request: String) {
        try {
            val name = extractJsonString(request, "qualifiedName")
                ?: extractJsonString(request, "name")
                ?: "unknown"
            val filePath = extractJsonString(request, "filePath") ?: ""
            val line = extractJsonInt(request, "line") ?: 0
            val nodeId = extractJsonString(request, "nodeId") ?: ""

            // Compose context for the AI assistant
            val context = buildString {
                appendLine("Analyze this function from the call graph:")
                appendLine("- Name: $name")
                appendLine("- File: $filePath:${line + 1}")
                appendLine("- Node ID: $nodeId")
                appendLine()
                appendLine("Please explain what this function does, its role in the call graph, and any potential issues.")
            }

            // Try to open the AI assistant if available
            // IntelliJ AI Assistant integration varies by IDE version
            LOG.info("AI context for node $nodeId: $context")

            // For now, copy to clipboard as a fallback
            val clipboard = java.awt.Toolkit.getDefaultToolkit().systemClipboard
            val selection = java.awt.datatransfer.StringSelection(context)
            clipboard.setContents(selection, selection)

            com.intellij.notification.NotificationGroupManager.getInstance()
                .getNotificationGroup("AskhaGraph")
                .createNotification(
                    "AskhaGraph: AI context copied to clipboard.",
                    com.intellij.notification.NotificationType.INFORMATION
                )
                .notify(project)
        } catch (e: Exception) {
            LOG.error("Error handling askAi message", e)
        }
    }

    private fun handleAddAnnotation(request: String) {
        try {
            val nodeId = extractJsonString(request, "nodeId") ?: return
            val name = extractJsonString(request, "name") ?: "node"

            LOG.info("Add annotation requested for node: $nodeId ($name)")

            // Annotation persistence is handled by the AnnotationManager
            // For now, send confirmation back to the viewer
            val script = """
                (function() {
                    if (window.askhaGraphViewer && window.askhaGraphViewer.onAnnotationAdded) {
                        window.askhaGraphViewer.onAnnotationAdded({
                            nodeId: '${escapeJs(nodeId)}',
                            text: 'Annotation added',
                            author: 'user',
                            timestamp: new Date().toISOString()
                        });
                    }
                })();
            """.trimIndent()

            browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
        } catch (e: Exception) {
            LOG.error("Error handling addAnnotation message", e)
        }
    }

    private fun loadViewerHtml() {
        // Load the Graph Viewer HTML content
        // In production, this would reference bundled web assets
        val html = buildViewerHtml()
        browser.loadHTML(html)
    }

    private fun buildViewerHtml(): String {
        return """
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>AskhaGraph</title>
                <style>
                    html, body, #ag-root {
                        height: 100%;
                        width: 100%;
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                        background: var(--jb-background, #1e1e1e);
                        color: var(--jb-foreground, #cccccc);
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                    .loading {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        font-size: 14px;
                        opacity: 0.7;
                    }
                </style>
            </head>
            <body>
                <div id="ag-root">
                    <div class="loading">Waiting for graph data...</div>
                </div>
                <script>
                    // The Graph Viewer bundle will be loaded here in production.
                    // For now, set up the bridge listener.
                    window.addEventListener('askhagraph-bridge-ready', function() {
                        console.log('AskhaGraph bridge ready');
                    });

                    // Handle pending data loaded before viewer initializes
                    if (window.__askhaGraphPendingData) {
                        document.getElementById('ag-root').innerHTML =
                            '<div class="loading">Graph data received. Viewer loading...</div>';
                    }
                </script>
            </body>
            </html>
        """.trimIndent()
    }

    companion object {
        private val LOG = Logger.getInstance(GraphViewerPanel::class.java)

        // ─── JSON Helpers ────────────────────────────────────────────────────────

        private fun extractJsonString(json: String, key: String): String? {
            val pattern = """"$key"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"""".toRegex()
            return pattern.find(json)?.groupValues?.get(1)
        }

        private fun extractJsonInt(json: String, key: String): Int? {
            val pattern = """"$key"\s*:\s*(-?\d+)""".toRegex()
            return pattern.find(json)?.groupValues?.get(1)?.toIntOrNull()
        }

        private fun escapeJs(str: String): String {
            return str.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
        }
    }
}
