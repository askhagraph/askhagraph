/**
 * Action to analyze the call graph starting from the function at the cursor.
 *
 * Gets the current editor and caret position, uses FunctionDetector to find
 * the enclosing function, spawns/reuses the Core Engine process, sends an
 * analyze request, and opens the GraphViewerPanel with the result.
 */
package com.askhagraph.intellij.actions

import com.askhagraph.intellij.engine.EngineProcess
import com.askhagraph.intellij.engine.EngineRequest
import com.askhagraph.intellij.ui.GraphViewerService
import com.askhagraph.intellij.util.EngineResolver
import com.askhagraph.intellij.util.FunctionDetector
import com.askhagraph.intellij.util.JsonSerializer
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.psi.PsiDocumentManager
import java.util.UUID

/**
 * IntelliJ action that analyzes the call graph from the function at the cursor.
 *
 * Registered in plugin.xml with keyboard shortcut Ctrl+Shift+G.
 */
class AnalyzeCurrentFunctionAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return

        // Detect the function at the caret
        val detectedFunction = FunctionDetector.detect(editor, psiFile)
        if (detectedFunction == null) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                .createNotification(
                    "AskhaGraph: No function found at cursor position.",
                    NotificationType.WARNING
                )
                .notify(project)
            return
        }

        LOG.info("Analyzing function: ${detectedFunction.name} at ${detectedFunction.filePath}:${detectedFunction.line}")

        // Run analysis in background
        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            "AskhaGraph: Analyzing ${detectedFunction.name}...",
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

                indicator.text = "Sending analysis request..."

                val request = EngineRequest(
                    id = UUID.randomUUID().toString(),
                    type = "analyze",
                    payload = mapOf(
                        "entryPoint" to "${detectedFunction.filePath}:${detectedFunction.line}:${detectedFunction.name}",
                        "filePath" to detectedFunction.filePath,
                        "functionName" to detectedFunction.name,
                        "line" to detectedFunction.line,
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

                    if (response.type == "error") {
                        val errorMessage = response.payload["message"] as? String ?: "Unknown error"
                        NotificationGroupManager.getInstance()
                            .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                            .createNotification(
                                "AskhaGraph: Analysis failed — $errorMessage",
                                NotificationType.ERROR
                            )
                            .notify(project)
                        return
                    }

                    // Open the Graph Viewer tool window and load the result
                    com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
                        val toolWindow = ToolWindowManager.getInstance(project)
                            .getToolWindow("AskhaGraph")
                        toolWindow?.show()

                        val panel = GraphViewerService.getInstance(project).getPanel()
                        if (panel != null) {
                            val graphJson = JsonSerializer.serializePayload(response.payload)
                            panel.loadGraph(graphJson, hideLibraryCalls = true)
                        }
                    }
                } catch (ex: Exception) {
                    LOG.error("Analysis request failed", ex)
                    // Error notifications are handled by EngineProcess
                }
            }
        })
    }

    override fun update(e: AnActionEvent) {
        // Enable only when an editor with a file is active
        val editor = e.getData(CommonDataKeys.EDITOR)
        val psiFile = e.getData(CommonDataKeys.PSI_FILE)
        e.presentation.isEnabledAndVisible = editor != null && psiFile != null
    }

    companion object {
        private val LOG = Logger.getInstance(AnalyzeCurrentFunctionAction::class.java)
    }
}
