/**
 * Resolves the path to the Core Engine entry script.
 *
 * Resolution order:
 *   1. Bundled engine inside the plugin's resources (standalone mode)
 *   2. Monorepo packages directory (dev mode)
 *   3. node_modules (npm-installed mode)
 */
package com.askhagraph.intellij.util

import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.nio.file.Files

object EngineResolver {

    private val LOG = Logger.getInstance(EngineResolver::class.java)

    /**
     * Resolve the engine entry script path for the given project root.
     *
     * @param projectRoot The project's base directory.
     * @return Absolute path to the engine entry JS file.
     */
    fun resolve(projectRoot: String): String {
        // 1. Bundled engine: extracted from plugin resources to a temp directory
        val bundledPath = extractBundledEngine()
        if (bundledPath != null) {
            LOG.info("Using bundled engine at: $bundledPath")
            return bundledPath
        }

        // 2. Monorepo dev mode
        val monorepoPath = "$projectRoot/packages/core-engine/dist/server-entry.js"
        if (File(monorepoPath).exists()) {
            LOG.info("Using monorepo engine at: $monorepoPath")
            return monorepoPath
        }

        // 3. node_modules fallback
        val nodeModulesPath = "$projectRoot/node_modules/@askhagraph/core-engine/dist/server-entry.js"
        if (File(nodeModulesPath).exists()) {
            LOG.info("Using node_modules engine at: $nodeModulesPath")
            return nodeModulesPath
        }

        // Default: return monorepo path (will fail with a clear error)
        LOG.warn("No engine found — falling back to monorepo path: $monorepoPath")
        return monorepoPath
    }

    /**
     * Extract the bundled engine from plugin resources to a temp directory.
     * Returns the path to the extracted engine-bundle.js, or null if not bundled.
     */
    private fun extractBundledEngine(): String? {
        val engineResource = javaClass.getResourceAsStream("/engine/engine-bundle.js") ?: return null

        try {
            val engineDir = Files.createTempDirectory("askhagraph-engine").toFile()
            engineDir.deleteOnExit()

            // Extract engine bundle
            val engineFile = File(engineDir, "engine-bundle.js")
            engineResource.use { input ->
                engineFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }

            // Extract native addon files
            val nativeDir = File(engineDir, "native")
            nativeDir.mkdirs()

            val nativeFiles = listOf("index.js", "index.d.ts")
            for (fileName in nativeFiles) {
                val resource = javaClass.getResourceAsStream("/engine/native/$fileName")
                if (resource != null) {
                    resource.use { input ->
                        File(nativeDir, fileName).outputStream().use { output ->
                            input.copyTo(output)
                        }
                    }
                }
            }

            // Extract .node binaries — try known platform patterns
            val nodePatterns = listOf(
                "askhagraph-native.win32-x64-msvc.node",
                "askhagraph-native.darwin-x64.node",
                "askhagraph-native.darwin-arm64.node",
                "askhagraph-native.darwin-universal.node",
                "askhagraph-native.linux-x64-gnu.node",
                "askhagraph-native.linux-arm64-gnu.node",
            )
            for (pattern in nodePatterns) {
                val resource = javaClass.getResourceAsStream("/engine/native/$pattern")
                if (resource != null) {
                    resource.use { input ->
                        File(nativeDir, pattern).outputStream().use { output ->
                            input.copyTo(output)
                        }
                    }
                }
            }

            return engineFile.absolutePath
        } catch (e: Exception) {
            LOG.warn("Failed to extract bundled engine", e)
            return null
        }
    }
}
