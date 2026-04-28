/**
 * Project-level service for managing the Graph Viewer panel instance.
 *
 * Provides access to the active GraphViewerPanel from actions and other components.
 */
package com.askhagraph.intellij.ui

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

/**
 * Service that holds a reference to the active GraphViewerPanel.
 * Allows actions to send graph data to the viewer.
 */
@Service(Service.Level.PROJECT)
class GraphViewerService {

    private var panel: GraphViewerPanel? = null

    /**
     * Set the active panel reference.
     */
    fun setPanel(panel: GraphViewerPanel) {
        this.panel = panel
    }

    /**
     * Get the active panel, or null if not yet created.
     */
    fun getPanel(): GraphViewerPanel? = panel

    companion object {
        fun getInstance(project: Project): GraphViewerService {
            return project.getService(GraphViewerService::class.java)
        }
    }
}
