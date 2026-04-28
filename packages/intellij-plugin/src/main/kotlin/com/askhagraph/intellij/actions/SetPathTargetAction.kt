/**
 * Action to set the current function as the path target and trigger analysis.
 *
 * Detects the function at the cursor and stores it as the path target.
 * If a path source is already set, automatically runs a bidirectional
 * analysis from the source and sends a findPath message to the viewer
 * to highlight the path to the target.
 */
package com.askhagraph.intellij.actions

import com.askhagraph.intellij.AskhaGraphPlugin
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
import java.util.UUID

class SetPathTargetAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return

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

        val plugin = AskhaGraphPlugin.getInstance(project)
        val targetEntryPoint = "${detectedFunction.filePath}:${detectedFunction.name}"
        plugin.setPathTarget(targetEntryPoint, detectedFunction.name)

        val source = plugin.pathSource
        if (source == null) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                .createNotification(
                    "AskhaGraph: Path target set to ${detectedFunction.name}. Set a source function first.",
                    NotificationType.INFORMATION
                )
                .notify(project)
            return
        }

        // Both source and target are set — run path analysis
        val sourceName = plugin.pathSourceLabel ?: source.split(":").lastOrNull() ?: source
        val targetName = detectedFunction.name

        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            "AskhaGraph: Finding path $sourceName → $targetName...",
            true
        ) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                indicator.text = "Spawning Core Engine..."

                val projectRoot = project.basePath ?: return
                val enginePath = EngineResolver.resolve(projectRoot)

                val engine = EngineProcess(project, enginePath, projectRoot)
                engine.start()

                if (!engine.isRunning()) return

                indicator.text = "Running bidirectional analysis from $sourceName..."

                val request = EngineRequest(
                    id = UUID.randomUUID().toString(),
                    type = "analyze",
                    payload = mapOf(
                        "entryPoint" to source,
                        "direction" to "bidirectional",
                        "maxDepth" to 20,
                        "includeConditionals" to true,
                        "includeLoops" to true,
                        "includeCallbacks" to true
                    )
                )

                try {
                    val response = engine.sendRequest(request).get()

                    if (response.type == "error") {
                        val errorMessage = response.payload["message"] as? String ?: "Unknown error"
                        NotificationGroupManager.getInstance()
                            .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                            .createNotification(
                                "AskhaGraph: Could not find a path between $sourceName and $targetName. $errorMessage",
                                NotificationType.WARNING
                            )
                            .notify(project)
                        return
                    }

                    // Show graph and send findPath message
                    com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
                        val toolWindow = ToolWindowManager.getInstance(project)
                            .getToolWindow("AskhaGraph")
                        toolWindow?.show()

                        val panel = GraphViewerService.getInstance(project).getPanel()
                        if (panel != null) {
                            // Send findPath FIRST so the webview queues it and shows loading
                            panel.sendFindPath(sourceName, targetName)

                            // Then load the graph — it renders behind the loading overlay
                            // and applies the pending findPath after layout settles
                            val graphJson = JsonSerializer.serializePayload(response.payload)
                            panel.loadGraph(graphJson, hideLibraryCalls = true)
                        }
                    }
                } catch (ex: Exception) {
                    LOG.error("Path analysis request failed", ex)
                    NotificationGroupManager.getInstance()
                        .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
                        .createNotification(
                            "AskhaGraph: Path analysis failed — ${ex.message}",
                            NotificationType.ERROR
                        )
                        .notify(project)
                }
            }
        })
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val psiFile = e.getData(CommonDataKeys.PSI_FILE)
        e.presentation.isEnabledAndVisible = editor != null && psiFile != null

        val project = e.project
        if (project != null) {
            val plugin = AskhaGraphPlugin.getInstance(project)
            val sourceLabel = plugin.pathSourceLabel
            if (sourceLabel != null) {
                e.presentation.text = "Set as Path Target & Analyze (from: $sourceLabel)"
            } else {
                e.presentation.text = "Set as Path Target"
            }
        }
    }

    companion object {
        private val LOG = Logger.getInstance(SetPathTargetAction::class.java)
    }
}
