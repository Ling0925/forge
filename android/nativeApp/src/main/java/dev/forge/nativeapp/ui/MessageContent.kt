package dev.forge.nativeapp.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Deliberately text-only Markdown subset: no WebView, HTML, scripts or remote image requests. */
@Composable
fun MessageContent(text: String, markdown: Boolean = true) {
    if (!markdown) {
        SelectionContainer { Text(text, fontSize = 16.sp, lineHeight = 27.sp) }
        return
    }
    val segments = remember(text) { text.split("```") }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        segments.forEachIndexed { index, segment ->
            if (index % 2 == 1) {
                val language = segment.substringBefore('\n').take(32)
                val code = segment.substringAfter('\n', "")
                val clipboard = LocalClipboardManager.current
                Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Column(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth().padding(start = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(language.ifEmpty { "代码" }, Modifier.padding(top = 14.dp), style = MaterialTheme.typography.labelSmall)
                            TextButton(onClick = { clipboard.setText(AnnotatedString(code)) }) { Text("复制代码") }
                        }
                        SelectionContainer {
                            Text(code.trimEnd(), Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),
                                fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 21.sp)
                        }
                    }
                }
            } else if (segment.isNotBlank()) {
                SelectionContainer {
                    Text(inlineMarkdown(segment.trim('\n')), fontSize = 16.sp, lineHeight = 27.sp)
                }
            }
        }
    }
}

private fun inlineMarkdown(text: String): AnnotatedString = buildAnnotatedString {
    text.lines().forEachIndexed { index, line ->
        if (index > 0) append("\n")
        val heading = Regex("^(#{1,4})\\s+(.+)$").matchEntire(line)
        if (heading != null) {
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, fontSize = 19.sp)) { append(heading.groupValues[2]) }
        } else {
            val content = line.replace(Regex("^[-*]\\s+"), "• ")
            var start = 0
            Regex("\\*\\*(.+?)\\*\\*|`([^`]+)`").findAll(content).forEach { match ->
                append(content.substring(start, match.range.first))
                val bold = match.groupValues[1].isNotEmpty()
                withStyle(if (bold) SpanStyle(fontWeight = FontWeight.SemiBold) else SpanStyle(fontFamily = FontFamily.Monospace)) {
                    append(match.groupValues[if (bold) 1 else 2])
                }
                start = match.range.last + 1
            }
            append(content.substring(start))
        }
    }
}
