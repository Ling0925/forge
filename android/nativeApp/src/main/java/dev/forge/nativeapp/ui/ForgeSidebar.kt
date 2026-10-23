package dev.forge.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import dev.forge.nativeapp.SessionSummary
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

internal fun workspaceLeaf(workspace: String): String {
    val trimmed = workspace.trim().trimEnd('/', '\\')
    if (trimmed.isEmpty()) return "未指定工作区"
    return trimmed.substringAfterLast('/').substringAfterLast('\\').ifBlank { trimmed }
}

internal fun formatSessionDate(value: String): String {
    if (value.isBlank()) return ""
    val format = DateTimeFormatter.ofPattern("M月d日", Locale.SIMPLIFIED_CHINESE)
    return runCatching { OffsetDateTime.parse(value).format(format) }
        .recoverCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).format(format) }
        .getOrElse { value.take(10) }
}

/**
 * The 264dp rail (a drawer below 1001dp). It only lists primary sessions and
 * keeps archive, workspace grouping and destructive confirmations explicit.
 */
@Composable
fun ForgeSidebar(
    state: ChatUiState,
    actions: ChatActions,
    onNavigate: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenUsage: () -> Unit,
    modifier: Modifier = Modifier,
    focusSearchRequest: Int = 0,
) {
    val palette = LocalForgePalette.current
    val compact = LocalConfiguration.current.screenWidthDp <= 1000
    val searchFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(focusSearchRequest) {
        if (focusSearchRequest > 0) searchFocus.requestFocus()
    }
    val connected = state.connection == ConnectionPhase.Connected
    val canNavigate = !state.sending && !state.busy
    val canMutate = connected && !state.sending && !state.busy && !state.uncertain
    val rowHeight = if (compact) 44.dp else 32.dp
    val actionSize = if (compact) 44.dp else 32.dp

    var query by rememberSaveable { mutableStateOf("") }
    var showArchived by rememberSaveable { mutableStateOf(false) }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    val visibleLimits = remember { mutableStateMapOf<String, Int>() }
    var renameTarget by remember { mutableStateOf<SessionSummary?>(null) }
    var archiveTarget by remember { mutableStateOf<SessionSummary?>(null) }
    var forkTarget by remember { mutableStateOf<SessionSummary?>(null) }

    val groups = remember(state.sessions, query, showArchived) {
        buildWorkspaceGroups(state.sessions, query, showArchived)
    }
    val primarySessions = remember(state.sessions) {
        state.sessions.filter { it.parentSessionId.isBlank() }
    }
    val searching = query.isNotBlank()

    Surface(modifier.fillMaxSize().testTag("sidebar"), color = palette.sidebar) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 6.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("f.", style = ForgeWordmarkStyle, color = palette.accent)
                    Spacer(Modifier.width(7.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Forge",
                            fontSize = 15.sp,
                            lineHeight = 20.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = palette.textPrimary,
                        )
                        Text(
                            "本地代理工作台",
                            fontSize = 10.sp,
                            lineHeight = 14.sp,
                            color = palette.textMuted,
                        )
                    }
                    if (compact) {
                        IconButton(
                            onClick = onNavigate,
                            modifier = Modifier.size(44.dp),
                        ) {
                            Icon(Icons.Default.Close, "关闭会话列表", tint = palette.textMuted, modifier = Modifier.size(18.dp))
                        }
                    }
                }
                Spacer(Modifier.size(8.dp))
                Surface(
                    onClick = {
                        actions.newChat()
                        onNavigate()
                    },
                    enabled = canNavigate,
                    shape = RoundedCornerShape(8.dp),
                    color = if (canNavigate) palette.selected else palette.soft,
                    contentColor = if (canNavigate) palette.textPrimary else palette.textMuted,
                    modifier = Modifier.fillMaxWidth().heightIn(min = if (compact) 44.dp else 34.dp).testTag("sidebar-new"),
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(Icons.Default.Add, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(7.dp))
                        Text("新任务", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = palette.soft,
                    modifier = Modifier.weight(1f).heightIn(min = actionSize),
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.Search, null, tint = palette.textMuted, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(7.dp))
                        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                            if (query.isEmpty()) {
                                Text(
                                    "搜索任务 / 工作区...",
                                    color = palette.textMuted,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            BasicTextField(
                                value = query,
                                onValueChange = { query = it },
                                singleLine = true,
                                textStyle = TextStyle(fontSize = 13.sp, color = palette.textPrimary),
                                cursorBrush = androidx.compose.ui.graphics.SolidColor(palette.accent),
                                modifier = Modifier.fillMaxWidth().testTag("sidebar-search")
                                    .focusRequester(searchFocus)
                                    .semantics { contentDescription = "搜索会话" },
                            )
                        }
                    }
                }
                IconButton(
                    onClick = { showArchived = !showArchived },
                    modifier = Modifier.size(actionSize).clip(RoundedCornerShape(8.dp))
                        .background(if (showArchived) palette.selected else palette.soft)
                        .semantics {
                            contentDescription = if (showArchived) "隐藏归档会话" else "显示归档会话"
                        },
                ) {
                    ArchiveGlyph(
                        modifier = Modifier.size(16.dp),
                        tint = if (showArchived) palette.accent else palette.textMuted,
                    )
                }
            }

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
            ) {
                if (primarySessions.isEmpty()) {
                    item("sidebar-empty") {
                        Text(
                            if (connected) "暂无历史任务" else "连接 Core 后读取服务器会话",
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 28.dp),
                            color = palette.textSecondary,
                            fontSize = 12.sp,
                            lineHeight = 18.sp,
                        )
                    }
                } else if (groups.isEmpty()) {
                    item("sidebar-no-match") {
                        Text(
                            "没有匹配的任务",
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 28.dp),
                            color = palette.textSecondary,
                            fontSize = 12.sp,
                        )
                    }
                }
                groups.forEach { group ->
                    item(key = "folder:${group.workspace}") {
                        val isCollapsed = !searching && collapsed[group.workspace] == true
                        val activeIndex = group.sessions.indexOfFirst { it.id == state.selectedId }
                        val configured = visibleLimits[group.workspace] ?: 10
                        val effectiveLimit = if (activeIndex >= configured) {
                            ceil((activeIndex + 1) / 10.0).toInt() * 10
                        } else {
                            configured
                        }
                        val visible = group.sessions.take(effectiveLimit)
                        Column(Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = if (compact) 40.dp else 28.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(
                                    Modifier.weight(1f).clip(RoundedCornerShape(6.dp))
                                        .clickable { collapsed[group.workspace] = !isCollapsed }
                                        .padding(horizontal = 6.dp, vertical = 3.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                        null,
                                        tint = palette.textMuted,
                                        modifier = Modifier.size(14.dp).rotate(if (isCollapsed) 0f else 90f),
                                    )
                                    Spacer(Modifier.width(3.dp))
                                    FolderGlyph(
                                        open = !isCollapsed,
                                        modifier = Modifier.size(14.dp),
                                        tint = palette.textMuted,
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        workspaceLeaf(group.workspace),
                                        modifier = Modifier.weight(1f),
                                        color = palette.textSecondary,
                                        fontSize = 11.sp,
                                        lineHeight = 16.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        group.sessions.size.toString(),
                                        color = palette.textMuted,
                                        fontSize = 10.sp,
                                    )
                                }
                            }
                            if (!isCollapsed) {
                                Column(Modifier.fillMaxWidth().padding(start = 12.dp)) {
                                    visible.forEach { session ->
                                        SessionRow(
                                            session = session,
                                            selected = session.id == state.selectedId,
                                            compact = compact,
                                            rowHeight = rowHeight,
                                            actionSize = actionSize,
                                            pending = state.allApprovals.any { it.sessionId == session.id } ||
                                                session.status == "awaiting_approval",
                                            running = state.allRuns.any { it.sessionId == session.id } ||
                                                session.status == "running",
                                            canNavigate = canNavigate,
                                            canMutate = canMutate,
                                            onSelect = {
                                                if (canNavigate) {
                                                    actions.selectSession(session.id)
                                                    onNavigate()
                                                }
                                            },
                                            onRename = { renameTarget = session },
                                            onArchive = { archiveTarget = session },
                                            onFork = { forkTarget = session },
                                        )
                                    }
                                    if (visible.size < group.sessions.size) {
                                        Text(
                                            "更多",
                                            modifier = Modifier.fillMaxWidth()
                                                .clip(RoundedCornerShape(6.dp))
                                                .clickable {
                                                    visibleLimits[group.workspace] = effectiveLimit + 10
                                                }
                                                .padding(vertical = 6.dp),
                                            color = palette.textMuted,
                                            fontSize = 11.sp,
                                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = palette.borderSubtle)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                SidebarFooterAction(
                    description = "打开用量看板",
                    tag = "usage",
                    compact = compact,
                    onClick = {
                        onOpenUsage()
                        onNavigate()
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    UsageGlyph(Modifier.size(15.dp), palette.textSecondary)
                    Spacer(Modifier.width(6.dp))
                    Text("用量", fontSize = 12.sp, color = palette.textSecondary)
                }
                // A second, explicitly secondary settings entry remains available
                // in the rail; the single `settings` test tag lives in the header.
                SidebarFooterAction(
                    description = "打开设置",
                    tag = "sidebar-settings",
                    compact = compact,
                    onClick = {
                        onOpenSettings()
                        onNavigate()
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(
                        Icons.Default.Settings,
                        null,
                        tint = palette.textSecondary,
                        modifier = Modifier.size(15.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("设置", fontSize = 12.sp, color = palette.textSecondary)
                }
            }
            ConnectionStatus(state)
        }
    }

    renameTarget?.let { target ->
        var title by remember(target.id) { mutableStateOf(target.title) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("重命名会话") },
            text = {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it.take(200) },
                    singleLine = true,
                    label = { Text("标题") },
                    modifier = Modifier.fillMaxWidth().testTag("rename-session-input"),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val next = title.trim()
                        if (next.isNotEmpty()) actions.renameSession(target.id, next)
                        renameTarget = null
                    },
                    enabled = canMutate && title.trim().isNotEmpty(),
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("取消") } },
        )
    }
    archiveTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { archiveTarget = null },
            title = { Text(if (target.archived) "恢复这个任务？" else "归档这个任务？") },
            text = {
                Text(
                    if (target.archived) {
                        "恢复后它会重新出现在工作区列表中，不会自动运行。"
                    } else {
                        "归档只会从默认列表隐藏它，历史仍可在归档筛选中找回。"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        actions.archiveSession(target.id, !target.archived)
                        archiveTarget = null
                    },
                    enabled = canMutate,
                ) { Text(if (target.archived) "恢复" else "归档") }
            },
            dismissButton = { TextButton(onClick = { archiveTarget = null }) { Text("取消") } },
        )
    }
    forkTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { forkTarget = null },
            title = { Text("从这里分叉？") },
            text = {
                Text("将基于「${target.title}」创建一个子会话。原会话和远端运行不会被修改；分叉结果以服务器返回为准。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        actions.forkSession(target.id)
                        forkTarget = null
                    },
                    enabled = canMutate,
                ) { Text("创建分叉") }
            },
            dismissButton = { TextButton(onClick = { forkTarget = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun SessionRow(
    session: SessionSummary,
    selected: Boolean,
    compact: Boolean,
    rowHeight: androidx.compose.ui.unit.Dp,
    actionSize: androidx.compose.ui.unit.Dp,
    pending: Boolean,
    running: Boolean,
    canNavigate: Boolean,
    canMutate: Boolean,
    onSelect: () -> Unit,
    onRename: () -> Unit,
    onArchive: () -> Unit,
    onFork: () -> Unit,
) {
    val palette = LocalForgePalette.current
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = rowHeight)
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) palette.selected else Color.Transparent)
            .clickable(enabled = canNavigate, onClick = onSelect)
            .padding(start = 5.dp, end = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(12.dp), contentAlignment = Alignment.Center) {
            if (pending) {
                Box(
                    Modifier.size(6.dp).clip(RoundedCornerShape(999.dp)).background(palette.warning)
                        .semantics { contentDescription = "等待审批" },
                )
            } else if (running) {
                Box(
                    Modifier.size(6.dp).clip(RoundedCornerShape(999.dp)).background(palette.accent)
                        .semantics { contentDescription = "运行中" },
                )
            }
        }
        Text(
            session.title.ifBlank { "未命名任务" },
            modifier = Modifier.weight(1f).padding(horizontal = 5.dp),
            color = palette.textPrimary,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Box {
            IconButton(
                onClick = { menu = true },
                modifier = Modifier.size(actionSize),
            ) {
                Icon(
                    Icons.Default.MoreVert,
                    "会话操作：${session.title}",
                    tint = palette.textMuted,
                    modifier = Modifier.size(17.dp),
                )
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("重命名") },
                    enabled = canMutate,
                    onClick = { menu = false; onRename() },
                )
                DropdownMenuItem(
                    text = { Text(if (session.archived) "恢复归档" else "归档") },
                    enabled = canMutate,
                    onClick = { menu = false; onArchive() },
                )
                HorizontalDivider(color = palette.borderSubtle)
                DropdownMenuItem(
                    text = { Text("分叉会话") },
                    enabled = canMutate,
                    onClick = { menu = false; onFork() },
                )
            }
        }
    }
}

