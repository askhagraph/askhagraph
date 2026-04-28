plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.25"
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "com.askhagraph"
version = "0.1.0"

repositories {
    mavenCentral()
}

intellij {
    version.set("2023.3")
    type.set("IC") // IntelliJ Community
    plugins.set(listOf())
}

// Copy the graph-viewer bundle into plugin resources for JCEF WebView
tasks.register<Copy>("copyGraphViewer") {
    from("../graph-viewer/dist/graph-viewer.bundle.js")
    into("src/main/resources/webview")
}

// Bundle the Core Engine and native addon into plugin resources.
// This makes the IntelliJ plugin standalone — no npm install required.
tasks.register("bundleEngine") {
    group = "build"
    description = "Bundle the Core Engine JS and native addon into plugin resources"

    doLast {
        val engineDestDir = file("src/main/resources/engine")
        val nativeDestDir = file("src/main/resources/engine/native")
        engineDestDir.mkdirs()
        nativeDestDir.mkdirs()

        // Copy the engine bundle (built by esbuild in the vscode-extension build)
        val engineBundle = file("../vscode-extension/dist/engine/engine-bundle.js")
        if (engineBundle.exists()) {
            engineBundle.copyTo(file("${engineDestDir}/engine-bundle.js"), overwrite = true)
            logger.lifecycle("[bundleEngine] Copied engine-bundle.js")
        } else {
            // Fallback: copy the raw server-entry.js (requires npm deps at runtime)
            val serverEntry = file("../core-engine/dist/server-entry.js")
            if (serverEntry.exists()) {
                serverEntry.copyTo(file("${engineDestDir}/engine-bundle.js"), overwrite = true)
                logger.warn("[bundleEngine] engine-bundle.js not found, copied raw server-entry.js (npm deps required)")
            } else {
                logger.warn("[bundleEngine] No engine JS found — plugin will use monorepo/node_modules fallback")
            }
        }

        // Copy native addon loader and binaries
        val nativeSrc = file("../native")
        for (fileName in listOf("index.js", "index.d.ts")) {
            val src = file("${nativeSrc}/${fileName}")
            if (src.exists()) {
                src.copyTo(file("${nativeDestDir}/${fileName}"), overwrite = true)
            }
        }

        // Copy all .node binaries
        nativeSrc.listFiles()?.filter { it.extension == "node" }?.forEach { nodeFile ->
            nodeFile.copyTo(file("${nativeDestDir}/${nodeFile.name}"), overwrite = true)
            logger.lifecycle("[bundleEngine] Copied native binary: ${nodeFile.name}")
        }

        // Also check npm/ subdirectories
        val npmDir = file("${nativeSrc}/npm")
        if (npmDir.exists()) {
            npmDir.listFiles()?.filter { it.isDirectory }?.forEach { platformDir ->
                platformDir.listFiles()?.filter { it.extension == "node" }?.forEach { nodeFile ->
                    nodeFile.copyTo(file("${nativeDestDir}/${nodeFile.name}"), overwrite = true)
                    logger.lifecycle("[bundleEngine] Copied native binary: ${nodeFile.name}")
                }
            }
        }
    }
}

tasks {
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        kotlinOptions.jvmTarget = "17"
        dependsOn("copyGraphViewer", "bundleEngine")
    }

    patchPluginXml {
        sinceBuild.set("233")
        untilBuild.set("243.*")
        changeNotes.set("""
            <ul>
                <li>Initial release: feature-scoped call graph explorer</li>
                <li>7 language support via tree-sitter (TypeScript, JavaScript, Java, Rust, Python, Go, C#)</li>
                <li>Interactive Cytoscape.js graph visualization</li>
                <li>Analysis overlays: complexity, coverage, dead code, change impact, churn, data flow, feature boundaries</li>
            </ul>
        """.trimIndent())
    }

    signPlugin {
        // Configure when ready to publish:
        // certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        // privateKey.set(System.getenv("PRIVATE_KEY"))
        // password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        // Configure when ready to publish:
        // token.set(System.getenv("PUBLISH_TOKEN"))
    }
}
