/**
 * Action to set the current function as the path source.
 *
 * Detects the function at the cursor and stores it as the path source
 * in the AskhaGraphPlugin service. The user can then set a target
 * to trigger a path analysis.
 */
package com.askhagraph.intellij.actions

import com.askhagraph.intellij.AskhaGraphPlugin
import com.askhagraph.intellij.engine.EngineProcess
import com.askhagraph.intellij.util.FunctionDetector
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys

class SetPathSourceAction : AnAction() {

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

        val entryPoint = "${detectedFunction.filePath}:${detectedFunction.name}"
        val plugin = AskhaGraphPlugin.getInstance(project)
        plugin.setPathSource(entryPoint, detectedFunction.name)

        NotificationGroupManager.getInstance()
            .getNotificationGroup(EngineProcess.NOTIFICATION_GROUP_ID)
            .createNotification(
                "AskhaGraph: Path source set to ${detectedFunction.name}. Now right-click another function → \"Set as Path Target\".",
                NotificationType.INFORMATION
            )
            .notify(project)
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val psiFile = e.getData(CommonDataKeys.PSI_FILE)
        e.presentation.isEnabledAndVisible = editor != null && psiFile != null

        // Show current path source in the action text if set
        val project = e.project
        if (project != null) {
            val plugin = AskhaGraphPlugin.getInstance(project)
            val sourceLabel = plugin.pathSourceLabel
            if (sourceLabel != null) {
                e.presentation.text = "Set as Path Source (current: $sourceLabel)"
            } else {
                e.presentation.text = "Set as Path Source"
            }
        }
    }
}
