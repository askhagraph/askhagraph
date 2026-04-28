/**
 * Notification action that retries starting the Core Engine process.
 */
package com.askhagraph.intellij.engine

import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.openapi.actionSystem.AnActionEvent

/**
 * A notification action that restarts the Core Engine when clicked.
 */
class RetryAction(
    private val engineProcess: EngineProcess
) : NotificationAction("Retry") {

    override fun actionPerformed(e: AnActionEvent, notification: Notification) {
        notification.expire()
        engineProcess.start()
    }
}
