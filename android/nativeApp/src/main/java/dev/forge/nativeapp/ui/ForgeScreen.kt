@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package dev.forge.nativeapp.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.Approval
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import dev.forge.nativeapp.SessionSummary
import kotlinx.coroutines.launch

private const val DEST_WORKBENCH = "workbench"
private const val DEST_SETTINGS = "settings"
private const val DEST_USAGE = "usage"
private const val DEST_INSPECTOR = "inspector"

/**
 * Native shell for the Forge workbench: persistent 264dp rail on wide screens,
 * drawer + task/detail switch on phones, and the single shared header.  Local
 * navigation is saveable and never turns Android's Back button into an app exit
 * while a panel, drawer or inspector is still open.
 */
@Composable
fun ForgeScreen(state: ChatUiState, actions: ChatActions) {
    val palette = LocalForgePalette.current
    val configuration = LocalConfiguration.current
    val isWide = configuration.screenWidthDp > 1000
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    var destination by rememberSaveable { mutableStateOf(DEST_WORKBENCH) }
    var settingsReturnTo by rememberSaveable { mutableStateOf(DEST_WORKBENCH) }
    var usageReturnTo by rememberSaveable { mutableStateOf(DEST_WORKBENCH) }
    var wideInspectorVisible by rememberSaveable { mutableStateOf(false) }
    var sidebarFocusRequest by remember { mutableStateOf(0) }
    var modelPickerOpen by rememberSaveable { mutableStateOf(false) }
    var settingsOpenedConnected by remember { mutableStateOf(false) }
    var previousPending by remember { mutableStateOf(0) }

    val connected = state.connection == ConnectionPhase.Connected
    val canNavigate = !state.sending && !state.busy
    val isNew = state.selectedId == null
    val pendingApprovals: List<Approval> = remember(state.allApprovals, state.approvals) {
        (state.allApprovals + state.approvals).distinctBy { it.id }
    }
    val pendingCount = pendingApprovals.size

    fun closeDrawer() {
        if (drawerState.isOpen) scope.launch { drawerState.close() }
    }

    fun openSettings() {
        settingsReturnTo = if (destination == DEST_INSPECTOR) DEST_INSPECTOR else DEST_WORKBENCH
        closeDrawer()
        destination = DEST_SETTINGS
    }

    fun openUsage() {
        usageReturnTo = DEST_WORKBENCH
        closeDrawer()
        destination = DEST_USAGE
    }

    fun startNewChat() {
        if (!canNavigate) return
        closeDrawer()
        destination = DEST_WORKBENCH
        actions.newChat()
    }

    fun toggleInspector() {
        closeDrawer()
        if (isWide) {
            wideInspectorVisible = !wideInspectorVisible
        } else {
            destination = if (destination == DEST_INSPECTOR) DEST_WORKBENCH else DEST_INSPECTOR
        }
    }

    BackHandler(
        enabled = destination != DEST_WORKBENCH || drawerState.isOpen || (isWide && wideInspectorVisible),
    ) {
        when {
            destination == DEST_SETTINGS -> destination = settingsReturnTo
            destination == DEST_USAGE -> destination = usageReturnTo
            destination != DEST_WORKBENCH -> destination = DEST_WORKBENCH
            drawerState.isOpen -> closeDrawer()
            isWide && wideInspectorVisible -> wideInspectorVisible = false
        }
    }
    BackHandler(enabled = modelPickerOpen) { modelPickerOpen = false }

    LaunchedEffect(isWide) {
        if (isWide && destination == DEST_INSPECTOR) {
            destination = DEST_WORKBENCH
            wideInspectorVisible = true
        }
    }
    LaunchedEffect(state.connection) {
        if (connected) {
            actions.loadPanel("settings")
            if (state.selectedId != null) actions.loadPanel("queue")
        }
    }
    LaunchedEffect(state.selectedId) {
        if (connected && state.selectedId != null) actions.loadPanel("queue")
    }
    LaunchedEffect(destination) {
        if (destination == DEST_SETTINGS) settingsOpenedConnected = state.connection == ConnectionPhase.Connected
        if (destination == DEST_SETTINGS && connected) actions.loadPanel("settings")
    }
    LaunchedEffect(state.connection) {
        // Leaving the connection form after a successful disconnect returns to
        // the workbench; opening settings while already offline stays usable.
        if (destination == DEST_SETTINGS && settingsOpenedConnected &&
            state.connection == ConnectionPhase.Disconnected
        ) {
            settingsOpenedConnected = false
            destination = settingsReturnTo
        } else if (destination == DEST_SETTINGS && !settingsOpenedConnected &&
            state.connection == ConnectionPhase.Connected
        ) {
            // The connection panel was the first-run path; once Core is ready,
            // return to the workbench so its header actions are immediately usable.
            destination = settingsReturnTo
        }
    }
    LaunchedEffect(pendingCount) {
        if (isWide && pendingCount > previousPending) wideInspectorVisible = true
        previousPending = pendingCount
    }

    Box(Modifier.fillMaxSize().background(palette.canvas)) {
        when (destination) {
            DEST_SETTINGS -> Box(
                Modifier.fillMaxSize().background(palette.canvas)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .testTag("settings-panel"),
            ) {
                ForgeSettings(state, actions, onClose = { destination = settingsReturnTo })
            }
            DEST_USAGE -> Box(
                Modifier.fillMaxSize().background(palette.canvas)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .testTag("usage-panel"),
            ) {
                ForgeUsage(state, actions, onClose = { destination = usageReturnTo })
            }
            DEST_INSPECTOR -> Column(
                Modifier.fillMaxSize().background(palette.canvas)
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top),
                    ),
            ) {
                WorkbenchHeader(
                    state = state,
                    compact = true,
                    pendingCount = pendingCount,
                    inspectorExpanded = true,
                    canNavigate = canNavigate,
                    showSidebarButton = false,
                    onOpenSidebar = {},
                    onNewChat = { startNewChat() },
                    onOpenSettings = { openSettings() },
                    onToggleInspector = { destination = DEST_WORKBENCH },
                )
                ForgeInspector(
                    state = state,
                    actions = actions,
                    onClose = { destination = DEST_WORKBENCH },
                    modifier = Modifier.weight(1f).fillMaxWidth().navigationBarsPadding(),
                )
            }
            else -> {
                if (isWide) {
                    WideWorkbench(
                        state = state,
                        actions = actions,
                        isNew = isNew,
                        pendingCount = pendingCount,
                        inspectorVisible = wideInspectorVisible,
                        canNavigate = canNavigate,
                        sidebarFocusRequest = sidebarFocusRequest,
                        onOpenSidebar = { sidebarFocusRequest++ },
                        onNavigate = { closeDrawer() },
                        onNewChat = { startNewChat() },
                        onOpenSettings = { openSettings() },
                        onOpenUsage = { openUsage() },
                        onToggleInspector = { toggleInspector() },
                        onOpenModelPicker = { modelPickerOpen = true },
                    )
                } else {
                    CompactWorkbench(
                        state = state,
                        actions = actions,
                        isNew = isNew,
                        pendingCount = pendingCount,
                        canNavigate = canNavigate,
                        drawerState = drawerState,
                        onNavigate = { closeDrawer() },
                        onNewChat = { startNewChat() },
                        onOpenSettings = { openSettings() },
                        onOpenUsage = { openUsage() },
                        onToggleInspector = { toggleInspector() },
                        onOpenModelPicker = { modelPickerOpen = true },
                    )
                }
            }
        }
    }

    if (modelPickerOpen) {
        ForgeModelPicker(state, actions, onDismiss = { modelPickerOpen = false })
    }
}