@Composable
private fun SidebarFooterAction(
    description: String,
    tag: String,
    compact: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = Color.Transparent,
        modifier = modifier.heightIn(min = if (compact) 44.dp else 32.dp)
            .testTag(tag)
            .clickable(onClick = onClick)
            .semantics { contentDescription = description },
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

@Composable
private fun ConnectionStatus(state: ChatUiState) {
    val palette = LocalForgePalette.current
    val connected = state.connection == ConnectionPhase.Connected
    val settings = state.workbench.obj("settings")
    val configured = settings?.optBoolean("isConfigured")
    val color = when (state.connection) {
        ConnectionPhase.Connected -> palette.success
        ConnectionPhase.Connecting, ConnectionPhase.Reconnecting -> palette.warning
        ConnectionPhase.Paused -> palette.textMuted
        ConnectionPhase.Disconnected -> palette.textMuted
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(999.dp)).background(color))
        Spacer(Modifier.width(7.dp))
        Text(
            connectionLabel(state.connection),
            color = palette.textMuted,
            fontSize = 11.sp,
            lineHeight = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (connected && configured == false) {
            Spacer(Modifier.width(6.dp))
            Text("· 未配置", color = palette.warning, fontSize = 11.sp)
        }
        Spacer(Modifier.weight(1f))
        if (state.uncertain) {
            Text("结果未确认", color = palette.warning, fontSize = 10.sp)
        }
    }
}

