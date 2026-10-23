@file:OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)

package dev.forge.nativeapp.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer as TextSelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.ChatImage
import java.net.URI
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Forge's text-only Markdown surface.  HTML, scripts and remote images are never
 * evaluated: only fenced code, headings, lists, block quotes, simple tables,
 * safe HTTP(S) links and inline emphasis are rendered.
 */
@Composable
fun MessageContent(
    text: String,
    modifier: Modifier = Modifier,
    markdown: Boolean = true,
) {
    val palette = LocalForgePalette.current
    val compact = LocalConfiguration.current.screenWidthDp <= 1000
    val proseSize = if (compact) 17.sp else 16.sp
    val proseLine = if (compact) 30.sp else 28.sp
    if (!markdown) {
        TextSelectionContainer {
            Text(
                text = text,
                modifier = modifier,
                color = palette.textPrimary,
                style = MaterialTheme.typography.bodyLarge.copy(fontSize = proseSize, lineHeight = proseLine),
            )
        }
        return
    }
    val blocks = remember(text) { parseMarkdown(text) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Paragraph -> TextSelectionContainer {
                    Text(
                        text = inlineMarkdown(block.text, palette),
                        color = palette.textPrimary,
                        style = MaterialTheme.typography.bodyLarge.copy(fontSize = proseSize, lineHeight = proseLine),
                    )
                }
                is MdBlock.Heading -> {
                    val size = when (block.level) {
                        1 -> 24.sp
                        2 -> 21.sp
                        3 -> 18.sp
                        else -> 16.sp
                    }
                    Text(
                        text = inlineMarkdown(block.text, palette),
                        color = palette.textPrimary,
                        fontSize = size,
                        lineHeight = size * 1.35f,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                is MdBlock.Code -> CodeBlock(block.language, block.code)
                is MdBlock.Quote -> Row(
                    Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                ) {
                    Box(
                        Modifier.width(2.dp).fillMaxHeight().background(palette.accent.copy(alpha = 0.55f)),
                    )
                    Spacer(Modifier.width(12.dp))
                    TextSelectionContainer(Modifier.weight(1f)) {
                        Text(
                            text = inlineMarkdown(block.text, palette),
                            color = palette.textSecondary,
                            style = MaterialTheme.typography.bodyLarge.copy(fontSize = proseSize, lineHeight = proseLine),
                        )
                    }
                }
                is MdBlock.ListBlock -> {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        block.items.forEachIndexed { index, item ->
                            Row(Modifier.fillMaxWidth()) {
                                Text(
                                    text = if (block.ordered) "${index + 1}." else "•",
                                    modifier = Modifier.width(24.dp),
                                    color = palette.textSecondary,
                                    fontSize = proseSize,
                                    lineHeight = proseLine,
                                    fontFamily = if (block.ordered) FontFamily.Monospace else FontFamily.Default,
                                )
                                TextSelectionContainer(Modifier.weight(1f)) {
                                    Text(
                                        text = inlineMarkdown(item, palette),
                                        color = palette.textPrimary,
                                        style = MaterialTheme.typography.bodyLarge.copy(fontSize = proseSize, lineHeight = proseLine),
                                    )
                                }
                            }
                        }
                    }
                }
                is MdBlock.Table -> MarkdownTable(block, palette)
                MdBlock.Rule -> HorizontalDivider(color = palette.borderSubtle)
            }
        }
    }
}

