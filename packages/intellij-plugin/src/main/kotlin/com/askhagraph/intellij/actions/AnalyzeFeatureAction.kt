/**
 * Action to analyze a feature by natural language description.
 *
 * Shows an input dialog for the user to describe a feature, sends an
 * analyze_nl request to the Core Engine, handles candidate responses
 * (shows a popup list for selection), and opens the GraphViewerPanel.
 */
package com.askhagraph.intellij.actions

import com.askhagraph.intellij.engine.EngineProcess
import com.askhagraph.intellij.engine.EngineRequest
import com.askhagraph.intellij.ui.GraphViewerService
import com.askhagraph.intellij.util.EngineResolver
import com.askhagraph.intellij.util.JsonSerializer
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.wm.ToolWindowManager
import java.util.UUID

/**
 * IntelliJ action that analyzes a feature from a natural language description.
 *
 * Prompts the user for a feature description, sends it to the Core Engine's
 * entry point inferrer, and displays the resulting call graph.
 */
class AnalyzeFeatureAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        // Show input dialog for feature description
        val description = Messages.showInputDialog(
            project,
            "Describe the feature you want to analyze:",
            "AskhaGraph: Analyze Feature",
            null
        )

        if (description.isNullOrBlank()) {
            return
        }

        LOG.info("Analyzing feature: $description")

        // Run analysis in background
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            "AskhaGraph: Analyzing feature...",
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                indicator.text = "Spawning Core Engine..."

                val projectRoot = project.basePath ?: return
                val enginePath = EngineResolver.resolve(projectRoot)

                val engine = EngineProcess(project, enginePath, projectRoot)
                engine.start()

                if (!engine.isRunning()) {
                    return
                }

                indicator.text = "Inferring entry points..."

                val request = EngineRequest(
                    id = UUID.randomUUID().toString(),
                    type = "analyze_nl",
                    payload = mapOf(
                        "description" to description,
                        "direction" to "downstream"
                    )
                )

                try {
                    // Show loading indicator
                    com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
                        val panel = GraphViewerService.getInstance(project).getPanel()
                        panel?.showLoading()
                    }

                    val response = engine.sendRequest(request).get()

                    when (response.type) {
                        "error" -> {
                            val errorMessage = response.payload["message"] as? String ?: "Unknown error"
                            NotificationGroupManager.getInstance()
                                .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                                .createNotification(
                                    "AskhaGraph: Analysis failed — $errorMessage",
                                    NotificationType.ERROR
                                )
                                .notify(project)
                        }

                        "candidates" -> {
                            // Multiple entry point candidates found — let user choose
                            handleCandidates(engine, response)
                        }

                        "result" -> {
                            // Direct result — show in viewer
                            showResult(response.payload)
                        }

                        else -> {
                            LOG.warn("Unexpected response type: ${response.type}")
                        }
                    }
                } catch (ex: Exception) {
                    LOG.error("Feature analysis request failed", ex)
                    // Error notifications are handled by EngineProcess
                }
            }

            private fun handleCandidates(engine: EngineProcess, response: com.askhagraph.intellij.engine.EngineResponse) {
                @Suppress("UNCHECKED_CAST")
                val candidates = response.payload["candidates"] as? List<Map<String, Any?>> ?: return

                if (candidates.isEmpty()) {
                    NotificationGroupManager.getInstance()
                        .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                        .createNotification(
                            "AskhaGraph: No entry points found for the given description.",
                            NotificationType.WARNING
                        )
                        .notify(project)
                    return
                }

                // Show candidate selection popup on EDT
                com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
                    val candidateNames = candidates.map { candidate ->
                        val name = candidate["name"] as? String ?: "unknown"
                        val filePath = candidate["filePath"] as? String ?: ""
                        val line = candidate["line"] as? Number ?: 0
                        "$name ($filePath:$line)"
                    }

                    JBPopupFactory.getInstance()
                        .createPopupChooserBuilder(candidateNames)
                        .setTitle("Select Entry Point")
                        .setItemChosenCallback { selected ->
                            val selectedIndex = candidateNames.indexOf(selected)
                            if (selectedIndex >= 0) {
                                val candidate = candidates[selectedIndex]
                                analyzeCandidate(engine, candidate)
                            }
                        }
                        .createPopup()
                        .showCenteredInCurrentWindow(project)
                }
            }

            private fun analyzeCandidate(engine: EngineProcess, candidate: Map<String, Any?>) {
                val name = candidate["name"] as? String ?: return
                val filePath = candidate["filePath"] as? String ?: return
                val line = candidate["line"] as? Number ?: return

                ProgressManager.getInstance().run(object : Task.Backgroundable(
                    project,
                    "AskhaGraph: Analyzing $name...",
                    true
                ) {
                    override fun run(indicator: ProgressIndicator) {
                        indicator.isIndeterminate = true

                        val request = EngineRequest(
                            id = UUID.randomUUID().toString(),
                            type = "analyze",
                            payload = mapOf(
                                "entryPoint" to "$filePath:$line:$name",
                                "filePath" to filePath,
                                "functionName" to name,
                                "line" to line,
                                "direction" to "downstream"
                            )
                        )

                        try {
                            val result = engine.sendRequest(request).get()
                            if (result.type == "result") {
                                showResult(result.payload)
                            }
                        } catch (ex: Exception) {
                            LOG.error("Candidate analysis failed", ex)
                        }
                    }
                })
            }

            private fun showResult(payload: Map<String, Any?>) {
                com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
                    val toolWindow = ToolWindowManager.getInstance(project)
                        .getToolWindow("AskhaGraph")
                    toolWindow?.show()

                    val panel = GraphViewerService.getInstance(project).getPanel()
                    if (panel != null) {
                        val graphJson = JsonSerializer.serializePayload(payload)
                        panel.loadGraph(graphJson, hideLibraryCalls = true)
                    }
                }
            }
        })
    }

    override fun update(e: AnActionEvent) {
        // Enable when a project is open
        e.presentation.isEnabledAndVisible = e.project != null
    }

    companion object {
        private val LOG = Logger.getInstance(AnalyzeFeatureAction::class.java)
    }
}
