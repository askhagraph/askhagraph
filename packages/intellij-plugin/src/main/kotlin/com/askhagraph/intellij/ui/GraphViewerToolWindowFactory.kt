/**
 * Tool window factory for the AskhaGraph Graph Viewer.
 *
 * Registers the Graph Viewer as a tool window in IntelliJ,
 * creating the JCEF panel when the window is opened.
 */
package com.askhagraph.intellij.ui

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/**
 * Factory that creates the AskhaGraph tool window content.
 * Implements DumbAware to be available during indexing.
 */
class GraphViewerToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = GraphViewerPanel(project)
        val content = ContentFactory.getInstance().createContent(
            panel.component,
            "Graph",
            false
        )

        toolWindow.contentManager.addContent(content)

        // Store the panel reference for later use by actions
        GraphViewerService.getInstance(project).setPanel(panel)
    }
}
