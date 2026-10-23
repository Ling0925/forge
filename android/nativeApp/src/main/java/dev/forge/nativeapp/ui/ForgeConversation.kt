package dev.forge.nativeapp.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.Approval
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatMessage
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The single reading-flow scroll container.  It follows streaming output only
 * while the reader is near the tail, keeps history paging explicit, and never
 * optimistically marks a request or approval as complete.
 */
@Composable
fun ForgeConversation(
    state: ChatUiState,
    actions: ChatActions,
    modifier: Modifier = Modifier,
) {
    val palette = LocalForgePalette.current
    val compact = LocalConfiguration.current.screenWidthDp <= 1000
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val connected = state.connection == ConnectionPhase.Connected
    var follow by remember(state.selectedId) { mutableStateOf(true) }
    val dragged by listState.interactionSource.collectIsDraggedAsState()
    val nearBottom by remember { derivedStateOf { !listState.canScrollForward } }
    val tailIndex = (if (state.hasEarlier) 1 else 0) + state.messages.size + state.approvals.size
    val hasItems = state.hasEarlier || state.messages.isNotEmpty() || state.approvals.isNotEmpty()
    val last = state.messages.lastOrNull()

    LaunchedEffect(dragged) { if (dragged) follow = false }
    LaunchedEffect(nearBottom, dragged) { if (nearBottom && !dragged) follow = true }
    LaunchedEffect(
        state.selectedId,
        last?.text?.length,
        last?.reasoning?.length,
        last?.isStreaming,
        state.approvals.size,
        tailIndex,
    ) {
        if (follow && hasItems) {
            listState.scrollToItem(tailIndex)
        }
    }

    if (state.messages.isEmpty() && state.approvals.isEmpty() && state.run == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("这个会话还没有消息", color = palette.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Text(
                    "在下方写下第一条任务；发送前不会执行任何操作。",
                    color = palette.textSecondary,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                )
            }
        }
        return
    }

    Box(modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().testTag("transcript"),
            contentPadding = PaddingValues(
                start = if (compact) 16.dp else 32.dp,
                end = if (compact) 16.dp else 32.dp,
                top = if (compact) 12.dp else 20.dp,
                bottom = 16.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(if (compact) 20.dp else 24.dp),
        ) {
            if (state.hasEarlier) {
                item(key = "earlier") {
                    TextButton(
                        onClick = {
                            follow = false
                            actions.loadEarlier()
                        },
                        enabled = connected && !state.loadingEarlier,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("earlier"),
                    ) {
                        if (state.loadingEarlier) {
                            CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 1.5.dp)
                            Spacer(Modifier.width(7.dp))
                        }
                        Text(if (state.loadingEarlier) "正在读取更早消息…" else "加载更早的消息", fontSize = 12.sp)
                    }
                }
            }
            items(state.messages, key = { it.key }) { message ->
                MessageRow(message, compact)
            }
            items(state.approvals, key = { "approval-${it.id}" }) { approval ->
                ApprovalCard(
                    approval = approval,
                    enabled = connected && !state.busy && !state.uncertain,
                    onAnswer = { approved -> actions.answerApproval(approval.id, approved) },
                )
            }
            item(key = "tail") { Spacer(Modifier.height(2.dp)) }
        }
        if (!nearBottom) {
            Surface(
                onClick = {
                    follow = true
                    scope.launch { listState.animateScrollToItem(tailIndex.coerceAtLeast(0)) }
                },
                shape = CircleShape,
                color = palette.elevated,
                contentColor = palette.textSecondary,
                border = BorderStroke(1.dp, palette.borderSubtle),
                shadowElevation = 3.dp,
                modifier = Modifier.align(Alignment.BottomEnd).padding(14.dp).size(44.dp)
                    .testTag("scroll-latest"),
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.KeyboardArrowDown,
                        contentDescription = "回到最新消息",
                        tint = palette.textSecondary,
                        modifier = Modifier.size(19.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageRow(message: ChatMessage, compact: Boolean) {
    val palette = LocalForgePalette.current
    val user = message.role == "user"
    var reasoningOpen by remember(message.key) { mutableStateOf(false) }
    var toolOpen by remember(message.key) { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth()) {
        if (message.reasoning.isNotBlank()) {
            ReasoningBlock(
                message = message,
                open = reasoningOpen,
                onToggle = { reasoningOpen = !reasoningOpen },
            )
            Spacer(Modifier.height(8.dp))
        }
        if (message.role == "tool") {
            ToolBlock(
                message = message,
                open = toolOpen,
                onToggle = { toolOpen = !toolOpen },
            )
            Spacer(Modifier.height(8.dp))
        } else if (user) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = palette.soft,
                contentColor = palette.textPrimary,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    AuthorRow(
                        label = "你",
                        accent = palette.accent,
                        streaming = false,
                        copyText = message.text,
                        compact = compact,
                    )
                    if (message.text.isNotBlank()) {
                        MessageContent(message.text, markdown = true)
                    }
                    MessageImages(message, compact)
                    if (message.toolName.isNotBlank()) {
                        ToolCallHint(message.toolName)
                    }
                }
            }
        } else {
            if (message.text.isNotBlank() || message.isStreaming) {
                AuthorRow(
                    label = "Forge",
                    accent = if (message.isStreaming) palette.accent else palette.borderHover,
                    streaming = message.isStreaming,
                    copyText = message.text,
                    compact = compact,
                )
            }
            if (message.text.isNotBlank()) {
                MessageContent(message.text, markdown = true)
            } else if (message.isStreaming) {
                Text(
                    "正在回复…",
                    color = palette.textMuted,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                )
            }
            MessageImages(message, compact)
            if (message.toolName.isNotBlank()) {
                ToolCallHint(message.toolName)
            }
        }
    }
}