private sealed interface MdBlock {
    data class Paragraph(val text: String) : MdBlock
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Code(val language: String, val code: String) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class ListBlock(val ordered: Boolean, val items: List<String>) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

private val headingPattern = Regex("^(#{1,6})\\s+(.+)$")
private val rulePattern = Regex("^(-{3,}|\\*{3,}|_{3,})$")
private val unorderedPattern = Regex("^[-*+]\\s+(.+)$")
private val orderedPattern = Regex("^\\d+[.)]\\s+(.+)$")
private val tableSeparatorPattern = Regex("^:?-{2,}:?$")
private val inlinePattern = Regex(
    """(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^()\s]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)""",
)

private fun parseMarkdown(source: String): List<MdBlock> {
    val lines = source.replace("\r\n", "\n").replace('\r', '\n').split('\n')
    val blocks = mutableListOf<MdBlock>()
    val paragraph = mutableListOf<String>()
    var index = 0
    fun flushParagraph() {
        if (paragraph.isEmpty()) return
        blocks += MdBlock.Paragraph(paragraph.joinToString("\n").trim())
        paragraph.clear()
    }
    while (index < lines.size) {
        val line = lines[index]
        val trimmed = line.trim()
        if (line.trimStart().startsWith("```")) {
            flushParagraph()
            val language = line.trimStart().removePrefix("```").trim().take(32)
            val code = mutableListOf<String>()
            index++
            while (index < lines.size && !lines[index].trimStart().startsWith("```")) {
                code += lines[index]
                index++
            }
            if (index < lines.size) index++
            blocks += MdBlock.Code(language, code.joinToString("\n"))
            continue
        }
        if (trimmed.isEmpty()) {
            flushParagraph()
            index++
            continue
        }
        val heading = headingPattern.matchEntire(trimmed)
        if (heading != null) {
            flushParagraph()
            blocks += MdBlock.Heading(heading.groupValues[1].length, heading.groupValues[2])
            index++
            continue
        }
        if (rulePattern.matches(trimmed)) {
            flushParagraph()
            blocks += MdBlock.Rule
            index++
            continue
        }
        if (trimmed.startsWith(">")) {
            flushParagraph()
            val quote = mutableListOf<String>()
            while (index < lines.size && lines[index].trimStart().startsWith(">")) {
                quote += lines[index].trimStart().removePrefix(">").trimStart()
                index++
            }
            blocks += MdBlock.Quote(quote.joinToString("\n"))
            continue
        }
        if (isTableHeader(lines, index)) {
            flushParagraph()
            val header = tableCells(lines[index])
            index += 2
            val rows = mutableListOf<List<String>>()
            while (index < lines.size && lines[index].contains('|') && lines[index].isNotBlank()) {
                val cells = tableCells(lines[index])
                rows += List(header.size) { cell -> cells.getOrElse(cell) { "" } }
                index++
            }
            blocks += MdBlock.Table(header, rows)
            continue
        }
        val unordered = unorderedPattern.matchEntire(trimmed)
        if (unordered != null) {
            flushParagraph()
            val items = mutableListOf<String>()
            while (index < lines.size) {
                val match = unorderedPattern.matchEntire(lines[index].trim()) ?: break
                items += match.groupValues[1]
                index++
            }
            blocks += MdBlock.ListBlock(false, items)
            continue
        }
        val ordered = orderedPattern.matchEntire(trimmed)
        if (ordered != null) {
            flushParagraph()
            val items = mutableListOf<String>()
            while (index < lines.size) {
                val match = orderedPattern.matchEntire(lines[index].trim()) ?: break
                items += match.groupValues[1]
                index++
            }
            blocks += MdBlock.ListBlock(true, items)
            continue
        }
        paragraph += line
        index++
    }
    flushParagraph()
    return blocks
}

private fun isTableHeader(lines: List<String>, index: Int): Boolean {
    if (index + 1 >= lines.size) return false
    val header = lines[index]
    val separator = lines[index + 1]
    if (!header.contains('|') || !separator.contains('|')) return false
    return tableCells(separator).all { it.matches(tableSeparatorPattern) }
}

private fun tableCells(line: String): List<String> =
    line.trim().trim('|').split('|').map { it.trim() }

@Composable
private fun MarkdownTable(table: MdBlock.Table, palette: ForgePalette) {
    val columns = max(table.header.size, table.rows.maxOfOrNull { it.size } ?: 0).coerceAtLeast(1)
    val cellWidth = if (columns <= 2) 150.dp else 120.dp
    val totalWidth: Dp = cellWidth * columns.toFloat()
    Column(
        Modifier.horizontalScroll(rememberScrollState())
            .width(totalWidth)
            .border(1.dp, palette.borderSubtle, RoundedCornerShape(6.dp))
            .clip(RoundedCornerShape(6.dp)),
    ) {
        Row(Modifier.fillMaxWidth().background(palette.soft)) {
            repeat(columns) { column ->
                Text(
                    text = inlineMarkdown(table.header.getOrElse(column) { "" }, palette),
                    modifier = Modifier.width(cellWidth).padding(horizontal = 9.dp, vertical = 8.dp),
                    color = palette.textPrimary,
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        table.rows.forEach { row ->
            HorizontalDivider(color = palette.borderSubtle)
            Row(Modifier.fillMaxWidth()) {
                repeat(columns) { column ->
                    Text(
                        text = inlineMarkdown(row.getOrElse(column) { "" }, palette),
                        modifier = Modifier.width(cellWidth).padding(horizontal = 9.dp, vertical = 8.dp),
                        color = palette.textPrimary,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun CodeBlock(language: String, code: String) {
    val palette = LocalForgePalette.current
    val clipboard = LocalClipboardManager.current
    var copied by remember(code) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1600)
            copied = false
        }
    }
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = palette.soft,
        border = androidx.compose.foundation.BorderStroke(1.dp, palette.borderSubtle),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = language.ifBlank { "代码" },
                    modifier = Modifier.weight(1f),
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                )
                TextButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(code))
                        copied = true
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp),
                    modifier = Modifier.heightIn(min = 40.dp),
                ) {
                    Text(
                        if (copied) "已复制" else "复制代码",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (copied) palette.success else palette.textSecondary,
                    )
                }
            }
            TextSelectionContainer {
                Text(
                    text = code.trimEnd(),
                    modifier = Modifier.horizontalScroll(rememberScrollState())
                        .padding(start = 12.dp, end = 12.dp, top = 2.dp, bottom = 12.dp),
                    color = palette.textPrimary,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                )
            }
        }
    }
}