internal fun connectionLabel(phase: ConnectionPhase): String = when (phase) {
    ConnectionPhase.Disconnected -> "未连接"
    ConnectionPhase.Connecting -> "正在连接"
    ConnectionPhase.Connected -> "已连接"
    ConnectionPhase.Reconnecting -> "正在重连"
    ConnectionPhase.Paused -> "已暂停"
}

private data class WorkspaceGroup(val workspace: String, val sessions: List<SessionSummary>)

private fun buildWorkspaceGroups(
    sessions: List<SessionSummary>,
    query: String,
    showArchived: Boolean,
): List<WorkspaceGroup> {
    val needle = query.trim().lowercase()
    val filtered = sessions.filter { session ->
        session.parentSessionId.isBlank() &&
            (showArchived || !session.archived) &&
            (needle.isEmpty() || "${session.title} ${session.workspace}".lowercase().contains(needle))
    }
    return filtered.groupBy { it.workspace }
        .map { (workspace, rows) ->
            WorkspaceGroup(
                workspace,
                rows.sortedWith(
                    compareByDescending<SessionSummary> { it.createdAt.ifBlank { it.updatedAt } }
                        .thenBy { it.id },
                ),
            )
        }
        .sortedWith(
            compareBy<WorkspaceGroup> { workspaceLeaf(it.workspace).lowercase() }
                .thenBy { it.workspace },
        )
}