@Composable
private fun AuthorRow(
    label: String,
    accent: Color,
    streaming: Boolean,
    copyText: String,
    compact: Boolean,
) {
    val palette = LocalForgePalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = if (compact) 44.dp else 26.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(accent))
        Spacer(Modifier.width(6.dp))
        Text(
            label,
            color = palette.textMuted,
            fontSize = 12.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
        )
        if (streaming) {
            Spacer(Modifier.width(7.dp))
            Text("正在回复", color = palette.accent, fontSize = 10.sp)
        }
        Spacer(Modifier.weight(1f))
        if (copyText.isNotBlank()) {
            CopyMessageButton(copyText)
        }
    }
}

@Composable
private fun CopyMessageButton(text: String) {
    val palette = LocalForgePalette.current
    val clipboard = LocalClipboardManager.current
    var copied by remember(text) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1600)
            copied = false
        }
    }
    TextButton(
        onClick = {
            clipboard.setText(AnnotatedString(text))
            copied = true
        },
        contentPadding = PaddingValues(horizontal = 6.dp),
        modifier = Modifier.heightIn(min = 44.dp),
    ) {
        if (copied) {
            Icon(Icons.Default.Check, null, tint = palette.success, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(
            if (copied) "已复制" else "复制",
            fontSize = 10.sp,
            color = if (copied) palette.success else palette.textMuted,
        )
    }
}

@Composable
private fun ReasoningBlock(message: ChatMessage, open: Boolean, onToggle: () -> Unit) {
    val palette = LocalForgePalette.current
    val summary = message.reasoning.lineSequence().lastOrNull { it.isNotBlank() }.orEmpty()
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable(onClick = onToggle)
                .padding(horizontal = 4.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (message.isStreaming) "思考中" else "思考过程",
                color = palette.textSecondary,
                fontSize = 11.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Medium,
            )
            if (!open && summary.isNotBlank()) {
                Spacer(Modifier.width(7.dp))
                Text(
                    summary.take(120),
                    modifier = Modifier.weight(1f),
                    color = palette.textMuted,
                    fontSize = 10.sp,
                    lineHeight = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                if (open) "收起思考过程" else "展开思考过程",
                tint = palette.textMuted,
                modifier = Modifier.size(15.dp).rotate(if (open) 90f else 0f),
            )
        }
        if (open) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = palette.soft,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(Modifier.padding(12.dp)) {
                    MessageContent(message.reasoning, markdown = true)
                }
            }
        }
    }
}

@Composable
private fun ToolBlock(message: ChatMessage, open: Boolean, onToggle: () -> Unit) {
    val palette = LocalForgePalette.current
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = palette.soft.copy(alpha = 0.7f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp)
                    .clickable(onClick = onToggle)
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Build, null, tint = palette.textMuted, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(7.dp))
                Text(
                    message.toolName.ifBlank { "工具结果" },
                    color = palette.textSecondary,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(if (open) "收起" else "结果", color = palette.textMuted, fontSize = 10.sp)
                Icon(
                    Icons.Default.KeyboardArrowDown,
                    if (open) "收起工具结果" else "展开工具结果",
                    tint = palette.textMuted,
                    modifier = Modifier.size(15.dp).rotate(if (open) 180f else 0f),
                )
            }
            if (open) {
                ToolOutput(message.text)
            }
        }
    }
}

