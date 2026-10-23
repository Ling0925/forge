package dev.forge.nativeapp.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import org.json.JSONArray
import org.json.JSONObject

/**
 * The single warm composer card.  Runtime queueing and steering are explicit,
 * images are picked through the Android photo picker, and the global reasoning
 * effort is never smuggled into a RunInput.
 */
@Composable
fun ForgeComposer(
    state: ChatUiState,
    actions: ChatActions,
    isNew: Boolean,
    onOpenModelPicker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalForgePalette.current
    val compact = LocalConfiguration.current.screenWidthDp <= 1000
    val connected = state.connection == ConnectionPhase.Connected
    val mutationLocked = !connected || state.sending || state.busy || state.uncertain
    val canNavigate = !state.sending && !state.busy
    val actionSize = if (compact) 44.dp else 32.dp
    val fieldFont = 15.sp
    val hasContent = state.draft.isNotBlank() || state.draftImages.isNotEmpty()

    val selectedSession = state.sessions.firstOrNull { it.id == state.selectedId }
    val currentWorkspace = if (isNew) {
        state.selectedWorkspace.ifBlank { state.workspace }
    } else {
        selectedSession?.workspace ?: state.workspace
    }
    val workspaceEditable = isNew && !state.restrictWorkspace && canNavigate

    val settingsJson = state.workbench.obj("settings")
    val effort = settingsJson?.optString("reasoningEffort").orEmpty().ifBlank { "default" }
    val activeSourceId = state.providerSourceId.ifBlank {
        settingsJson?.optString("activeSourceId").orEmpty()
    }
    val routeLabel = settingsJson?.optJSONArray("routeGroups")?.let { routes ->
        findJsonLabel(routes, state.routeGroupId)
    }.orEmpty()
    val sourceLabel = settingsJson?.optJSONArray("providerSources")?.let { sources ->
        findJsonLabel(sources, activeSourceId)
    }.orEmpty()
    val sourceModel = settingsJson?.optJSONArray("providerSources")?.let { sources ->
        findJsonModel(sources, activeSourceId)
    }.orEmpty()
    val modelLabel = when {
        routeLabel.isNotBlank() -> routeLabel
        state.selectedModel.isNotBlank() -> state.selectedModel
        sourceModel.isNotBlank() -> sourceModel
        else -> "默认模型"
    }
    val modelDescription = buildString {
        append("选择模型和思考强度：")
        append(modelLabel)
        if (sourceLabel.isNotBlank() && routeLabel.isBlank()) append("，来源 ").append(sourceLabel)
        append("，思考强度 ").append(reasoningEffortLabel(effort))
    }

    var workspaceMenu by remember { mutableStateOf(false) }
    var workspaceDialog by remember { mutableStateOf(false) }
    var modeMenu by remember { mutableStateOf(false) }
    var permissionMenu by remember { mutableStateOf(false) }
    var unrestrictedConfirm by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    var queueExpanded by rememberSaveable(state.selectedId) { mutableStateOf(false) }

    val queueSnapshot = remember(state.workbench.values["queue"]) {
        parseQueueSnapshot(state.workbench.values["queue"])
    }
    val queueItems = remember(queueSnapshot) { queueSnapshot?.optJSONArray("items").jsonObjects() }
    val queuePaused = queueSnapshot?.optBoolean("paused") == true
    val queueLoading = state.workbench.loading.contains("queue")
    val queueError = state.workbench.errors["queue"].orEmpty()
    val queueVisible = queueError.isNotBlank() || queuePaused || queueItems.isNotEmpty()

    LaunchedEffect(state.selectedId, state.run?.id) {
        if (state.connection == ConnectionPhase.Connected && state.selectedId != null) {
            actions.loadPanel("queue")
        }
    }
    LaunchedEffect(state.connection, settingsJson == null) {
        if (state.connection == ConnectionPhase.Connected && settingsJson == null) {
            actions.loadPanel("settings")
        }
    }
    LaunchedEffect(mutationLocked) {
        if (mutationLocked) {
            modeMenu = false
            permissionMenu = false
            unrestrictedConfirm = false
        }
    }

    val imageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(4),
    ) { uris ->
        val freeSlots = (4 - state.draftImages.size).coerceAtLeast(0)
        if (uris.isNotEmpty() && freeSlots > 0) {
            actions.addImages(uris.take(freeSlots).map { it.toString() })
        }
    }

    val sendEnabled = connected && !state.sending && !state.busy && !state.uncertain &&
        !state.loading && state.run == null && hasContent
    val stopEnabled = connected && !state.busy && !state.uncertain && state.run != null
    val queueEnabled = !mutationLocked && state.run != null && hasContent
    val steerEnabled = !mutationLocked && state.run != null && hasContent
    val imageEnabled = !mutationLocked && state.draftImages.size < 4

    Column(modifier.fillMaxWidth()) {
        // Workspace is a quiet context row above the card, matching the Web
        // workbench's `.composer-project` trigger.  The rail shows a short leaf
        // name; the full absolute path stays in the semantics.
        Box {
                Surface(
                    onClick = {
                        if (workspaceEditable) workspaceMenu = true
                    },
                    enabled = workspaceEditable,
                    shape = RoundedCornerShape(ForgeDimens.radiusSm),
                    color = if (workspaceEditable) palette.soft else androidx.compose.ui.graphics.Color.Transparent,
                    contentColor = palette.textSecondary,
                    modifier = Modifier.heightIn(min = if (compact) 32.dp else 28.dp)
                        .semantics { contentDescription = "工作区：$currentWorkspace" },
                ) {
                    Row(
                        Modifier.padding(horizontal = 7.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FolderGlyph(open = true, modifier = Modifier.size(12.dp), tint = palette.textMuted)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = workspaceLeaf(currentWorkspace).ifBlank { "工作区未读取" },
                            fontSize = 10.5.sp,
                            lineHeight = 15.sp,
                            fontFamily = ForgeMonoFamily,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 200.dp),
                        )
                        if (state.restrictWorkspace || !isNew) {
                            Spacer(Modifier.width(5.dp))
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = if (state.restrictWorkspace) "工作区已限制" else "会话工作区固定",
                                tint = palette.textMuted,
                                modifier = Modifier.size(10.dp),
                            )
                        }
                        if (workspaceEditable) {
                            Spacer(Modifier.width(2.dp))
                            Icon(
                                Icons.Default.KeyboardArrowDown,
                                null,
                                tint = palette.textMuted,
                                modifier = Modifier.size(13.dp),
                            )
                        }
                    }
                }
                ForgeMenu(expanded = workspaceMenu, onDismissRequest = { workspaceMenu = false }) {
                    val workspaces = remember(state.sessions, state.workspace, state.selectedWorkspace) {
                        (listOf(state.workspace, state.selectedWorkspace) + state.sessions.map { it.workspace })
                            .filter { it.isNotBlank() }
                            .distinct()
                    }
                    workspaces.forEach { workspace ->
                        ForgeMenuItem(
                            text = workspaceLeaf(workspace),
                            subtitle = workspace,
                            onClick = {
                                actions.setWorkspace(workspace)
                                workspaceMenu = false
                            },
                        )
                    }
                    if (workspaces.isNotEmpty()) ForgeMenuDivider()
                    ForgeMenuItem(
                        text = "手动输入路径…",
                        onClick = {
                            workspaceMenu = false
                            workspaceDialog = true
                        },
                    )
                }
            }
        Spacer(Modifier.height(6.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(ForgeDimens.radiusComposer),
            color = palette.elevated,
            contentColor = palette.textPrimary,
            border = BorderStroke(1.dp, if (focused) palette.borderHover else palette.borderControl),
            shadowElevation = 2.dp,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (state.draftImages.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.draftImages.forEachIndexed { index, image ->
                        Box(Modifier.size(72.dp)) {
                            ForgeImage(
                                image = image,
                                modifier = Modifier.fillMaxSize(),
                                maxDimension = 360,
                            )
                            IconButton(
                                onClick = { actions.removeImage(index) },
                                enabled = !mutationLocked,
                                modifier = Modifier.align(Alignment.TopEnd).size(44.dp),
                            ) {
                                Box(
                                    Modifier.size(24.dp).clip(CircleShape).background(palette.elevated.copy(alpha = 0.88f)),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        Icons.Default.Close,
                                        "移除图片 ${image.name}",
                                        tint = palette.textPrimary,
                                        modifier = Modifier.size(14.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (queueVisible) {
                QueueSection(
                    expanded = queueExpanded,
                    onToggle = { queueExpanded = !queueExpanded },
                    snapshot = queueSnapshot,
                    items = queueItems,
                    paused = queuePaused,
                    loading = queueLoading,
                    error = queueError,
                    canRefresh = connected,
                    canMutate = !mutationLocked,
                    onRefresh = { actions.loadPanel("queue") },
                    onPauseResume = { actions.pauseQueue(!queuePaused) },
                    onCancel = actions::cancelQueuedInput,
                    compact = compact,
                )
            }

            if (state.run != null) {
                Spacer(Modifier.height(6.dp))
                RunActivityRow(
                    waiting = state.approvals.isNotEmpty(),
                    busy = state.busy,
                    canQueue = queueEnabled,
                    canSteer = steerEnabled,
                    onQueue = actions::enqueueDraft,
                    onSteer = actions::steerDraft,
                )
            }

            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                BasicTextField(
                    value = state.draft,
                    onValueChange = actions::updateDraft,
                    textStyle = TextStyle(
                        color = palette.textPrimary,
                        fontSize = fieldFont,
                        lineHeight = 22.sp,
                        fontFamily = ForgeSansFamily,
                    ),
                    cursorBrush = SolidColor(palette.accent),
                    minLines = 1,
                    maxLines = 6,
                    modifier = Modifier.weight(1f)
                        .heightIn(min = 40.dp)
                        .onFocusChanged { focused = it.isFocused }
                        .testTag("composer"),
                    decorationBox = { innerTextField ->
                        Box(
                            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 10.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (state.draft.isEmpty()) {
                                Text(
                                    if (state.run == null) {
                                        "描述一项任务，或继续一个想法…"
                                    } else {
                                        "写下下一条消息，排队或插话…"
                                    },
                                    color = palette.textMuted,
                                    fontSize = fieldFont,
                                    lineHeight = 22.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
                Spacer(Modifier.width(4.dp))
                if (state.run != null) {
                    FilledIconButton(
                        onClick = actions::stop,
                        enabled = stopEnabled,
                        modifier = Modifier.size(38.dp).testTag("stop"),
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = palette.soft,
                            contentColor = palette.textPrimary,
                            disabledContainerColor = palette.soft,
                            disabledContentColor = palette.textMuted,
                        ),
                    ) {
                        StopGlyph(Modifier.size(16.dp))
                    }
                } else {
                    FilledIconButton(
                        onClick = actions::send,
                        enabled = sendEnabled,
                        modifier = Modifier.size(38.dp).testTag("send"),
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = palette.runBackground,
                            contentColor = palette.runInk,
                            disabledContainerColor = palette.soft,
                            disabledContentColor = palette.textMuted,
                        ),
                    ) {
                        if (state.sending) {
                            CircularProgressIndicator(
                                Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = palette.runInk,
                            )
                        } else {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = "发送消息",
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Box {
                    ComposerControl(
                        enabled = canNavigate,
                        compact = compact,
                        description = "执行模式：${modeLabel(state.mode)}",
                        onClick = { modeMenu = true },
                    ) {
                        if (state.mode == "plan") {
                            PlanGlyph(Modifier.size(15.dp), palette.textSecondary)
                        } else {
                            Icon(Icons.Default.Build, null, tint = palette.textSecondary, modifier = Modifier.size(15.dp))
                        }
                        Spacer(Modifier.width(4.dp))
                        Text(modeLabel(state.mode), fontSize = 12.sp)
                        Icon(
                            Icons.Default.KeyboardArrowDown,
                            null,
                            tint = palette.textMuted,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                    ForgeMenu(expanded = modeMenu, onDismissRequest = { modeMenu = false }) {
                        listOf("build" to "Build · 直接执行", "plan" to "Plan · 先计划").forEach { (value, label) ->
                            ForgeMenuItem(
                                text = label,
                                selected = state.mode == value,
                                onClick = {
                                    actions.setMode(value)
                                    modeMenu = false
                                },
                                trailing = if (state.mode == value) {
                                    { Icon(Icons.Default.Check, null, tint = palette.accent, modifier = Modifier.size(15.dp)) }
                                } else {
                                    null
                                },
                            )
                        }
                    }
                }
                Box {
                    ComposerControl(
                        enabled = !mutationLocked,
                        compact = compact,
                        description = "权限：${permissionLabel(state.permission)}",
                        onClick = { permissionMenu = true },
                        warn = state.permission == "unrestricted",
                    ) {
                        Icon(
                            Icons.Default.Lock,
                            null,
                            tint = if (state.permission == "unrestricted") palette.warning else palette.textSecondary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(permissionLabel(state.permission), fontSize = 12.sp)
                        Icon(
                            Icons.Default.KeyboardArrowDown,
                            null,
                            tint = palette.textMuted,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                    ForgeMenu(expanded = permissionMenu, onDismissRequest = { permissionMenu = false }) {
                        PermissionItem(
                            title = "只读",
                            subtitle = "不修改文件，不执行命令",
                            selected = state.permission == "readonly",
                        ) {
                            actions.setPermission("readonly")
                            permissionMenu = false
                        }
                        PermissionItem(
                            title = "工作区",
                            subtitle = "工具操作按服务器策略审批",
                            selected = state.permission == "workspace",
                        ) {
                            actions.setPermission("workspace")
                            permissionMenu = false
                        }
                        PermissionItem(
                            title = "完全访问",
                            subtitle = "危险：不再逐次审批文件与命令",
                            selected = state.permission == "unrestricted",
                            danger = true,
                        ) {
                            permissionMenu = false
                            if (state.permission != "unrestricted") unrestrictedConfirm = true
                        }
                    }
                }
                Box(
                    Modifier.size(if (compact) 34.dp else 30.dp)
                        .clip(RoundedCornerShape(ForgeDimens.radiusSm))
                        .clickable(enabled = imageEnabled) {
                            imageLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                            )
                        }
                        .testTag("add-images")
                        .semantics { contentDescription = "添加图片，最多四张" },
                    contentAlignment = Alignment.Center,
                ) {
                    ImageGlyph(
                        modifier = Modifier.size(16.dp),
                        tint = if (imageEnabled) palette.textSecondary else palette.textMuted,
                    )
                }
                Spacer(Modifier.weight(1f))
                Surface(
                    onClick = onOpenModelPicker,
                    shape = RoundedCornerShape(ForgeDimens.radiusSm),
                    color = androidx.compose.ui.graphics.Color.Transparent,
                    modifier = Modifier.heightIn(min = if (compact) 34.dp else 28.dp)
                        .widthIn(max = 230.dp)
                        .testTag("model-picker")
                        .semantics { contentDescription = modelDescription },
                ) {
                    Row(
                        Modifier.padding(horizontal = 6.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Text(
                            modelLabel,
                            fontSize = 11.5.sp,
                            lineHeight = 16.sp,
                            color = palette.textSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 156.dp),
                        )
                        EffortMeter(effort)
                    }
                }
            }
        }
        }
    }

    if (workspaceDialog) {
        WorkspaceDialog(
            initial = currentWorkspace,
            onDismiss = { workspaceDialog = false },
            onConfirm = { path ->
                actions.setWorkspace(path)
                workspaceDialog = false
            },
        )
    }
    if (unrestrictedConfirm) {
        ForgeDialog(
            onDismissRequest = { unrestrictedConfirm = false },
            title = "完全访问权限",
            actions = {
                ForgeTextAction("保持当前权限", { unrestrictedConfirm = false })
                ForgePrimaryButton(
                    label = "仍要使用完全访问",
                    onClick = {
                        actions.setPermission("unrestricted")
                        unrestrictedConfirm = false
                    },
                    enabled = !mutationLocked,
                    danger = true,
                )
            },
        ) {
            Text(
                "完全访问会让代理在你的工作区和系统可见范围内执行文件与命令操作，不再逐次请求你的允许。" +
                    "它仍受服务器策略和子代理权限上限约束，但不是操作系统沙箱。确认只影响之后的操作，不会自动重跑已拒绝的请求。",
                color = palette.textSecondary,
                fontSize = 12.5.sp,
                lineHeight = 19.sp,
            )
        }
    }
}

@Composable
private fun ComposerControl(
    enabled: Boolean,
    compact: Boolean,
    description: String,
    onClick: () -> Unit,
    warn: Boolean = false,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(6.dp),
        color = androidx.compose.ui.graphics.Color.Transparent,
        contentColor = if (warn) palette.warning else palette.textSecondary,
        modifier = Modifier.heightIn(min = if (compact) 34.dp else 28.dp)
            .semantics { contentDescription = description },
    ) {
        Row(
            Modifier.padding(horizontal = 7.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
private fun PermissionItem(
    title: String,
    subtitle: String,
    selected: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val palette = LocalForgePalette.current
    ForgeMenuItem(
        text = title,
        subtitle = subtitle,
        danger = danger,
        onClick = onClick,
        trailing = if (selected) {
            { Icon(Icons.Default.Check, null, tint = palette.accent, modifier = Modifier.size(15.dp)) }
        } else {
            null
        },
    )
}

@Composable
private fun RunActivityRow(
    waiting: Boolean,
    busy: Boolean,
    canQueue: Boolean,
    canSteer: Boolean,
    onQueue: () -> Unit,
    onSteer: () -> Unit,
) {
    val palette = LocalForgePalette.current
    Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Canvas(Modifier.size(width = 17.dp, height = 14.dp)) {
                val barWidth = 3.dp.toPx()
                val gap = 2.dp.toPx()
                val heights = listOf(7.dp.toPx(), 11.dp.toPx(), 5.dp.toPx())
                heights.forEachIndexed { index, height ->
                    drawRoundRect(
                        color = palette.accent,
                        topLeft = androidx.compose.ui.geometry.Offset(index * (barWidth + gap), (14.dp.toPx() - height)),
                        size = androidx.compose.ui.geometry.Size(barWidth, height),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(barWidth / 2),
                    )
                }
            }
            Spacer(Modifier.width(6.dp))
            Text(
                when {
                    waiting -> "等待审批"
                    busy -> "正在处理"
                    else -> "远端执行中"
                },
                color = palette.textSecondary,
                fontSize = 11.sp,
                lineHeight = 16.sp,
            )
        }
        Spacer(Modifier.weight(1f))
        ForgeTextAction(
            label = "排队",
            onClick = onQueue,
            enabled = canQueue,
            modifier = Modifier.testTag("queue-input"),
            leading = { QueueGlyph(Modifier.size(12.dp), palette.textSecondary) },
        )
        ForgeTextAction(
            label = "插话",
            onClick = onSteer,
            enabled = canSteer,
            modifier = Modifier.testTag("steer-input"),
            leading = { SteerGlyph(Modifier.size(12.dp), palette.textSecondary) },
        )
    }
}

@Composable
private fun QueueSection(
    expanded: Boolean,
    onToggle: () -> Unit,
    snapshot: JSONObject?,
    items: List<JSONObject>,
    paused: Boolean,
    loading: Boolean,
    error: String,
    canRefresh: Boolean,
    canMutate: Boolean,
    onRefresh: () -> Unit,
    onPauseResume: () -> Unit,
    onCancel: (String) -> Unit,
    compact: Boolean,
) {
    val palette = LocalForgePalette.current
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = if (compact) 36.dp else 30.dp)
                .clip(RoundedCornerShape(ForgeDimens.radiusSm))
                .clickable(onClick = onToggle)
                .testTag("queue")
                .padding(horizontal = 4.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            QueueGlyph(Modifier.size(14.dp), palette.textMuted)
            Spacer(Modifier.width(6.dp))
            Text(
                buildString {
                    append("队列")
                    if (items.isNotEmpty()) append(" ").append(items.size)
                    if (paused) append(" · 已暂停")
                    if (loading && snapshot == null) append(" · 读取中")
                },
                color = palette.textSecondary,
                fontSize = 11.sp,
                lineHeight = 16.sp,
            )
            Spacer(Modifier.weight(1f))
            if (paused) Text("不会自动发送", color = palette.warning, fontSize = 10.sp)
            Icon(
                Icons.Default.KeyboardArrowDown,
                if (expanded) "收起队列" else "展开队列",
                tint = palette.textMuted,
                modifier = Modifier.size(15.dp).rotate(if (expanded) 180f else 0f),
            )
        }
        if (expanded) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = palette.soft,
                modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            ) {
                Column(Modifier.padding(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (paused) "队列已暂停" else "队列由远端运行器消费",
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        Spacer(Modifier.weight(1f))
                        ForgeTextAction(
                            label = if (paused) "恢复" else "暂停",
                            onClick = onPauseResume,
                            enabled = canMutate,
                        )
                        ForgeTextAction(
                            label = "刷新",
                            onClick = onRefresh,
                            enabled = canRefresh,
                        )
                    }
                    val pauseReason = snapshot?.optString("reason").orEmpty()
                    if (paused && pauseReason.isNotBlank()) {
                        Text(pauseReason, color = palette.warning, fontSize = 11.sp, lineHeight = 16.sp)
                    }
                    if (error.isNotBlank()) {
                        Text(error, color = palette.error, fontSize = 11.sp, lineHeight = 16.sp)
                    }
                    if (items.isEmpty()) {
                        Text(
                            if (loading) "正在读取排队输入…" else "没有排队输入。这里不会在本地自动发送。",
                            color = palette.textMuted,
                            fontSize = 11.sp,
                            lineHeight = 16.sp,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    } else {
                        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 190.dp)) {
                            items.forEach { queued ->
                                item(key = queued.optString("inputId").ifBlank { queued.toString() }) {
                                    QueueItemRow(queued, canMutate, onCancel)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QueueItemRow(item: JSONObject, canMutate: Boolean, onCancel: (String) -> Unit) {
    val palette = LocalForgePalette.current
    val inputId = item.optString("inputId")
    val state = item.optString("state").ifBlank { "queued" }
    val input = item.optJSONObject("input")
    val selection = item.optJSONObject("selection")
    val prompt = input?.optString("prompt").orEmpty()
    val queuedState = when (state) {
        "queued" -> "排队中"
        "bound" -> "已绑定"
        "consumed" -> "已消费"
        "cancelled" -> "已取消"
        "uncertain" -> "结果未确认"
        "blocked" -> "已阻塞"
        else -> state
    }
    val mode = selection?.optString("mode").orEmpty()
    val permission = selection?.optString("permission").orEmpty()
    Column(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                prompt.ifBlank { "（无文本，可能只有图片）" },
                modifier = Modifier.weight(1f),
                color = palette.textPrimary,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (canMutate && (state == "queued" || state == "bound") && inputId.isNotBlank()) {
                ForgeTextAction(
                    label = "取消",
                    onClick = { onCancel(inputId) },
                    danger = true,
                )
            }
        }
        Text(
            listOfNotNull(
                queuedState,
                if (mode.isBlank()) null else modeLabel(mode),
                if (permission.isBlank()) null else permissionLabel(permission),
            ).joinToString(" · "),
            color = palette.textMuted,
            fontSize = 10.sp,
        )
    }
    HorizontalDivider(color = palette.borderSubtle)
}

@Composable
private fun WorkspaceDialog(
    initial: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by rememberSaveable { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    ForgeDialog(
        onDismissRequest = onDismiss,
        title = "选择工作区",
        actions = {
            ForgeTextAction("取消", onDismiss)
            ForgePrimaryButton(
                label = "使用此工作区",
                onClick = {
                    val path = value.trim()
                    if (isAbsoluteWorkspace(path)) onConfirm(path) else error = "请输入绝对工作区路径"
                },
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ForgeTextField(
                value = value,
                onValueChange = {
                    value = it.take(4096)
                    error = null
                },
                singleLine = true,
                placeholder = { Text("/home/you/project") },
                modifier = Modifier.fillMaxWidth().testTag("workspace-path-input"),
            )
            Text(
                "例如 /home/you/project。工作区在会话创建后固定；服务器仍会校验路径。",
                color = LocalForgePalette.current.textSecondary,
                fontSize = 11.sp,
                lineHeight = 17.sp,
            )
            if (error != null) {
                Text(
                    error!!,
                    color = LocalForgePalette.current.error,
                    fontSize = 11.sp,
                    lineHeight = 17.sp,
                )
            }
        }
    }
}

private fun isAbsoluteWorkspace(value: String): Boolean =
    value.startsWith("/") || value.startsWith("\\\\") || Regex("^[A-Za-z]:[\\\\/]").containsMatchIn(value)

internal fun modeLabel(mode: String): String = when (mode) {
    "build" -> "Build"
    "plan" -> "Plan"
    else -> mode.ifBlank { "Plan" }
}

internal fun permissionLabel(permission: String): String = when (permission) {
    "readonly" -> "只读"
    "workspace" -> "工作区"
    "unrestricted" -> "完全访问"
    else -> permission.ifBlank { "只读" }
}

internal fun reasoningEffortLabel(value: String): String = when (value) {
    "default", "" -> "自动"
    "none" -> "关"
    "minimal" -> "极低"
    "low" -> "低"
    "medium" -> "中"
    "high" -> "高"
    "xhigh" -> "极高"
    "max" -> "MAX"
    else -> value
}

private fun parseQueueSnapshot(raw: String?): JSONObject? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
        val value = JSONObject(raw)
        if (value.has("sessionId") || value.has("paused") || value.has("items")) {
            value
        } else {
            value.optJSONObject("snapshot") ?: value
        }
    }.getOrNull()
}

private fun JSONArray?.jsonObjects(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optJSONObject(index) }
}

private fun findJsonLabel(array: JSONArray, id: String): String {
    if (id.isBlank()) return ""
    for (index in 0 until array.length()) {
        val item = array.optJSONObject(index) ?: continue
        if (item.optString("id") == id) {
            return item.optString("label").ifBlank { id }
        }
    }
    return ""
}

private fun findJsonModel(array: JSONArray, id: String): String {
    if (id.isBlank()) return ""
    for (index in 0 until array.length()) {
        val item = array.optJSONObject(index) ?: continue
        if (item.optString("id") == id) return item.optString("model")
    }
    return ""
}
