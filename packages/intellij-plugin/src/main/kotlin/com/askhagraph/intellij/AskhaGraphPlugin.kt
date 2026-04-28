/**
 * AskhaGraph IntelliJ Plugin entry point.
 *
 * Provides project-level lifecycle management for the Core Engine process
 * and Graph Viewer panel. Handles plugin initialization and disposal.
 */
package com.askhagraph.intellij

import com.askhagraph.intellij.engine.EngineProcess
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

/**
 * Project-level service managing the AskhaGraph plugin state.
 *
 * Holds the shared Core Engine process instance and coordinates
 * between actions, the tool window, and the engine.
 */
@Service(Service.Level.PROJECT)
class AskhaGraphPlugin(private val project: Project) {

    private var engineProcess: EngineProcess? = null
    var pathSource: String? = null
        private set
    var pathTarget: String? = null
        private set
    var pathSourceLabel: String? = null
        private set
    var pathTargetLabel: String? = null
        private set

    fun setPathSource(entryPoint: String, label: String) {
        pathSource = entryPoint
        pathSourceLabel = label
    }

    fun setPathTarget(entryPoint: String, label: String) {
        pathTarget = entryPoint
        pathTargetLabel = label
    }

    fun clearPath() {
        pathSource = null
        pathTarget = null
        pathSourceLabel = null
        pathTargetLabel = null
    }

    /**
     * Get or create the shared Core Engine process for this project.
     *
     * @param enginePath Path to the Core Engine entry script.
     * @param timeoutMs Timeout in milliseconds for engine responses.
     * @return The engine process instance.
     */
    fun getOrCreateEngine(
        enginePath: String,
        timeoutMs: Long = EngineProcess.DEFAULT_TIMEOUT_MS
    ): EngineProcess {
        val existing = engineProcess
        if (existing != null && existing.isRunning()) {
            return existing
        }

        val projectRoot = project.basePath ?: throw IllegalStateException("Project has no base path")
        val engine = EngineProcess(project, enginePath, projectRoot, timeoutMs)
        engineProcess = engine
        return engine
    }

    /**
     * Stop the Core Engine process and clean up resources.
     */
    fun dispose() {
        LOG.info("Disposing AskhaGraph plugin for project: ${project.name}")
        engineProcess?.stop()
        engineProcess = null
    }

    companion object {
        private val LOG = Logger.getInstance(AskhaGraphPlugin::class.java)

        fun getInstance(project: Project): AskhaGraphPlugin {
            return project.getService(AskhaGraphPlugin::class.java)
        }
    }
}