@Composable
private fun ToolOutput(text: String) {
    val palette = LocalForgePalette.current
    val clipboard = LocalClipboardManager.current
    var copied by remember(text) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1600)
            copied = false
        }
    }
    Column(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, bottom = 10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (text.isBlank()) "工具未返回文本" else "输出",
                modifier = Modifier.weight(1f),
                color = palette.textMuted,
                fontSize = 10.sp,
            )
            if (text.isNotBlank()) {
                TextButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(text))
                        copied = true
                    },
                    contentPadding = PaddingValues(horizontal = 5.dp),
                    modifier = Modifier.heightIn(min = 44.dp),
                ) { Text(if (copied) "已复制" else "复制输出", fontSize = 10.sp) }
            }
        }
        if (text.isNotBlank()) {
            SelectionContainer {
                Text(
                    text,
                    modifier = Modifier.horizontalScroll(rememberScrollState())
                        .padding(vertical = 4.dp),
                    color = palette.textPrimary,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 19.sp,
                )
            }
        }
    }
}

@Composable
private fun ToolCallHint(toolName: String) {
    val palette = LocalForgePalette.current
    Row(
        Modifier.fillMaxWidth().padding(top = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Build, null, tint = palette.textMuted, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(5.dp))
        Text(
            "调用工具 · $toolName",
            color = palette.textMuted,
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun MessageImages(message: ChatMessage, compact: Boolean) {
    val palette = LocalForgePalette.current
    if (message.images.isNotEmpty()) {
        Spacer(Modifier.height(8.dp))
        if (message.images.size == 1) {
            ForgeImage(
                image = message.images.first(),
                modifier = Modifier.fillMaxWidth().heightIn(max = if (compact) 260.dp else 340.dp),
                maxDimension = 1600,
            )
        } else {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                message.images.take(4).forEach { image ->
                    ForgeImage(
                        image = image,
                        modifier = Modifier.size(width = if (compact) 150.dp else 180.dp, height = if (compact) 120.dp else 140.dp),
                        maxDimension = 900,
                    )
                }
            }
        }
        val missing = message.imageCount - message.images.size
        if (missing > 0) {
            Spacer(Modifier.height(3.dp))
            Text(
                "另有 $missing 张图片未包含在本地快照中",
                color = palette.textMuted,
                fontSize = 10.sp,
            )
        }
    } else if (message.imageCount > 0) {
        Spacer(Modifier.height(5.dp))
        Text(
            "包含 ${message.imageCount} 张图片 · 内容未包含在本地快照中",
            color = palette.textMuted,
            fontSize = 10.sp,
        )
    }
}

@Composable
private fun ApprovalCard(
    approval: Approval,
    enabled: Boolean,
    onAnswer: (Boolean) -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = palette.warningBackground,
        contentColor = palette.textPrimary,
        border = BorderStroke(1.dp, palette.warningBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(palette.warning))
                Spacer(Modifier.width(7.dp))
                Text("需要你的确认", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Text(
                    approval.toolName,
                    color = palette.warning,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (approval.description.isNotBlank()) {
                Text(
                    approval.description,
                    color = palette.textPrimary,
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                )
            }
            if (approval.command.isNotBlank()) {
                MessageContent("```\n${approval.command}\n```")
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(
                    onClick = { onAnswer(false) },
                    enabled = enabled,
                    modifier = Modifier.heightIn(min = 44.dp).testTag("deny-approval"),
                ) { Text("拒绝", color = palette.error, fontSize = 12.sp) }
                Spacer(Modifier.width(6.dp))
                Button(
                    onClick = { onAnswer(true) },
                    enabled = enabled,
                    modifier = Modifier.heightIn(min = 44.dp).testTag("allow-approval"),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = palette.accent,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                        disabledContainerColor = palette.borderControl,
                        disabledContentColor = palette.textMuted,
                    ),
                ) { Text("允许这一次", fontSize = 12.sp) }
            }
        }
    }
}