private fun inlineMarkdown(text: String, palette: ForgePalette): AnnotatedString = buildAnnotatedString {
    var cursor = 0
    inlinePattern.findAll(text).forEach { match ->
        if (match.range.first > cursor) append(text.substring(cursor, match.range.first))
        val bold = match.groupValues[1]
        val code = match.groupValues[2]
        val link = match.groupValues[3]
        val italicStar = match.groupValues[4]
        val italicUnderscore = match.groupValues[5]
        when {
            bold.isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                append(bold.removePrefix("**").removeSuffix("**"))
            }
            code.isNotEmpty() -> withStyle(
                SpanStyle(fontFamily = FontFamily.Monospace, background = palette.soft),
            ) {
                append(code.removePrefix("`").removeSuffix("`"))
            }
            link.isNotEmpty() -> {
                val label = link.substringAfter('[').substringBefore("](")
                val url = link.substringAfter("](").removeSuffix(")")
                if (isSafeHttpUrl(url)) {
                    withLink(LinkAnnotation.Url(url)) {
                        withStyle(
                            SpanStyle(
                                color = palette.link,
                                textDecoration = TextDecoration.Underline,
                            ),
                        ) { append(label.ifBlank { url }) }
                    }
                } else {
                    append(label.ifBlank { url })
                }
            }
            italicStar.isNotEmpty() || italicUnderscore.isNotEmpty() -> {
                val raw = if (italicStar.isNotEmpty()) italicStar else italicUnderscore
                withStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) {
                    append(raw.removePrefix("*").removePrefix("_").removeSuffix("*").removeSuffix("_"))
                }
            }
        }
        cursor = match.range.last + 1
    }
    if (cursor < text.length) append(text.substring(cursor))
}

private fun isSafeHttpUrl(value: String): Boolean = try {
    val uri = URI(value)
    (uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) && !uri.host.isNullOrBlank()
} catch (_: Exception) {
    false
}

private sealed interface ImageLoadState {
    data object Loading : ImageLoadState
    data class Loaded(val image: ImageBitmap) : ImageLoadState
    data class Failed(val reason: String) : ImageLoadState
}

/**
 * Decodes a base64 data URL off the main thread and downsamples it before it
 * reaches Compose.  Non-data URLs, unsupported media and oversized payloads
 * fail closed instead of trusting remote content.
 */
@Composable
fun ForgeImage(
    image: ChatImage,
    modifier: Modifier = Modifier,
    maxDimension: Int = 1600,
) {
    val palette = LocalForgePalette.current
    var load by remember(image.dataUrl, maxDimension) { mutableStateOf<ImageLoadState>(ImageLoadState.Loading) }
    LaunchedEffect(image.dataUrl, maxDimension) {
        load = withContext(Dispatchers.IO) { decodeImageDataUrl(image.dataUrl, maxDimension) }
    }
    when (val state = load) {
        ImageLoadState.Loading -> Box(
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(palette.soft)
                .semantics { contentDescription = "正在读取图片" },
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = palette.accent)
        }
        is ImageLoadState.Loaded -> Image(
            bitmap = state.image,
            contentDescription = image.name.ifBlank { "图片附件" },
            modifier = modifier.clip(RoundedCornerShape(8.dp)).background(palette.soft),
            contentScale = ContentScale.Fit,
        )
        is ImageLoadState.Failed -> Box(
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(palette.soft)
                .padding(8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = state.reason.ifBlank { "图片无法显示" },
                color = palette.textSecondary,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

private fun decodeImageDataUrl(dataUrl: String, maxDimension: Int): ImageLoadState {
    if (!dataUrl.startsWith("data:image/", ignoreCase = true)) {
        return ImageLoadState.Failed("图片数据格式不受支持")
    }
    if (dataUrl.length > 16_000_000) return ImageLoadState.Failed("图片过大，未解码")
    val comma = dataUrl.indexOf(',')
    if (comma <= 5) return ImageLoadState.Failed("图片数据不完整")
    val metadata = dataUrl.substring(5, comma)
    if (!metadata.contains(";base64", ignoreCase = true)) {
        return ImageLoadState.Failed("仅支持 Base64 图片")
    }
    return try {
        val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
        if (bytes.size > 12_000_000) return ImageLoadState.Failed("图片过大，未解码")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return ImageLoadState.Failed("图片无法解码")
        }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxDimension ||
            (bounds.outWidth.toLong() * bounds.outHeight.toLong()) / (sample.toLong() * sample.toLong()) > 6_000_000L
        ) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: return ImageLoadState.Failed("图片无法解码")
        ImageLoadState.Loaded(bitmap.asImageBitmap())
    } catch (_: Throwable) {
        ImageLoadState.Failed("图片无法显示")
    }
}