@Composable
private fun WideWorkbench(
    state: ChatUiState,
    actions: ChatActions,
    isNew: Boolean,
    pendingCount: Int,
    inspectorVisible: Boolean,
    canNavigate: Boolean,
    sidebarFocusRequest: Int,
    onOpenSidebar: () -> Unit,
    onNavigate: () -> Unit,
    onNewChat: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenUsage: () -> Unit,
    onToggleInspector: () -> Unit,
    onOpenModelPicker: () -> Unit,
) {
    val palette = LocalForgePalette.current
    Row(
        Modifier.fillMaxSize().background(palette.canvas)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        ForgeSidebar(
            state = state,
            actions = actions,
            onNavigate = onNavigate,
            onOpenSettings = onOpenSettings,
            onOpenUsage = onOpenUsage,
            focusSearchRequest = sidebarFocusRequest,
            modifier = Modifier.width(264.dp).fillMaxHeight(),
        )
        VerticalDivider(color = palette.borderSubtle)
        Row(Modifier.weight(1f).fillMaxHeight()) {
            Column(Modifier.weight(1f).fillMaxHeight()) {
                WorkbenchHeader(
                    state = state,
                    compact = false,
                    pendingCount = pendingCount,
                    inspectorExpanded = inspectorVisible,
                    canNavigate = canNavigate,
                    onOpenSidebar = onOpenSidebar,
                    onNewChat = onNewChat,
                    onOpenSettings = onOpenSettings,
                    onToggleInspector = onToggleInspector,
                )
                WorkbenchMain(
                    state = state,
                    actions = actions,
                    isNew = isNew,
                    onOpenModelPicker = onOpenModelPicker,
                    modifier = Modifier.weight(1f),
                )
            }
            if (inspectorVisible) {
                VerticalDivider(color = palette.borderSubtle)
                Box(
                    Modifier.width(360.dp).fillMaxHeight().background(palette.canvas),
                ) {
                    ForgeInspector(
                        state = state,
                        actions = actions,
                        onClose = onToggleInspector,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }
}

@Composable
private fun CompactWorkbench(
    state: ChatUiState,
    actions: ChatActions,
    isNew: Boolean,
    pendingCount: Int,
    canNavigate: Boolean,
    drawerState: androidx.compose.material3.DrawerState,
    onNavigate: () -> Unit,
    onNewChat: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenUsage: () -> Unit,
    onToggleInspector: () -> Unit,
    onOpenModelPicker: () -> Unit,
) {
    val palette = LocalForgePalette.current
    val scope = rememberCoroutineScope()
    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = true,
        scrimColor = Color.Black.copy(alpha = 0.32f),
        drawerContent = {
            ModalDrawerSheet(
                drawerState = drawerState,
                modifier = Modifier.width(300.dp).fillMaxHeight(),
                drawerContainerColor = palette.sidebar,
                drawerContentColor = palette.textPrimary,
                drawerShape = RoundedCornerShape(topEnd = 16.dp, bottomEnd = 16.dp),
            ) {
                ForgeSidebar(
                    state = state,
                    actions = actions,
                    onNavigate = onNavigate,
                    onOpenSettings = onOpenSettings,
                    onOpenUsage = onOpenUsage,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        },
    ) {
        Column(
            Modifier.fillMaxSize().background(palette.canvas)
                .windowInsetsPadding(
                    WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top),
                ),
        ) {
            WorkbenchHeader(
                state = state,
                compact = true,
                pendingCount = pendingCount,
                inspectorExpanded = false,
                canNavigate = canNavigate,
                onOpenSidebar = { scope.launch { drawerState.open() } },
                onNewChat = onNewChat,
                onOpenSettings = onOpenSettings,
                onToggleInspector = onToggleInspector,
            )
            WorkbenchMain(
                state = state,
                actions = actions,
                isNew = isNew,
                onOpenModelPicker = onOpenModelPicker,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun WorkbenchHeader(
    state: ChatUiState,
    compact: Boolean,
    pendingCount: Int,
    inspectorExpanded: Boolean,
    canNavigate: Boolean,
    showSidebarButton: Boolean = true,
    onOpenSidebar: () -> Unit,
    onNewChat: () -> Unit,
    onOpenSettings: () -> Unit,
    onToggleInspector: () -> Unit,
) {
    val palette = LocalForgePalette.current
    val buttonSize = if (compact) 48.dp else 32.dp
    val height = if (compact) 48.dp else 44.dp
    val title = if (state.selectedId == null) "新会话" else state.title.ifBlank { "Forge 工作台" }
    Row(
        Modifier.fillMaxWidth().height(height).background(palette.canvas)
            .padding(horizontal = if (compact) 4.dp else 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showSidebarButton) {
            IconButton(
                onClick = onOpenSidebar,
                modifier = Modifier.size(if (compact) 44.dp else 32.dp),
            ) {
                Icon(
                    Icons.Default.Menu,
                    "会话列表",
                    tint = palette.textSecondary,
                    modifier = Modifier.size(19.dp),
                )
            }
        }
        Row(
            Modifier.weight(1f).padding(horizontal = if (compact) 2.dp else 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.connection != ConnectionPhase.Connected) {
                val dotColor = when (state.connection) {
                    ConnectionPhase.Connecting, ConnectionPhase.Reconnecting -> palette.warning
                    else -> palette.textMuted
                }
                Box(
                    Modifier.size(6.dp).clip(CircleShape).background(dotColor)
                        .semantics { contentDescription = connectionLabel(state.connection) },
                )
                Spacer(Modifier.width(7.dp))
            }
            Text(
                title,
                modifier = Modifier.weight(1f).clearAndSetSemantics {
                    contentDescription = "当前会话：$title"
                },
                color = palette.textPrimary,
                fontSize = 14.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (!compact && pendingCount > 0) {
            Surface(
                onClick = onToggleInspector,
                shape = CircleShape,
                color = palette.warningBackground,
                contentColor = palette.warning,
                border = androidx.compose.foundation.BorderStroke(1.dp, palette.warningBorder),
                modifier = Modifier.height(28.dp).padding(horizontal = 2.dp),
            ) {
                Row(
                    Modifier.padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("待批准 $pendingCount", fontSize = 11.sp, fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.width(4.dp))
        }
        IconButton(
            onClick = onNewChat,
            enabled = canNavigate,
            modifier = Modifier.size(buttonSize).testTag("new-chat"),
        ) {
            Icon(
                Icons.Default.Add,
                "新任务",
                tint = if (canNavigate) palette.textSecondary else palette.textMuted,
                modifier = Modifier.size(19.dp),
            )
        }
        val expandedDescription = buildString {
            append(if (inspectorExpanded) "收起详情，返回任务" else "展开详情")
            if (pendingCount > 0) append("，待批准 $pendingCount 项")
        }
        IconButton(
            onClick = onToggleInspector,
            modifier = Modifier.size(buttonSize).clip(RoundedCornerShape(8.dp))
                .background(if (inspectorExpanded) palette.selected else Color.Transparent)
                .semantics { contentDescription = expandedDescription }
                .testTag("inspector-toggle"),
        ) {
            Box(Modifier.size(buttonSize), contentAlignment = Alignment.Center) {
                DetailsGlyph(
                    collapsed = !inspectorExpanded,
                    modifier = Modifier.size(18.dp),
                    tint = if (inspectorExpanded) palette.accent else palette.textSecondary,
                )
                if (compact && pendingCount > 0) {
                    Box(
                        Modifier.align(Alignment.TopEnd).padding(top = 3.dp, end = 3.dp)
                            .size(16.dp).clip(CircleShape).background(palette.warning),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (pendingCount > 9) "9+" else pendingCount.toString(),
                            color = palette.warningBackground,
                            fontSize = 9.sp,
                            lineHeight = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
        IconButton(
            onClick = onOpenSettings,
            modifier = Modifier.size(buttonSize).testTag("settings"),
        ) {
            Icon(
                Icons.Default.Settings,
                "设置",
                tint = palette.textSecondary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun WorkbenchMain(
    state: ChatUiState,
    actions: ChatActions,
    isNew: Boolean,
    onOpenModelPicker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalForgePalette.current
    var localConfirmUncertain by remember { mutableStateOf(false) }
    Column(modifier.fillMaxSize().background(palette.canvas)) {
        when (state.connection) {
            ConnectionPhase.Connecting, ConnectionPhase.Reconnecting -> {
                LinearProgressIndicator(
                    Modifier.fillMaxWidth().height(2.dp),
                    color = palette.accent,
                    trackColor = palette.soft,
                )
                Text(
                    state.connectionDetail,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    color = palette.textSecondary,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                )
            }
            else -> Unit
        }
        if (state.error != null) {
            Surface(color = palette.errorBackground, contentColor = palette.textPrimary) {
                Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 4.dp, bottom = 4.dp)) {
                    Text(
                        state.error,
                        color = palette.error,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(
                            onClick = actions::refresh,
                            modifier = Modifier.heightIn(min = 40.dp),
                        ) { Text("刷新", fontSize = 11.sp) }
                        TextButton(
                            onClick = actions::dismissError,
                            modifier = Modifier.heightIn(min = 40.dp),
                        ) { Text("收起提示", fontSize = 11.sp) }
                    }
                }
            }
        }
        if (state.uncertain) {
            Surface(color = palette.warningBackground, contentColor = palette.textPrimary) {
                Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 4.dp, bottom = 4.dp)) {
                    Text(
                        "上次操作结果未确认。先刷新历史与任务状态，避免重复发送。",
                        color = palette.warning,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(
                            onClick = actions::refresh,
                            modifier = Modifier.heightIn(min = 40.dp),
                        ) { Text("刷新检查", fontSize = 11.sp) }
                        TextButton(
                            onClick = { localConfirmUncertain = true },
                            enabled = state.connection == ConnectionPhase.Connected && !state.sending && !state.busy,
                            modifier = Modifier.heightIn(min = 40.dp),
                        ) { Text("我已检查", fontSize = 11.sp) }
                    }
                }
            }
        }
        if (isNew) {
            HomeSurface(
                state = state,
                actions = actions,
                onOpenModelPicker = onOpenModelPicker,
                modifier = Modifier.weight(1f),
            )
        } else {
            HistorySurface(
                state = state,
                actions = actions,
                onOpenModelPicker = onOpenModelPicker,
                modifier = Modifier.weight(1f),
            )
        }
    }

    if (localConfirmUncertain) {
        AlertDialog(
            onDismissRequest = { localConfirmUncertain = false },
            title = { Text("确认已经检查服务器状态？") },
            text = {
                Text("解锁只恢复操作按钮，不会自动重发消息或再次提交审批。若草稿可能已送达，请先清空重复内容。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        actions.acknowledgeUncertain()
                        localConfirmUncertain = false
                    },
                    enabled = state.connection == ConnectionPhase.Connected && !state.sending && !state.busy,
                ) { Text("确认，解锁操作") }
            },
            dismissButton = {
                TextButton(onClick = { localConfirmUncertain = false }) { Text("返回检查") }
            },
        )
    }
}

@Composable
private fun HomeSurface(
    state: ChatUiState,
    actions: ChatActions,
    onOpenModelPicker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalForgePalette.current
    val compact = LocalConfiguration.current.screenWidthDp <= 1000
    val canNavigate = !state.sending && !state.busy
    val recent = remember(state.sessions) {
        state.sessions
            .filter { it.parentSessionId.isBlank() && !it.archived }
            .sortedByDescending { it.updatedAt }
            .take(4)
    }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Column(
            Modifier.fillMaxWidth().widthIn(max = 760.dp)
                .align(Alignment.CenterHorizontally)
                .padding(horizontal = if (compact) 16.dp else 32.dp),
        ) {
            Spacer(Modifier.height(if (compact) 28.dp else 52.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("f.", style = ForgeWordmarkStyle, color = palette.accent)
                Spacer(Modifier.width(12.dp))
                Text(
                    "今天，想做点什么？",
                    color = palette.textPrimary,
                    fontSize = 22.sp,
                    lineHeight = 31.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = (-0.2).sp,
                )
            }
            Spacer(Modifier.height(7.dp))
            Text(
                "继续之前的工作，或开始一项新任务。",
                color = palette.textSecondary,
                fontSize = 13.sp,
                lineHeight = 20.sp,
            )
            Spacer(Modifier.height(32.dp))
            Text(
                "最近任务",
                color = palette.textSecondary,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(4.dp))
            if (recent.isEmpty()) {
                Text(
                    when {
                        state.connection != ConnectionPhase.Connected -> "连接 Core 后可读取最近任务。"
                        state.loading -> "正在读取最近任务…"
                        else -> "还没有历史任务，从下方开始。"
                    },
                    color = palette.textMuted,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(vertical = 10.dp),
                )
            } else {
                recent.forEachIndexed { index, session ->
                    RecentTaskRow(
                        session = session,
                        enabled = canNavigate,
                        compact = compact,
                        onClick = { actions.selectSession(session.id) },
                    )
                    if (index != recent.lastIndex) HorizontalDivider(color = palette.borderSubtle)
                }
            }
            Spacer(Modifier.height(24.dp))
            ForgeComposer(
                state = state,
                actions = actions,
                isNew = true,
                onOpenModelPicker = onOpenModelPicker,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(if (compact) 16.dp else 24.dp))
        }
    }
}

@Composable
private fun RecentTaskRow(
    session: SessionSummary,
    enabled: Boolean,
    compact: Boolean,
    onClick: () -> Unit,
) {
    val palette = LocalForgePalette.current
    val meta = buildString {
        append(workspaceLeaf(session.workspace))
        val date = formatSessionDate(session.updatedAt)
        if (date.isNotBlank()) append(" · ").append(date)
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        color = Color.Transparent,
        contentColor = palette.textPrimary,
        modifier = Modifier.fillMaxWidth().heightIn(min = if (compact) 56.dp else 44.dp)
            .clearAndSetSemantics { contentDescription = "打开任务：${session.title}" },
    ) {
        Row(
            Modifier.padding(vertical = if (compact) 10.dp else 8.dp, horizontal = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    session.title.ifBlank { "未命名任务" },
                    color = palette.textPrimary,
                    fontSize = 14.sp,
                    lineHeight = 21.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    meta,
                    color = palette.textSecondary,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(10.dp))
            Icon(
                Icons.AutoMirrored.Filled.ArrowForward,
                null,
                tint = palette.textMuted,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun HistorySurface(
    state: ChatUiState,
    actions: ChatActions,
    onOpenModelPicker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val compact = LocalConfiguration.current.screenWidthDp <= 1000
    Column(modifier.fillMaxSize()) {
        if (state.loading && state.messages.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                androidx.compose.material3.CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            }
        } else {
            ForgeConversation(
                state = state,
                actions = actions,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            )
        }
        Box(
            Modifier.fillMaxWidth().navigationBarsPadding().imePadding()
                .padding(horizontal = if (compact) 12.dp else 32.dp, vertical = if (compact) 6.dp else 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            ForgeComposer(
                state = state,
                actions = actions,
                isNew = false,
                onOpenModelPicker = onOpenModelPicker,
                modifier = Modifier.widthIn(max = 760.dp),
            )
        }
    }
}
