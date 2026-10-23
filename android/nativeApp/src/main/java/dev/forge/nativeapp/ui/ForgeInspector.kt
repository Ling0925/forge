package dev.forge.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import dev.forge.nativeapp.Approval
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import dev.forge.nativeapp.SessionSummary
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ForgeInspector(
    state: ChatUiState,
    actions: ChatActions,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var tab by rememberSaveable { mutableStateOf("progress") }
    var filesTab by rememberSaveable { mutableStateOf("browser") }
    var infoTab by rememberSaveable { mutableStateOf("overview") }
    val connected = state.isConnected()
    val sessionRaw = state.workbench.values["session"]
    val parsed = remember(sessionRaw) {
        parseSectionObject(sessionRaw, "session")?.let { wrapper ->
            wrapper.optJSONObject("snapshot") ?: wrapper
        }
    }
    // Never show another session's provenance while a selection or read is in flight.
    val snapshot = parsed?.takeIf { it.optText("id") == state.selectedId }
    val pending = remember(state.allApprovals, state.approvals) {
        (state.allApprovals.ifEmpty { state.approvals }).distinctBy { it.id }
    }

    LaunchedEffect(state.selectedId, sessionRaw, connected) {
        if (state.selectedId != null && snapshot == null && connected &&
            !state.panelLoading("session") && state.panelError("session") == null
        ) {
            actions.loadPanel("session")
        }
    }

    val plans = remember(snapshot) { parsePlans(snapshot) }
    val currentPlan = remember(plans, snapshot) { currentPlanOf(plans, snapshot) }
    val currentProgress = remember(currentPlan) { currentPlan?.let(::planProgress) }
    val changes = remember(snapshot) { snapshot?.optObjects("changes").orEmpty() }

    BoxWithConstraints(modifier.fillMaxSize().testTag("inspector")) {
        val wide = maxWidth >= 840.dp
        Column(Modifier.fillMaxSize()) {
            PanelHeader(
                title = "执行详情",
                onClose = onClose,
                subtitle = when {
                    state.selectedId == null -> "未选择会话"
                    snapshot == null -> "正在读取 ${state.selectedId.take(8)}…"
                    else -> snapshot.optText("title").ifBlank { "会话" }
                },
                trailing = {
                    if (snapshot != null) {
                        val runStatus = state.run?.status ?: snapshot.optText("status")
                        PanelStatus(statusLabel(runStatus), statusTone(runStatus))
                    }
                },
            )

            if (pending.isNotEmpty()) {
                PendingApprovals(
                    approvals = pending,
                    state = state,
                    actions = actions,
                    canMutate = state.canSendSideEffect(),
                    modifier = Modifier.widthIn(max = 1040.dp),
                )
            }

            PanelTabRow(
                tabs = listOf(
                    PanelTabItem(
                        id = "progress",
                        label = "计划与进度",
                        badge = when {
                            pending.isNotEmpty() -> pending.size.toString()
                            currentProgress != null -> "${currentProgress.completed}/${currentProgress.total}"
                            else -> null
                        },
                        tag = "inspector-tab-progress",
                    ),
                    PanelTabItem(
                        id = "files",
                        label = "文件",
                        badge = changes.size.takeIf { it > 0 }?.toString(),
                        tag = "inspector-tab-files",
                    ),
                    PanelTabItem(id = "info", label = "会话信息", tag = "inspector-tab-info"),
                ),
                selectedId = tab,
                onSelect = { tab = it },
            )

            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.widthIn(max = if (wide) 1040.dp else 720.dp).fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    val notice = state.workbench.notice
                    if (!notice.isNullOrBlank()) {
                        PanelNotice(notice, onDismiss = actions::dismissPanelNotice)
                    }
                    if (snapshot == null) {
                        MissingSession(state, actions, onClose)
                    } else {
                        when (tab) {
                            "progress" -> ProgressTab(
                                snapshot = snapshot,
                                state = state,
                                actions = actions,
                                plans = plans,
                                currentPlan = currentPlan,
                                canMutate = state.canSendSideEffect(),
                            )
                            "files" -> FilesTab(
                                snapshot = snapshot,
                                state = state,
                                actions = actions,
                                filesTab = filesTab,
                                onFilesTab = { filesTab = it },
                                canMutate = state.canSendSideEffect(),
                            )
                            else -> InfoTab(
                                snapshot = snapshot,
                                state = state,
                                actions = actions,
                                infoTab = infoTab,
                                onInfoTab = { infoTab = it },
                                canMutate = state.canSendSideEffect(),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MissingSession(state: ChatUiState, actions: ChatActions, onClose: () -> Unit) {
    if (state.selectedId == null) {
        PanelEmpty(
            title = "选择一个会话",
            message = "执行详情只显示当前选中会话的计划、文件、审批与运行诊断。",
            actionLabel = "返回工作台",
            onAction = onClose,
        )
    } else if (state.panelLoading("session")) {
        PanelLoading("正在读取执行记录…")
    } else {
        val error = state.panelError("session")
        if (error != null) {
            PanelError(error, onRetry = { actions.loadPanel("session") })
        } else {
            PanelEmpty(
                title = "还没有执行记录",
                message = "已选择会话，但分页快照尚未返回。",
                actionLabel = if (state.isConnected()) "读取执行详情" else null,
                onAction = if (state.isConnected()) ({ actions.loadPanel("session") }) else null,
            )
        }
    }
}

@Composable
private fun PendingApprovals(
    approvals: List<Approval>,
    state: ChatUiState,
    actions: ChatActions,
    canMutate: Boolean,
    modifier: Modifier = Modifier,
) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(
            modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PanelSection(
                title = "待批准（${approvals.size}）",
                subtitle = "审批只对本次请求有效。命令不是 OS 沙箱，请在批准前核对。",
            ) {
                approvals.forEach { approval ->
                    val selectedSession = approval.sessionId == state.selectedId
                    InspectorApprovalCard(
                        approval = approval,
                        selectedSession = selectedSession,
                        canMutate = canMutate,
                        canSwitch = !state.sending && !state.busy,
                        connected = state.isConnected(),
                        onOpenSession = { actions.selectSession(approval.sessionId) },
                        onAnswer = { actions.answerApproval(approval.id, it) },
                    )
                }
            }
        }
    }
}

@Composable
private fun InspectorApprovalCard(
    approval: Approval,
    selectedSession: Boolean,
    canMutate: Boolean,
    canSwitch: Boolean,
    connected: Boolean,
    onOpenSession: () -> Unit,
    onAnswer: (Boolean) -> Unit,
) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    approval.toolName.ifBlank { "工具调用" },
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                PanelStatus(
                    if (selectedSession) "当前会话" else "后台会话",
                    if (selectedSession) PanelTone.Accent else PanelTone.Warning,
                )
            }
            if (approval.description.isNotBlank()) {
                Text(approval.description, style = MaterialTheme.typography.bodySmall)
            }
            if (approval.command.isNotBlank()) {
                PanelCodeBlock(approval.command, maxLines = 24, emptyText = "")
            }
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (selectedSession) {
                    TextButton(
                        onClick = { onAnswer(true) },
                        enabled = canMutate,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("允许这一次") }
                    TextButton(
                        onClick = { onAnswer(false) },
                        enabled = canMutate,
                        modifier = Modifier.heightIn(min = 48.dp),
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text("拒绝") }
                } else {
                    OutlinedButton(
                        onClick = onOpenSession,
                        enabled = canSwitch && connected && !selectedSession,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("后台任务待批准 · 打开会话") }
                }
            }
            if (!canMutate && selectedSession) {
                Text(
                    if (!connected) "连接 Core 后才能处理审批。"
                    else "先等待当前操作完成并确认没有未确认结果，再处理审批。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ProgressTab(
    snapshot: JSONObject,
    state: ChatUiState,
    actions: ChatActions,
    plans: List<PlanUi>,
    currentPlan: PlanUi?,
    canMutate: Boolean,
) {
    val progress = currentPlan?.let(::planProgress)
    PanelSection(
        title = "计划进度",
        subtitle = "当前计划来自会话快照的 plan/plans 字段；不存在的 planDocument 不会伪造。",
        action = if (progress != null) {
            { PanelStatus("${progress.completed}/${progress.total} · ${progress.label}", statusTone(progress.status)) }
        } else null,
    ) {
        if (currentPlan == null) {
            PanelEmpty(
                title = "尚无已保存计划",
                message = "使用 Plan 模式请求只读规划后，步骤会出现在这里。",
            )
        } else {
            Text(
                currentPlan.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            val fraction = if (progress == null || progress.total == 0) 0f
            else progress.completed.toFloat() / progress.total
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier.fillMaxWidth().height(8.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PanelBadge("已完成 ${progress?.completed ?: 0}", PanelTone.Success)
                PanelBadge("进行中 ${progress?.active ?: 0}", PanelTone.Accent)
                PanelBadge("待处理 ${progress?.pending ?: 0}", PanelTone.Neutral)
            }
            PlanStepList(currentPlan.steps)
            if (currentPlan.explanation.isNotBlank()) {
                PanelDisclosure("Plan 文档", initiallyExpanded = true) {
                    MessageContent(currentPlan.explanation, markdown = true)
                }
            }
        }
        if (plans.size > 1) {
            PanelDisclosure("历史计划 ${plans.size - 1}") {
                plans.filter { it.id != currentPlan?.id }.forEach { plan ->
                    val historicalProgress = planProgress(plan)
                    Surface(
                        Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                "${plan.title} · ${historicalProgress.completed}/${historicalProgress.total}",
                                style = MaterialTheme.typography.titleSmall,
                            )
                            PlanStepList(plan.steps)
                            if (plan.explanation.isNotBlank()) {
                                Text(compactText(plan.explanation, 500), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }

    SubAgentsSection(snapshot, state, actions)

    PanelSection(
        title = "上下文与运行",
        subtitle = "压缩只改变模型使用的上下文，不会删除聊天或累计用量。",
    ) {
        val running = isRunning(snapshot, state)
        OutlinedButton(
            onClick = { actions.compactSession() },
            enabled = canMutate && !running,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Icon(Icons.Default.Refresh, null)
            Spacer(Modifier.width(8.dp))
            Text(if (running) "运行结束后可压缩" else "压缩上下文")
        }
        if (!canMutate) {
            Text(
                "连接 Core 且当前没有发送/忙碌/未确认结果时才能执行压缩。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PlanStepList(steps: List<PlanStepUi>) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        steps.forEach { step ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.Top) {
                Text(
                    when (step.status) {
                        "completed" -> "✓"
                        "in_progress" -> "●"
                        else -> "○"
                    },
                    Modifier.width(22.dp),
                    color = when (step.status) {
                        "completed" -> MaterialTheme.colorScheme.primary
                        "in_progress" -> MaterialTheme.colorScheme.tertiary
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(step.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(
                    stepStatusLabel(step.status),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun SubAgentsSection(snapshot: JSONObject, state: ChatUiState, actions: ChatActions) {
    val agents = remember(snapshot, state.sessions) { parseAgents(snapshot, state.sessions) }
    val parentId = snapshot.optText("parentSessionId")
    PanelSection(
        title = "子任务 ${if (agents.isNotEmpty()) "· ${agents.size}" else ""}",
        subtitle = "来自会话列表的子会话与 session snapshot 中的 agent_update 事件。",
        action = if (parentId.isNotBlank()) {
            {
                TextButton(
                    onClick = { actions.selectSession(parentId) },
                    enabled = !state.sending && !state.busy,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("打开父任务") }
            }
        } else null,
    ) {
        if (agents.isEmpty()) {
            PanelEmpty(
                title = "没有已保存的子任务",
                message = "只有模型实际派生子代理后，这里才会出现子会话或代理进度。",
            )
        } else {
            agents.forEach { agent ->
                Surface(
                    Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                agent.title,
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Medium,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            PanelStatus(statusLabel(agent.status), statusTone(agent.status))
                        }
                        if (agent.model.isNotBlank()) {
                            PanelInfoRow("模型", agent.model, mono = true)
                        }
                        if (agent.summary.isNotBlank()) {
                            Text(compactText(agent.summary, 600), style = MaterialTheme.typography.bodySmall)
                        }
                        if (agent.currentTool.isNotBlank()) {
                            Text(
                                "当前工具 · ${agent.currentTool}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(
                            onClick = { actions.selectSession(agent.id) },
                            enabled = !state.sending && !state.busy,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text("打开子会话") }
                    }
                }
            }
        }
        if (snapshot.optText("agentTask").isNotBlank()) {
            PanelDisclosure("查看子任务指令") {
                MessageContent(snapshot.optText("agentTask"), markdown = true)
            }
        }
        if (snapshot.optText("ownership").isNotBlank()) {
            Text("负责范围：${snapshot.optText("ownership")}", style = MaterialTheme.typography.bodySmall)
        }
        val worktree = snapshot.optJSONObject("agentWorktree")
        if (worktree != null) {
            PanelInfoRow("工作树", worktree.optText("worktree"), mono = true)
        }
    }
}

@Composable
private fun FilesTab(
    snapshot: JSONObject,
    state: ChatUiState,
    actions: ChatActions,
    filesTab: String,
    onFilesTab: (String) -> Unit,
    canMutate: Boolean,
) {
    val changes = remember(snapshot) { snapshot.optObjects("changes") }
    PanelTabRow(
        tabs = listOf(
            PanelTabItem("browser", "文件管理", tag = "inspector-files-browser"),
            PanelTabItem(
                "changes",
                "变更与检查点",
                badge = changes.size.takeIf { it > 0 }?.toString(),
                tag = "inspector-files-changes",
            ),
        ),
        selectedId = filesTab,
        onSelect = onFilesTab,
        modifier = Modifier.fillMaxWidth(),
    )
    if (filesTab == "browser") {
        WorkspaceBrowser(snapshot, state, actions)
    } else {
        ChangesAndCheckpoints(snapshot, state, actions, changes, canMutate)
    }
}

@Composable
private fun WorkspaceBrowser(snapshot: JSONObject, state: ChatUiState, actions: ChatActions) {
    var currentPath by rememberSaveable(snapshot.optText("id")) { mutableStateOf(".") }
    var filter by rememberSaveable(snapshot.optText("id")) { mutableStateOf("") }
    var previewPath by rememberSaveable(snapshot.optText("id")) { mutableStateOf<String?>(null) }
    var refreshTick by remember { mutableStateOf(0) }
    val connected = state.isConnected()
    val listingRaw = state.workbench.values["files"]
    val listing = remember(listingRaw) {
        listingRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    }
    val previewRaw = state.workbench.values["preview"]
    val preview = remember(previewRaw) {
        previewRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
    }
    val pathMismatch = listing != null && normalizePath(listing.optText("path")) != normalizePath(currentPath)

    LaunchedEffect(snapshot.optText("id"), currentPath, refreshTick, connected) {
        if (connected) actions.browseFiles(currentPath)
    }
    LaunchedEffect(previewPath, snapshot.optText("id"), connected) {
        val path = previewPath
        if (path != null && connected) actions.previewFile(path)
    }

    PanelSection(
        title = "工作区文件",
        subtitle = snapshot.optText("workspace"),
        action = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (currentPath != ".") {
                    TextButton(
                        onClick = {
                            val parent = listing?.optText("parentPath").orEmpty().ifBlank { parentPathOf(currentPath) }
                            currentPath = if (parent.isBlank()) "." else parent
                            previewPath = null
                        },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("上级") }
                }
                TextButton(
                    onClick = { refreshTick++ },
                    enabled = connected,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(4.dp))
                    Text("刷新")
                }
            }
        },
    ) {
        Text(
            snapshot.optText("workspace").ifBlank { "工作区路径未知" },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Breadcrumbs(currentPath, onNavigate = { currentPath = it; previewPath = null })
        OutlinedTextField(
            value = filter,
            onValueChange = { filter = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("筛选当前目录") },
            leadingIcon = {
                Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.width(20.dp))
            },
        )
        if (!connected) {
            PanelNotice("连接 Core 后才能读取工作区文件；不会读取本机应用目录。")
            return@PanelSection
        }
        val error = state.panelError("files")
        if (error != null) {
            PanelError(error, onRetry = { actions.browseFiles(currentPath) })
        }
        if (state.panelLoading("files") || pathMismatch) {
            PanelLoading("正在读取 ${currentPath.ifBlank { "." }}…")
        }
        if (!pathMismatch) {
            val entries = listing?.optObjects("entries").orEmpty()
                .filter { filter.isBlank() || it.optText("name").contains(filter, ignoreCase = true) }
            if (entries.isEmpty() && !state.panelLoading("files") && (listing != null || error == null)) {
                PanelEmpty(
                    title = if (filter.isBlank()) "这个目录是空的" else "没有匹配的文件",
                    message = if (filter.isBlank()) "不会回退到历史消息或本机文件系统。" else "清空筛选后再试。",
                )
            }
            entries.forEach { entry ->
                val isDirectory = entry.optText("kind") == "directory"
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .clickable {
                            if (isDirectory) {
                                currentPath = entry.optText("path").ifBlank { entry.optText("name") }
                                previewPath = null
                            } else {
                                previewPath = entry.optText("path")
                            }
                        }
                        .padding(vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (isDirectory) "目录" else "文件", Modifier.width(42.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        entry.optText("name").ifBlank { entry.optText("path") },
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (entry.hasValue("sizeBytes")) {
                        Text(
                            formatFileSize(entry.optLong("sizeBytes")),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (listing?.optBoolean("truncated") == true) {
                PanelNotice("目录条目超过 Core 单页上限，只显示前 500 项。")
            }
        }
    }

    if (previewPath != null) {
        val selected = previewPath
        PanelSection(
            title = "文件预览",
            subtitle = selected,
            action = {
                TextButton(onClick = { previewPath = null }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("关闭预览")
                }
            },
        ) {
            val previewError = state.panelError("preview")
            if (previewError != null) {
                PanelError(previewError, onRetry = { selected?.let(actions::previewFile) })
            }
            if (state.panelLoading("preview") || (preview != null && preview.optText("path") != selected)) {
                PanelLoading("正在读取文件…")
            }
            if (preview != null && preview.optText("path") == selected) {
                PanelInfoRow("大小", formatFileSize(preview.optLong("sizeBytes")))
                if (preview.optBoolean("binary")) {
                    PanelNotice("二进制文件不渲染内容。")
                } else {
                    if (preview.optBoolean("truncated")) {
                        PanelNotice("文件超过 Core 预览上限，内容已截断。")
                    }
                    PanelCodeBlock(preview.optText("content"), maxLines = 400, emptyText = "文件为空。")
                }
            }
        }
    }
}

@Composable
private fun Breadcrumbs(currentPath: String, onNavigate: (String) -> Unit) {
    val parts = currentPath.removePrefix("./").split('/').filter { it.isNotEmpty() }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = { onNavigate(".") }, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("根目录")
        }
        var accumulated = ""
        parts.forEach { part ->
            accumulated = if (accumulated.isEmpty()) part else "$accumulated/$part"
            Text("/", color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(
                onClick = { onNavigate(accumulated) },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(part, maxLines = 1) }
        }
    }
}

@Composable
private fun ChangesAndCheckpoints(
    snapshot: JSONObject,
    state: ChatUiState,
    actions: ChatActions,
    changes: List<JSONObject>,
    canMutate: Boolean,
) {
    var selectedCheckpoint by rememberSaveable { mutableStateOf<String?>(null) }
    var inspectError by remember { mutableStateOf<String?>(null) }
    var confirmRestore by remember { mutableStateOf<JSONObject?>(null) }
    var refreshCheckpoints by remember { mutableStateOf(0) }
    val connected = state.isConnected()
    val checkpoints = state.panelObjects("checkpoints", "checkpoints")
    val diff = state.workbench.values["diff"].orEmpty()
    val running = isRunning(snapshot, state)

    LaunchedEffect(snapshot.optText("id"), connected, refreshCheckpoints) {
        if (connected) actions.loadPanel("checkpoints")
    }

    PanelSection(
        title = "文件变更 · ${changes.size}",
        subtitle = "变更来自当前分页快照；未加载的早期回合不会在这里显示。",
    ) {
        if (changes.isEmpty()) {
            PanelEmpty(
                title = "当前窗口没有文件变更",
                message = "会话尚未修改文件，或相关回合还未加载。",
            )
        } else {
            changes.forEachIndexed { index, change ->
                ChangeCard(change, index)
            }
        }
    }

    PanelSection(
        title = "文件检查点",
        subtitle = "只恢复选中的文件，不执行 git reset。命令副作用不在备份范围内。",
        action = {
            TextButton(
                onClick = { refreshCheckpoints++ },
                enabled = connected,
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Icon(Icons.Default.Refresh, null)
                Spacer(Modifier.width(4.dp))
                Text("刷新")
            }
        },
    ) {
        val error = state.panelError("checkpoints")
        if (error != null) PanelError(error, onRetry = { refreshCheckpoints++ })
        if (state.panelLoading("checkpoints")) PanelLoading("正在读取检查点…")
        if (checkpoints.isEmpty() && !state.panelLoading("checkpoints") && error == null) {
            PanelEmpty(
                title = "没有可用检查点",
                message = "文件工具执行后，服务器保存的检查点会出现在这里。",
            )
        }
        checkpoints.forEach { checkpoint ->
            val id = checkpoint.optText("id")
            val completed = checkpoint.optText("state") == "completed"
            Surface(
                Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(checkpoint.optText("path"), style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        PanelStatus(checkpoint.optText("state"), statusTone(checkpoint.optText("state")))
                        PanelBadge(checkpoint.optText("kind"))
                        Text(
                            formatTimestamp(checkpoint.optText("createdAt")),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(
                            onClick = {
                                inspectError = null
                                selectedCheckpoint = id
                                actions.inspectCheckpoint(id)
                            },
                            enabled = connected && !state.busy,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text("查看差异") }
                        TextButton(
                            onClick = { confirmRestore = checkpoint },
                            enabled = canMutate && !running && completed,
                            modifier = Modifier.heightIn(min = 48.dp),
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) { Text("恢复此文件") }
                    }
                }
            }
        }
        if (selectedCheckpoint != null) {
            val selected = checkpoints.find { it.optText("id") == selectedCheckpoint }
            PanelDivider()
            Text(
                selected?.optText("path") ?: selectedCheckpoint.orEmpty(),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            val diffError = state.panelError("diff") ?: inspectError
            if (diffError != null) {
                PanelError(diffError, onRetry = { selectedCheckpoint?.let(actions::inspectCheckpoint) })
            }
            if (state.panelLoading("diff")) {
                PanelLoading("正在读取差异…")
            } else {
                PanelCodeBlock(diff, maxLines = 320, emptyText = "Core 没有返回差异内容。")
            }
            TextButton(
                onClick = { selectedCheckpoint = null },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("收起差异") }
        }
        if (!canMutate && checkpoints.isNotEmpty()) {
            Text(
                "恢复需要连接 Core，且当前没有发送/忙碌/未确认结果。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (running) {
            Text(
                "会话运行期间禁用恢复；先停止或等待任务结束。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    val restore = confirmRestore
    if (restore != null) {
        PanelConfirmDialog(
            title = "确认恢复文件",
            text = "将 ${restore.optText("path")} 恢复到检查点 ${restore.optText("id")}。" +
                "如果文件已被其他操作修改，Core 可能拒绝以避免冲突；界面不会绕过此拒绝。",
            confirmLabel = "确认恢复此文件",
            danger = true,
            enabled = canMutate && !running,
            onConfirm = {
                actions.restoreCheckpoint(restore.optText("id"))
                confirmRestore = null
            },
            onDismiss = { confirmRestore = null },
        )
    }
}

@Composable
private fun ChangeCard(change: JSONObject, index: Int) {
    val path = change.optText("path")
    val patch = change.optJSONObject("patch")
    val added = patch?.optInt("added", -1) ?: -1
    val removed = patch?.optInt("removed", -1) ?: -1
    val status = patch?.optText("status").orEmpty()
    Surface(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(path, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                PanelBadge(
                    when (change.optText("kind")) {
                        "created" -> "新增"
                        "deleted" -> "已删"
                        else -> "已改"
                    },
                    when (change.optText("kind")) {
                        "created" -> PanelTone.Success
                        "deleted" -> PanelTone.Danger
                        else -> PanelTone.Warning
                    },
                )
            }
            if (added >= 0 || removed >= 0 || status.isNotBlank()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (added >= 0) Text("+$added", color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelSmall)
                    if (removed >= 0) Text("-$removed", color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelSmall)
                    if (status.isNotBlank()) {
                        Text(
                            when (status) {
                                "truncated" -> "差异已截断"
                                "unavailable" -> "差异不可用"
                                else -> "差异完整"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (patch != null) {
                PanelDisclosure("查看差异", initiallyExpanded = index < 1) {
                    PanelCodeBlock(
                        patchText(patch),
                        maxLines = 260,
                        emptyText = "此变更没有可显示的 hunk。",
                    )
                }
            } else {
                Text(
                    "历史变更没有可用 patch；不会伪造差异。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun InfoTab(
    snapshot: JSONObject,
    state: ChatUiState,
    actions: ChatActions,
    infoTab: String,
    onInfoTab: (String) -> Unit,
    canMutate: Boolean,
) {
    PanelTabRow(
        tabs = listOf(
            PanelTabItem("overview", "会话概览", tag = "inspector-info-overview"),
            PanelTabItem("resources", "项目资源", tag = "inspector-info-resources"),
        ),
        selectedId = infoTab,
        onSelect = onInfoTab,
        modifier = Modifier.fillMaxWidth(),
    )
    if (infoTab == "overview") {
        SessionOverview(snapshot, state, actions, canMutate)
    } else {
        ProjectResourcesSection(snapshot, state, actions)
    }
}

@Composable
private fun SessionOverview(
    snapshot: JSONObject,
    state: ChatUiState,
    actions: ChatActions,
    canMutate: Boolean,
) {
    val sessionId = snapshot.optText("id")
    var renameOpen by remember { mutableStateOf(false) }
    var confirmArchive by remember { mutableStateOf(false) }
    var confirmFork by remember { mutableStateOf(false) }
    var confirmCompact by remember { mutableStateOf(false) }
    val diagnostics = state.panelObject("diagnostics")
    val connected = state.isConnected()
    val running = isRunning(snapshot, state)
    val runStarted = remember(snapshot) { lastEvent(snapshot, "run_started") }
    val finished = remember(snapshot) { lastEvent(snapshot, "run_finished") }
    val model = runStarted?.optText("model").orEmpty().ifBlank { snapshot.optText("model") }
    val permission = runStarted?.optText("permission").orEmpty()
        .ifBlank { snapshot.optText("permissionCeiling") }
        .ifBlank { state.permission }
    val status = state.run?.status ?: snapshot.optText("status")
    val usage = finished?.optJSONObject("usage")
    val totalUsage = finished?.optJSONObject("totalUsage") ?: usage
    val contextUsage = remember(snapshot) { lastEvent(snapshot, "context_usage")?.optJSONObject("usage") }

    LaunchedEffect(sessionId, connected) {
        if (connected) actions.loadPanel("diagnostics")
    }

    PanelSection(
        title = "会话概览",
        subtitle = sessionId,
        action = {
            TextButton(
                onClick = { actions.loadPanel("session"); actions.loadPanel("diagnostics") },
                enabled = connected,
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Icon(Icons.Default.Refresh, null)
                Spacer(Modifier.width(4.dp))
                Text("刷新")
            }
        },
    ) {
        PanelInfoRow("标题", snapshot.optText("title"))
        PanelInfoRow("模型", model, mono = true)
        PanelInfoRow("状态", statusLabel(status))
        PanelInfoRow("权限", inspectorPermissionLabel(permission))
        PanelInfoRow("工作区", snapshot.optText("workspace"), mono = true)
        PanelInfoRow("会话 ID", sessionId, mono = true)
        PanelInfoRow("创建", formatTimestamp(snapshot.optText("createdAt")))
        PanelInfoRow("更新", formatTimestamp(snapshot.optText("updatedAt")))
        if (snapshot.optText("parentSessionId").isNotBlank()) {
            PanelInfoRow("父会话", snapshot.optText("parentSessionId"), mono = true)
        }
        if (snapshot.hasValue("archived") && snapshot.optBoolean("archived")) {
            PanelStatus("已归档", PanelTone.Warning)
        }
        PanelDivider()
        Text("用量诊断", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        val diagnosticsError = state.panelError("diagnostics")
        if (diagnosticsError != null) {
            PanelError(diagnosticsError, onRetry = { actions.loadPanel("diagnostics") })
        } else if (state.panelLoading("diagnostics")) {
            PanelLoading("正在读取上下文统计…")
        } else if (diagnostics == null) {
            Text("尚未读取诊断。", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            PanelInfoRow("原始字符", formatCount(diagnostics.optLong("transcriptChars").toLong()))
            PanelInfoRow("投影字符", formatCount(diagnostics.optLong("projectedChars").toLong()))
            PanelInfoRow("消息数", formatCount(diagnostics.optLong("messageCount").toLong()))
            PanelInfoRow(
                "摘要类型",
                if (diagnostics.optBoolean("summaryFallback")) "摘录回退（非语义摘要）" else "语义摘要 / 未压缩",
            )
        }
        if (totalUsage != null) {
            PanelInfoRow("最近已报运行 Tokens", formatCount(totalUsage.optLong("totalTokens").toLong()))
            PanelInfoRow(
                "输入 / 输出",
                "${formatCount(totalUsage.optLong("promptTokens").toLong())} / " +
                    formatCount(totalUsage.optLong("completionTokens").toLong()),
            )
            val cached = totalUsage.optLong("cachedPromptTokens", -1)
            if (cached >= 0) PanelInfoRow("缓存输入", formatCount(cached))
        } else if (contextUsage != null) {
            PanelInfoRow("上下文 Tokens", formatCount(contextUsage.optLong("usedTokens").toLong()))
        }
        if (finished != null) {
            PanelInfoRow(
                "最近运行",
                "步骤 ${finished.optInt("steps", finished.optInt("turns", 0))} · " +
                    "工具 ${finished.optInt("toolCalls", 0)} · 重试 ${finished.optInt("retries", 0)}",
            )
        }
        val contextSummary = snapshot.optJSONObject("contextSummary")
        if (contextSummary != null) {
            PanelDisclosure(
                "已保存摘要 · 边界 ${contextSummary.optInt("boundary", 0)}" +
                    if (contextSummary.optBoolean("fallback")) " · 摘录回退" else "",
            ) {
                PanelCodeBlock(
                    contextSummary.optText("content"),
                    maxLines = 220,
                    emptyText = "摘要内容为空。",
                )
            }
        }
    }

    PanelSection(
        title = "会话操作",
        subtitle = "所有副作用都要求连接 Core，并在 busy/sending/uncertain 时禁用。",
    ) {
        OutlinedButton(
            onClick = { renameOpen = true },
            enabled = canMutate,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Icon(Icons.Default.Edit, null); Spacer(Modifier.width(8.dp)); Text("重命名会话") }
        OutlinedButton(
            onClick = { confirmArchive = true },
            enabled = canMutate,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text(if (snapshot.optBoolean("archived")) "取消归档" else "归档会话")
        }
        OutlinedButton(
            onClick = { confirmFork = true },
            enabled = canMutate,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("分叉会话")
        }
        OutlinedButton(
            onClick = { confirmCompact = true },
            enabled = canMutate && !running,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text(if (running) "运行结束后才能压缩" else "压缩上下文") }
    }

    if (renameOpen) {
        var title by remember(sessionId) { mutableStateOf(snapshot.optText("title")) }
        AlertDialog(
            onDismissRequest = { renameOpen = false },
            title = { Text("重命名会话") },
            text = {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("标题") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val value = title.trim()
                        if (value.isNotEmpty()) actions.renameSession(sessionId, value)
                        renameOpen = false
                    },
                    enabled = canMutate && title.trim().isNotEmpty(),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { renameOpen = false }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("取消")
                }
            },
        )
    }
    if (confirmArchive) {
        val archived = snapshot.optBoolean("archived")
        PanelConfirmDialog(
            title = if (archived) "取消归档此会话？" else "归档此会话？",
            text = if (archived) "会话会重新出现在主列表；不会自动开始运行。"
            else "归档后主列表会隐藏该会话，但历史仍保留在服务器。不会停止正在运行的任务或删除记录。",
            confirmLabel = if (archived) "取消归档" else "归档",
            enabled = canMutate,
            onConfirm = {
                actions.archiveSession(sessionId, !archived)
                confirmArchive = false
            },
            onDismiss = { confirmArchive = false },
        )
    }
    if (confirmFork) {
        PanelConfirmDialog(
            title = "分叉当前会话？",
            text = "将基于当前会话创建一个独立的新会话，原会话保留。分叉边界由 Core 决定，失败时不会自动重试。",
            confirmLabel = "确认分叉",
            enabled = canMutate,
            onConfirm = {
                actions.forkSession(sessionId)
                confirmFork = false
            },
            onDismiss = { confirmFork = false },
        )
    }
    if (confirmCompact) {
        PanelConfirmDialog(
            title = "压缩上下文？",
            text = "只压缩模型后续使用的上下文，保留原始记录和累计用量。当前运行不会被中断，运行中不可压缩。",
            confirmLabel = "确认压缩",
            enabled = canMutate && !running,
            onConfirm = {
                actions.compactSession()
                confirmCompact = false
            },
            onDismiss = { confirmCompact = false },
        )
    }
}

@Composable
private fun ProjectResourcesSection(
    snapshot: JSONObject,
    state: ChatUiState,
    actions: ChatActions,
) {
    val connected = state.isConnected()
    val context = state.panelObject("context")
    val error = state.panelError("context")
    LaunchedEffect(snapshot.optText("id"), connected) {
        if (connected) actions.loadPanel("context")
    }
    PanelSection(
        title = "项目指令与技能",
        subtitle = "只显示公开元数据；技能正文由模型按需加载，不授予额外权限。",
        action = {
            TextButton(
                onClick = { actions.loadPanel("context") },
                enabled = connected,
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Icon(Icons.Default.Refresh, null)
                Spacer(Modifier.width(4.dp))
                Text("重新读取")
            }
        },
    ) {
        if (error != null) PanelError(error, onRetry = { actions.loadPanel("context") })
        if (state.panelLoading("context")) PanelLoading("正在读取项目上下文…")
        if (context == null && !state.panelLoading("context") && error == null) {
            PanelEmpty(title = "尚未读取项目资源", message = "点击“重新读取”从 Core 获取。")
        }
        if (context != null) {
            val counts = context.optJSONObject("counts")
            Text(
                "${counts?.optInt("instructions", 0) ?: 0} 个指令来源 · " +
                    "${counts?.optInt("skills", 0) ?: 0} 个技能 · " +
                    "${counts?.optInt("warnings", 0) ?: 0} 个警告",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            if (context.optText("workspace").isNotBlank()) {
                PanelInfoRow("工作区", context.optText("workspace"), mono = true)
            }
            val instructions = context.optObjects("instructionSources")
            if (instructions.isEmpty()) {
                Text("没有发现项目指令文件。", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text("指令来源", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                instructions.forEach { source ->
                    Surface(
                        Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.small,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text(source.optText("path"), style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium)
                            Text(
                                "顺序 ${source.optInt("order", 0)} · ${source.optLong("bytes").toLong()} 字节",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            val skills = context.optObjects("skills")
            if (skills.isNotEmpty()) {
                Text("技能", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                skills.forEach { skill ->
                    PanelDisclosure(
                        "${skill.optText("name").ifBlank { skill.optText("id") }}" +
                            skill.optText("version").takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty(),
                    ) {
                        if (skill.optText("description").isNotBlank()) {
                            Text(skill.optText("description"), style = MaterialTheme.typography.bodySmall)
                        }
                        PanelInfoRow("ID", skill.optText("id"), mono = true)
                        PanelInfoRow("来源", skill.optText("provenance"))
                        PanelInfoRow("目录", skill.optText("sourceDirectory"), mono = true)
                    }
                }
            }
            val warnings = context.optStrings("warnings")
            warnings.forEach { warning ->
                PanelError(warning)
            }
        }
    }
}

private data class PlanStepUi(val text: String, val status: String)

private data class PlanUi(
    val id: String,
    val title: String,
    val explanation: String,
    val steps: List<PlanStepUi>,
)

private data class PlanProgressUi(
    val completed: Int,
    val active: Int,
    val pending: Int,
    val total: Int,
    val status: String,
) {
    val label: String
        get() = when {
            total > 0 && completed == total -> "已完成"
            active > 0 -> "进行中"
            else -> "待处理"
        }
}

private fun parsePlans(snapshot: JSONObject?): List<PlanUi> {
    if (snapshot == null) return emptyList()
    val plans = LinkedHashMap<String, PlanUi>()
    snapshot.optObjects("plans").forEach { plan ->
        val id = plan.optText("id").ifBlank { "legacy" }
        plans[id] = planOf(plan, id)
    }
    val current = snapshot.optJSONObject("plan")
    if (current != null) {
        val id = current.optText("id").ifBlank { "legacy" }
        plans[id] = planOf(current, id)
    }
    return plans.values.toList()
}

private fun planOf(plan: JSONObject, id: String): PlanUi = PlanUi(
    id = id,
    title = plan.optText("title").ifBlank { "原有计划" },
    explanation = plan.optText("explanation"),
    steps = plan.optObjects("steps").map {
        PlanStepUi(it.optText("step"), it.optText("status"))
    },
)

private fun currentPlanOf(plans: List<PlanUi>, snapshot: JSONObject?): PlanUi? {
    if (plans.isEmpty()) return null
    val current = snapshot?.optJSONObject("plan") ?: return plans.lastOrNull()
    val id = current.optText("id").ifBlank { "legacy" }
    return plans.find { it.id == id } ?: plans.lastOrNull()
}

private fun planProgress(plan: PlanUi): PlanProgressUi {
    val completed = plan.steps.count { it.status == "completed" }
    val active = plan.steps.count { it.status == "in_progress" }
    val pending = plan.steps.count { it.status == "pending" }
    return PlanProgressUi(completed, active, pending, plan.steps.size,
        when {
            plan.steps.isNotEmpty() && completed == plan.steps.size -> "completed"
            active > 0 -> "running"
            else -> "pending"
        })
}

private data class AgentUi(
    val id: String,
    val title: String,
    val status: String,
    val model: String,
    val summary: String,
    val currentTool: String,
)

private fun parseAgents(snapshot: JSONObject, sessions: List<SessionSummary>): List<AgentUi> {
    val updates = LinkedHashMap<String, JSONObject>()
    snapshot.optObjects("workbenchEvents").forEach { event ->
        if (event.optText("type") == "agent_update") {
            val child = event.optText("childSessionId")
            if (child.isNotBlank()) updates[child] = event
        }
    }
    val children = sessions.filter { it.parentSessionId == snapshot.optText("id") }
    val ids = LinkedHashSet<String>()
    ids.addAll(children.map { it.id })
    ids.addAll(updates.keys)
    return ids.map { id ->
        val child = children.find { it.id == id }
        val update = updates[id]
        val tool = update?.optJSONObject("currentTool")
        AgentUi(
            id = id,
            title = child?.title?.takeIf { it.isNotBlank() } ?: "子代理 ${id.take(8)}",
            status = update?.optText("status").orEmpty().ifBlank { child?.status.orEmpty() },
            model = update?.optText("model").orEmpty().ifBlank { child?.model.orEmpty() },
            summary = update?.optText("summary").orEmpty(),
            currentTool = tool?.let {
                it.optText("name") + if (it.optText("target").isNotBlank()) " · ${it.optText("target")}" else ""
            }.orEmpty(),
        )
    }.sortedBy { it.title }
}

private fun lastEvent(snapshot: JSONObject, type: String): JSONObject? =
    snapshot.optObjects("workbenchEvents").lastOrNull { it.optText("type") == type }

private fun isRunning(snapshot: JSONObject, state: ChatUiState): Boolean {
    val status = state.run?.status ?: snapshot.optText("status")
    return status == "running" || status == "awaiting_approval"
}

private fun normalizePath(path: String): String =
    path.trim().removePrefix("./").trimEnd('/').ifBlank { "." }

private fun parentPathOf(path: String): String {
    val normalized = normalizePath(path)
    if (normalized == "." || normalized.isEmpty()) return "."
    val slash = normalized.lastIndexOf('/')
    return if (slash <= 0) "." else normalized.substring(0, slash)
}

private fun patchText(patch: JSONObject): String {
    val text = StringBuilder()
    val status = patch.optText("status")
    if (status == "truncated") text.appendLine("# 差异已截断")
    if (status == "unavailable") {
        text.appendLine("# 差异不可用：${patch.optText("reason").ifBlank { "未知原因" }}")
    }
    patch.optObjects("hunks").forEach { hunk ->
        text.appendLine(
            "@@ -${hunk.optInt("oldStart", 0)},${hunk.optInt("oldLines", 0)} " +
                "+${hunk.optInt("newStart", 0)},${hunk.optInt("newLines", 0)} @@",
        )
        hunk.optObjects("lines").forEach { line ->
            val prefix = when (line.optText("op")) {
                "insert" -> "+"
                "delete" -> "-"
                else -> " "
            }
            text.append(prefix).appendLine(line.optText("text"))
        }
    }
    return text.toString().trimEnd()
}

private fun statusLabel(status: String): String = when (status) {
    "idle" -> "空闲"
    "running" -> "运行中"
    "awaiting_approval" -> "等待审批"
    "completed" -> "已完成"
    "cancelled" -> "已取消"
    "failed" -> "失败"
    "interrupted" -> "已中断"
    "paused" -> "已暂停"
    "ready" -> "就绪"
    "" -> "未知"
    else -> status
}

private fun stepStatusLabel(status: String): String = when (status) {
    "completed" -> "已完成"
    "in_progress" -> "进行中"
    "pending" -> "待处理"
    else -> status
}

private fun inspectorPermissionLabel(permission: String): String = when (permission) {
    "readonly" -> "只读"
    "workspace" -> "工作区 · 工具需审批"
    "unrestricted" -> "无限制（高风险）"
    else -> permission.ifBlank { "未知" }
}
