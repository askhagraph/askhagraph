/**
 * Utility to detect the function or method at the current caret position.
 *
 * Uses IntelliJ's PSI (Program Structure Interface) to find the enclosing
 * function/method definition. Falls back to regex-based detection if PSI
 * isn't available for the language.
 */
package com.askhagraph.intellij.util

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.util.PsiTreeUtil

/**
 * Result of function detection at a caret position.
 */
data class DetectedFunction(
    val name: String,
    val qualifiedName: String?,
    val filePath: String,
    val line: Int,
    val column: Int
)

/**
 * Detects the function or method at the caret position in an editor.
 */
object FunctionDetector {

    private val LOG = Logger.getInstance(FunctionDetector::class.java)

    // Regex patterns for common function declarations across languages
    private val FUNCTION_PATTERNS = listOf(
        // TypeScript/JavaScript: function name(...) or const name = (...) =>
        """(?:export\s+)?(?:async\s+)?function\s+(\w+)""".toRegex(),
        """(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(""".toRegex(),
        // Java/Kotlin: visibility modifier + return type + name(
        """(?:public|private|protected|internal)?\s*(?:static\s+)?(?:suspend\s+)?(?:fun|void|int|long|String|boolean|[\w<>\[\]]+)\s+(\w+)\s*\(""".toRegex(),
        // Python: def name(
        """def\s+(\w+)\s*\(""".toRegex(),
        // Rust: fn name(
        """(?:pub\s+)?(?:async\s+)?fn\s+(\w+)""".toRegex(),
        // Go: func name( or func (receiver) name(
        """func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(""".toRegex(),
        // C#: visibility + return type + name(
        """(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(""".toRegex(),
    )

    /**
     * Detect the function at the caret position using PSI.
     *
     * @param editor The active editor.
     * @param psiFile The PSI file for the editor's document.
     * @return The detected function, or null if no function is found.
     */
    fun detect(editor: Editor, psiFile: PsiFile): DetectedFunction? {
        val offset = editor.caretModel.offset
        val filePath = psiFile.virtualFile?.path ?: return null

        // Try PSI-based detection first
        val psiResult = detectViaPsi(psiFile, offset, filePath)
        if (psiResult != null) {
            return psiResult
        }

        // Fall back to regex-based detection
        return detectViaRegex(editor, filePath)
    }

    /**
     * Detect function using IntelliJ's PSI tree.
     */
    private fun detectViaPsi(psiFile: PsiFile, offset: Int, filePath: String): DetectedFunction? {
        try {
            val element = psiFile.findElementAt(offset) ?: return null

            // Walk up the PSI tree looking for a function/method declaration
            var current: PsiElement? = element
            while (current != null) {
                val functionName = extractFunctionName(current)
                if (functionName != null) {
                    val lineNumber = getLineNumber(psiFile, current.textOffset)
                    val column = getColumnNumber(psiFile, current.textOffset)
                    val qualifiedName = buildQualifiedName(current, functionName)

                    return DetectedFunction(
                        name = functionName,
                        qualifiedName = qualifiedName,
                        filePath = filePath,
                        line = lineNumber,
                        column = column
                    )
                }
                current = current.parent
            }
        } catch (e: Exception) {
            LOG.debug("PSI-based detection failed, falling back to regex", e)
        }

        return null
    }

    /**
     * Extract a function name from a PSI element if it represents a function/method.
     * Uses class name matching since specific PSI classes vary by language plugin.
     */
    private fun extractFunctionName(element: PsiElement): String? {
        val className = element.javaClass.simpleName

        // Common PSI element class names for function declarations
        val functionClassNames = setOf(
            "KtNamedFunction",      // Kotlin
            "PsiMethod",            // Java
            "JSFunction",           // JavaScript
            "TypeScriptFunction",   // TypeScript
            "PyFunction",           // Python
            "GoFunctionDeclaration", // Go
            "RsFunction",           // Rust
        )

        if (className in functionClassNames || className.contains("Function") || className.contains("Method")) {
            // Try to get the name via reflection (PsiNamedElement interface)
            try {
                val nameMethod = element.javaClass.getMethod("getName")
                val name = nameMethod.invoke(element) as? String
                if (!name.isNullOrBlank()) {
                    return name
                }
            } catch (_: Exception) {
                // Method not available
            }

            // Try getNameIdentifier
            try {
                val nameIdMethod = element.javaClass.getMethod("getNameIdentifier")
                val nameId = nameIdMethod.invoke(element) as? PsiElement
                if (nameId != null) {
                    return nameId.text
                }
            } catch (_: Exception) {
                // Method not available
            }
        }

        return null
    }

    /**
     * Build a qualified name (e.g., "ClassName.methodName") from the PSI tree.
     */
    private fun buildQualifiedName(element: PsiElement, functionName: String): String? {
        // Walk up to find an enclosing class
        var parent = element.parent
        while (parent != null) {
            val parentClassName = parent.javaClass.simpleName
            if (parentClassName.contains("Class") || parentClassName.contains("Object")) {
                try {
                    val nameMethod = parent.javaClass.getMethod("getName")
                    val className = nameMethod.invoke(parent) as? String
                    if (!className.isNullOrBlank()) {
                        return "$className.$functionName"
                    }
                } catch (_: Exception) {
                    // Not available
                }
            }
            parent = parent.parent
        }
        return null
    }

    /**
     * Detect function using regex patterns on the current line and surrounding context.
     */
    private fun detectViaRegex(editor: Editor, filePath: String): DetectedFunction? {
        val document = editor.document
        val caretLine = editor.caretModel.logicalPosition.line

        // Search from the caret line upward for a function declaration
        for (lineOffset in 0..20) {
            val lineNum = caretLine - lineOffset
            if (lineNum < 0) break

            val lineStart = document.getLineStartOffset(lineNum)
            val lineEnd = document.getLineEndOffset(lineNum)
            val lineText = document.getText(com.intellij.openapi.util.TextRange(lineStart, lineEnd))

            for (pattern in FUNCTION_PATTERNS) {
                val match = pattern.find(lineText)
                if (match != null) {
                    val name = match.groupValues[1]
                    return DetectedFunction(
                        name = name,
                        qualifiedName = null,
                        filePath = filePath,
                        line = lineNum + 1, // 1-indexed
                        column = match.range.first + 1
                    )
                }
            }
        }

        return null
    }

    private fun getLineNumber(psiFile: PsiFile, offset: Int): Int {
        val document = com.intellij.psi.PsiDocumentManager.getInstance(psiFile.project)
            .getDocument(psiFile) ?: return 1
        return document.getLineNumber(offset) + 1 // 1-indexed
    }

    private fun getColumnNumber(psiFile: PsiFile, offset: Int): Int {
        val document = com.intellij.psi.PsiDocumentManager.getInstance(psiFile.project)
            .getDocument(psiFile) ?: return 1
        val lineNumber = document.getLineNumber(offset)
        return offset - document.getLineStartOffset(lineNumber) + 1 // 1-indexed
    }
}
