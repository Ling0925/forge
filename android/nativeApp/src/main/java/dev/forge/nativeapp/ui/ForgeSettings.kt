package dev.forge.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.UUID

private data class SettingsCategory(
    val id: String,
    val title: String,
    val description: String,
    val keywords: String,
)

private val settingsCategories = listOf(
    SettingsCategory("models", "模型", "查看当前模型来源、providerSources 与路由组；添加或编辑来源。", "模型 来源 provider source 目录 endpoint API Key 路由 协议"),
    SettingsCategory("reasoning", "推理", "设置支持思考参数模型使用的默认推理强度。", "推理 reasoning effort token 输出 max"),
    SettingsCategory("appearance", "外观", "只在本机切换深浅主题，不写入 Core。", "主题 深色 浅色 系统 theme"),
    SettingsCategory("execution", "执行", "设置新运行的默认权限边界与请求空闲超时。", "只读 工作区 无限制 权限 超时 审批"),
    SettingsCategory("context", "上下文", "控制上下文 token 预算与逐模型窗口覆盖。", "token 上下文 压缩 window 窗口 字符"),
    SettingsCategory("browser", "浏览器", "配置主机浏览器工具允许访问的精确来源。", "浏览器 origin Chromium 可执行 网络"),
    SettingsCategory("lsp", "语言服务", "配置本机 LSP 服务器；保存不会安装服务。", "LSP 命令 参数 扩展名 语言服务"),
    SettingsCategory("mcp", "MCP", "管理外部 MCP 服务器与 stdio 注册。", "MCP stdio 服务器 工具 启用 停用 移除"),
    SettingsCategory("connection", "服务器连接", "连接、重新连接或断开 Forge Core。", "服务器 地址 凭据 配对 连接 断开 扫码"),
)

private fun matchingCategories(query: String): List<SettingsCategory> {
    val term = query.trim()
    if (term.isEmpty()) return settingsCategories
    return settingsCategories.filter {
        "${it.title} ${it.description} ${it.keywords}".contains(term, ignoreCase = true)
    }
}

@Composable
fun ForgeSettings(
    state: ChatUiState,
    actions: ChatActions,
    onClose: () -> Unit,
) {
    val connected = state.isConnected()
    var categoryId by rememberSaveable { mutableStateOf(if (connected) "models" else "connection") }
    var query by rememberSaveable { mutableStateOf("") }
    val settingsRaw = state.workbench.values["settings"]
    val settings = remember(settingsRaw) {
        parseSectionObject(settingsRaw, "settings")
    }
    var baseline by rememberSaveable(stateSaver = SettingsDraftSaver) { mutableStateOf(SettingsDraft.EMPTY) }
    var draft by rememberSaveable(stateSaver = SettingsDraftSaver) { mutableStateOf(SettingsDraft.EMPTY) }
    var loaded by rememberSaveable { mutableStateOf(false) }
    var localError by remember { mutableStateOf("") }
    var pendingSaveRaw by remember { mutableStateOf<String?>(null) }
    var submittedNotice by remember { mutableStateOf<String?>(null) }
    val settingsError = state.panelError("settings")
    val notice = state.workbench.notice
    val dirty = loaded && settings != null && draft != baseline
    val saving = pendingSaveRaw != null

    LaunchedEffect(connected, settingsRaw) {
        if (!connected) return@LaunchedEffect
        if (settingsRaw == null && !state.panelLoading("settings") && state.panelError("settings") == null) {
            actions.loadPanel("settings")
        }
    }
    LaunchedEffect(connected) {
        if (!connected) categoryId = "connection"
    }
    LaunchedEffect(settingsRaw, settings) {
        val current = settings ?: return@LaunchedEffect
        val next = SettingsDraft.from(current)
        val adopt = !loaded || draft == baseline || (pendingSaveRaw != null && settingsRaw != pendingSaveRaw)
        if (adopt) {
            baseline = next
            draft = next
            loaded = true
            pendingSaveRaw = null
            localError = ""
        }
    }
    LaunchedEffect(settingsError) {
        if (!settingsError.isNullOrBlank() && pendingSaveRaw != null) pendingSaveRaw = null
    }
    LaunchedEffect(notice) {
        if (pendingSaveRaw != null && !notice.isNullOrBlank() && notice != submittedNotice) {
            actions.loadPanel("settings")
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().testTag("settings-page")) {
        val wide = maxWidth >= 780.dp
        val matching = remember(query) { matchingCategories(query) }
        val visible = if (query.isBlank()) {
            settingsCategories.filter { it.id == categoryId }
        } else matching
        Column(Modifier.fillMaxSize()) {
            PanelHeader(
                title = "设置",
                onClose = onClose,
                subtitle = if (connected) "Core 已连接 · 配置从服务器公共 schema 读取"
                else "尚未连接 Core · 可在此编辑服务器地址",
                trailing = {
                    PanelStatus(if (connected) "已连接" else "未连接",
                        if (connected) PanelTone.Success else PanelTone.Warning)
                },
            )
            if (wide) {
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    SettingsSidebar(
                        categories = matching,
                        selectedId = categoryId,
                        query = query,
                        onQuery = { query = it },
                        onSelect = { categoryId = it; query = "" },
                        modifier = Modifier.width(268.dp).fillMaxHeight(),
                    )
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        SettingsScrollBody(
                            visible = visible,
                            query = query,
                            onClose = onClose,
                            modifier = Modifier.weight(1f),
                            settings = settings,
                            settingsRawPresent = settingsRaw != null,
                            state = state,
                            actions = actions,
                            draft = draft,
                            baseline = baseline,
                            onDraft = { draft = it; localError = "" },
                            onLocalError = { localError = it },
                            connected = connected,
                        )
                        SettingsSaveBar(
                            dirty = dirty,
                            saving = saving,
                            canSave = state.canSendSideEffect(),
                            connected = connected,
                            settingsLoaded = settings != null,
                            localError = localError,
                            settingsError = settingsError,
                            notice = notice,
                            onDiscard = { draft = baseline; localError = "" },
                            onSave = {
                                val patch = try {
                                    buildSettingsPatch(draft, baseline)
                                } catch (error: IllegalArgumentException) {
                                    localError = error.message ?: "设置字段无效。"
                                    null
                                }
                                if (patch != null) {
                                    if (patch.length() == 0) {
                                        localError = "没有需要保存的修改。"
                                    } else {
                                        submittedNotice = notice
                                        pendingSaveRaw = settingsRaw
                                        actions.saveSettings(patch)
                                    }
                                }
                            },
                        )
                    }
                }
            } else {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    SettingsSearch(
                        query = query,
                        onQuery = { query = it },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                    PanelTabRow(
                        tabs = matching.map {
                            PanelTabItem(it.id, it.title, tag = "settings-category-${it.id}")
                        },
                        selectedId = categoryId,
                        onSelect = { categoryId = it; query = "" },
                    )
                    SettingsScrollBody(
                        visible = visible,
                        query = query,
                        onClose = onClose,
                        modifier = Modifier.weight(1f),
                        settings = settings,
                        settingsRawPresent = settingsRaw != null,
                        state = state,
                        actions = actions,
                        draft = draft,
                        baseline = baseline,
                        onDraft = { draft = it; localError = "" },
                        onLocalError = { localError = it },
                        connected = connected,
                    )
                    SettingsSaveBar(
                        dirty = dirty,
                        saving = saving,
                        canSave = state.canSendSideEffect(),
                        connected = connected,
                        settingsLoaded = settings != null,
                        localError = localError,
                        settingsError = settingsError,
                        notice = notice,
                        onDiscard = { draft = baseline; localError = "" },
                        onSave = {
                            val patch = try {
                                buildSettingsPatch(draft, baseline)
                            } catch (error: IllegalArgumentException) {
                                localError = error.message ?: "设置字段无效。"
                                null
                            }
                            if (patch != null) {
                                if (patch.length() == 0) {
                                    localError = "没有需要保存的修改。"
                                } else {
                                    submittedNotice = notice
                                    pendingSaveRaw = settingsRaw
                                    actions.saveSettings(patch)
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsSidebar(
    categories: List<SettingsCategory>,
    selectedId: String,
    query: String,
    onQuery: (String) -> Unit,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text("设置分类", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        SettingsSearch(query, onQuery, Modifier.fillMaxWidth().padding(vertical = 8.dp))
        if (categories.isEmpty()) {
            Text("没有找到相关设置。", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp))
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            categories.forEach { category ->
                val selected = category.id == selectedId && query.isBlank()
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp)
                        .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(category.id) })
                        .testTag("settings-category-${category.id}")
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(category.title,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
                        Text(category.description,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (selected) Text("●", color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        Text(
            "只显示 Core 公共 schema。API Key 不回显、不写入日志或 saved state。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(8.dp),
        )
    }
}

@Composable
private fun SettingsSearch(query: String, onQuery: (String) -> Unit, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        modifier = modifier,
        singleLine = true,
        placeholder = { Text("搜索设置…") },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = { onQuery("") }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "清空搜索")
                }
            }
        } else null,
    )
}

@Composable
private fun SettingsScrollBody(
    visible: List<SettingsCategory>,
    query: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    settings: JSONObject?,
    settingsRawPresent: Boolean,
    state: ChatUiState,
    actions: ChatActions,
    draft: SettingsDraft,
    baseline: SettingsDraft,
    onDraft: (SettingsDraft) -> Unit,
    onLocalError: (String) -> Unit,
    connected: Boolean,
) {
    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        val notice = state.workbench.notice
        if (!notice.isNullOrBlank()) {
            PanelNotice(notice, onDismiss = actions::dismissPanelNotice)
        }
        if (!state.error.isNullOrBlank()) {
            SettingsErrorBanner(state.error.orEmpty(), onDismiss = actions::dismissError)
        }
        val settingsError = state.panelError("settings")
        if (!settingsError.isNullOrBlank()) {
            PanelError(settingsError, onRetry = { actions.loadPanel("settings") })
        }
        if (state.panelLoading("settings") && settings == null) {
            PanelLoading("正在读取 Core 公共设置…")
        }
        if (!connected) {
            PanelNotice("未连接 Core：连接页可用，其他设置需连接后读取和保存。")
        }
        if (visible.isEmpty()) {
            PanelEmpty(
                title = "没有找到相关设置",
                message = "试试“模型”“token”“权限”或“连接”。",
            )
        }
        visible.forEach { category ->
            if (query.isNotBlank()) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(category.title, style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold)
                    Text(category.description, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            SettingsCategoryBody(
                category = category,
                settings = settings,
                settingsRawPresent = settingsRawPresent,
                state = state,
                actions = actions,
                draft = draft,
                enabled = connected,
                onDraft = onDraft,
                onLocalError = onLocalError,
                onClose = onClose,
            )
        }
    }
}

@Composable
private fun SettingsErrorBanner(message: String, onDismiss: () -> Unit) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.heightIn(min = 48.dp),
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onErrorContainer),
            ) { Text("收起") }
        }
    }
}

@Composable
private fun SettingsSaveBar(
    dirty: Boolean,
    saving: Boolean,
    canSave: Boolean,
    connected: Boolean,
    settingsLoaded: Boolean,
    localError: String,
    settingsError: String?,
    notice: String?,
    onDiscard: () -> Unit,
    onSave: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            val message = when {
                localError.isNotBlank() -> localError
                !settingsError.isNullOrBlank() -> settingsError
                saving -> "已提交，等待 Core 返回权威设置…"
                !connected -> "连接 Core 后才能保存设置。"
                dirty -> "有未保存的修改。保存只提交已改字段。"
                !settingsLoaded -> "设置尚未加载。"
                else -> notice?.takeIf { it.isNotBlank() } ?: "所有设置已同步。"
            }
            Text(
                message,
                style = MaterialTheme.typography.labelMedium,
                color = when {
                    localError.isNotBlank() || !settingsError.isNullOrBlank() -> MaterialTheme.colorScheme.error
                    dirty -> MaterialTheme.colorScheme.tertiary
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onDiscard,
                    enabled = dirty && !saving,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("放弃修改") }
                Button(
                    onClick = onSave,
                    enabled = canSave && settingsLoaded && dirty && !saving,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("settings-save"),
                ) {
                    if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Text("保存到 Core")
                }
            }
        }
    }
}

@Composable
private fun SettingsCategoryBody(
    category: SettingsCategory,
    settings: JSONObject?,
    settingsRawPresent: Boolean,
    state: ChatUiState,
    actions: ChatActions,
    draft: SettingsDraft,
    enabled: Boolean,
    onDraft: (SettingsDraft) -> Unit,
    onLocalError: (String) -> Unit,
    onClose: () -> Unit,
) {
    when (category.id) {
        "connection" -> ConnectionSection(state, actions, onClose)
        "mcp" -> McpSection(state, actions, enabled)
        "models" -> ModelSourcesSection(state, actions, settings, settingsRawPresent && enabled, enabled)
        "reasoning" -> ReasoningSection(draft, enabled, onDraft)
        "appearance" -> AppearanceSection(state, actions)
        "execution" -> ExecutionSection(draft, enabled, onDraft)
        "context" -> ContextSection(draft, enabled, onDraft)
        "browser" -> BrowserSection(draft, enabled, onDraft)
        "lsp" -> LspSection(draft, enabled, onDraft)
        else -> Unit
    }
}

@Composable
private fun ReasoningSection(
    draft: SettingsDraft,
    enabled: Boolean,
    onDraft: (SettingsDraft) -> Unit,
) {
    PanelSection(
        title = "默认推理强度",
        subtitle = "适用于支持思考参数的模型；不会改变已保存的逐请求历史。",
    ) {
        SettingsDropdown(
            label = "默认思考强度",
            value = draft.reasoningEffort,
            options = listOf(
                "default" to "模型默认",
                "none" to "none",
                "minimal" to "minimal",
                "low" to "low",
                "medium" to "medium",
                "high" to "high",
                "xhigh" to "xhigh",
                "max" to "MAX",
            ),
            enabled = enabled,
            onSelect = { onDraft(draft.copy(reasoningEffort = it)) },
        )
        SettingsNumberField(
            label = "最大输出 tokens（可选）",
            value = draft.maxOutputTokens,
            enabled = enabled,
            helper = "留空保持 Core 当前值；范围 1–1000000。",
            onValue = { onDraft(draft.copy(maxOutputTokens = it)) },
        )
    }
}

@Composable
private fun AppearanceSection(state: ChatUiState, actions: ChatActions) {
    PanelSection(
        title = "界面主题",
        subtitle = "仅本机显示，不上传 Core，不修改服务器配置。",
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (value, label) ->
                val selected = state.themeMode == value
                if (selected) {
                    Button(
                        onClick = { actions.setThemeMode(value) },
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                    ) { Text(label, maxLines = 1) }
                } else {
                    OutlinedButton(
                        onClick = { actions.setThemeMode(value) },
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                    ) { Text(label, maxLines = 1) }
                }
            }
        }
        Text(
            "当前：${when (state.themeMode) { "light" -> "浅色"; "dark" -> "深色"; else -> "跟随系统" }}。" +
                "系统栏样式由主壳按本机主题处理。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ExecutionSection(
    draft: SettingsDraft,
    enabled: Boolean,
    onDraft: (SettingsDraft) -> Unit,
) {
    PanelSection(
        title = "权限与请求超时",
        subtitle = "更改默认权限不会提升当前运行。工具调用次数、子代理累计次数与任务总时长不受这里限制。",
    ) {
        SettingsDropdown(
            label = "默认权限",
            value = draft.defaultPermission,
            options = listOf(
                "readonly" to "只读 · 不修改文件",
                "workspace" to "工作区 · 工具操作需审批",
                "unrestricted" to "无限制 · 高风险",
            ),
            enabled = enabled,
            onSelect = { onDraft(draft.copy(defaultPermission = it)) },
        )
        if (draft.defaultPermission == "unrestricted") {
            Surface(
                Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Default.Warning, null, Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "无限制模式允许直接执行命令，可能访问工作区以外的文件和网络。仅在信任任务时使用。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        SettingsNumberField(
            label = "请求空闲超时（毫秒）",
            value = draft.requestTimeoutMs,
            enabled = enabled,
            helper = "范围 1000–600000；只中断单次请求的空闲，不限制任务总时长。",
            onValue = { onDraft(draft.copy(requestTimeoutMs = it)) },
        )
    }
}

@Composable
private fun ContextSection(
    draft: SettingsDraft,
    enabled: Boolean,
    onDraft: (SettingsDraft) -> Unit,
) {
    PanelSection(
        title = "上下文预算",
        subtitle = "自动压缩保留可检索的原始历史。压缩影响后续请求，不会删除聊天或清零累计用量。",
    ) {
        SettingsNumberField(
            label = "上下文 token 上限",
            value = draft.contextBudgetTokens,
            enabled = enabled,
            helper = "留空自动按模型窗口的 80% 计算；手动值范围 4096–10000000，仍受窗口限制。",
            onValue = { onDraft(draft.copy(contextBudgetTokens = it)) },
        )
    }
    PanelSection(
        title = "逐模型窗口覆盖",
        subtitle = "填写精确模型 ID，适用于网关别名。留空窗口表示自动解析；未知模型当前按 300K 估算。",
    ) {
        if (draft.modelContextWindows.isEmpty()) {
            Text("没有模型窗口覆盖。", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        draft.modelContextWindows.forEachIndexed { index, row ->
            Surface(
                Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = row.model,
                        onValueChange = { value ->
                            onDraft(draft.copy(modelContextWindows = draft.modelContextWindows
                                .toMutableList().also { it[index] = row.copy(model = value) }))
                        },
                        enabled = enabled,
                        label = { Text("模型 ID") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = row.tokens,
                        onValueChange = { value ->
                            onDraft(draft.copy(modelContextWindows = draft.modelContextWindows
                                .toMutableList().also { it[index] = row.copy(tokens = value) }))
                        },
                        enabled = enabled,
                        label = { Text("窗口 tokens（留空自动）") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextButton(
                        onClick = {
                            onDraft(draft.copy(modelContextWindows =
                                draft.modelContextWindows.filterIndexed { i, _ -> i != index }))
                        },
                        enabled = enabled,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) {
                        Icon(Icons.Default.Delete, null)
                        Spacer(Modifier.width(6.dp))
                        Text("移除此窗口覆盖")
                    }
                }
            }
        }
        OutlinedButton(
            onClick = { onDraft(draft.copy(modelContextWindows = draft.modelContextWindows + ModelWindowDraft())) },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(6.dp)); Text("添加模型窗口") }
    }
    PanelSection(title = "兼容性设置", subtitle = "旧版字符预算仅用于无 token 窗口的兼容路径。") {
        PanelDisclosure("展开旧版字符预算") {
            SettingsNumberField(
                label = "旧版字符预算",
                value = draft.contextBudgetChars,
                enabled = enabled,
                helper = "范围 4096–2000000；当前默认 token 窗口下不优先使用。",
                onValue = { onDraft(draft.copy(contextBudgetChars = it)) },
            )
        }
    }
}

@Composable
private fun BrowserSection(
    draft: SettingsDraft,
    enabled: Boolean,
    onDraft: (SettingsDraft) -> Unit,
) {
    PanelSection(
        title = "网络访问范围",
        subtitle = "空列表不启用浏览器工具。这里配置主机浏览器，不是当前设置页面的连接。",
    ) {
        OutlinedTextField(
            value = draft.browserAllowedOrigins,
            onValueChange = { onDraft(draft.copy(browserAllowedOrigins = it)) },
            enabled = enabled,
            label = { Text("浏览器允许来源（每行一个）") },
            placeholder = { Text("http://localhost:3000\nhttp://127.0.0.1:8080") },
            minLines = 4,
            maxLines = 8,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "必须是精确 HTTP(S) origin：不能含路径、查询、通配符或凭据。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = draft.browserExecutablePath,
            onValueChange = { onDraft(draft.copy(browserExecutablePath = it)) },
            enabled = enabled,
            label = { Text("Chromium 可执行路径") },
            placeholder = { Text("/usr/bin/google-chrome-stable") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("留空使用主机默认浏览器安装。不会自动下载或安装。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LspSection(
    draft: SettingsDraft,
    enabled: Boolean,
    onDraft: (SettingsDraft) -> Unit,
) {
    PanelSection(
        title = "LSP 服务器",
        subtitle = "最多 8 个服务。ID 和扩展名必须唯一；保存不会安装服务。后续执行本机命令，请仅配置可信程序。",
    ) {
        if (draft.lspServers.isEmpty()) {
            PanelEmpty(title = "尚未配置语言服务", message = "添加已安装的语言服务器以启用代码诊断。")
        }
        draft.lspServers.forEachIndexed { index, server ->
            Surface(
                Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "语言服务 ${index + 1}${if (server.id.isBlank()) "" else " · ${server.id}"}",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleSmall,
                        )
                        TextButton(
                            onClick = {
                                onDraft(draft.copy(lspServers =
                                    draft.lspServers.filterIndexed { i, _ -> i != index }))
                            },
                            enabled = enabled,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) {
                            Icon(Icons.Default.Delete, null)
                            Spacer(Modifier.width(4.dp))
                            Text("移除")
                        }
                    }
                    OutlinedTextField(
                        value = server.id,
                        onValueChange = { value ->
                            onDraft(draft.copy(lspServers = draft.lspServers.toMutableList()
                                .also { it[index] = server.copy(id = value) }))
                        },
                        enabled = enabled,
                        label = { Text("服务 ID") },
                        placeholder = { Text("例如 ts 或 pyright") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = server.command,
                        onValueChange = { value ->
                            onDraft(draft.copy(lspServers = draft.lspServers.toMutableList()
                                .also { it[index] = server.copy(command = value) }))
                        },
                        enabled = enabled,
                        label = { Text("启动命令") },
                        placeholder = { Text("例如 typescript-language-server") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = server.args,
                        onValueChange = { value ->
                            onDraft(draft.copy(lspServers = draft.lspServers.toMutableList()
                                .also { it[index] = server.copy(args = value) }))
                        },
                        enabled = enabled,
                        label = { Text("参数（JSON 字符串数组）") },
                        placeholder = { Text("[\"--stdio\"]") },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = server.extensions,
                        onValueChange = { value ->
                            onDraft(draft.copy(lspServers = draft.lspServers.toMutableList()
                                .also { it[index] = server.copy(extensions = value) }))
                        },
                        enabled = enabled,
                        label = { Text("文件扩展名（逗号分隔）") },
                        placeholder = { Text(".ts, .tsx") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        OutlinedButton(
            onClick = {
                onDraft(draft.copy(lspServers = draft.lspServers + LspDraft()))
            },
            enabled = enabled && draft.lspServers.size < 8,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(6.dp)); Text("添加语言服务") }
    }
}

@Composable
private fun SettingsDropdown(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    enabled: Boolean,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(
            onClick = { expanded = true },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        ) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                Text(label, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(options.firstOrNull { it.first == value }?.second ?: value,
                    style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            }
            Icon(Icons.Default.ArrowDropDown, null)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    onClick = { expanded = false; onSelect(id) },
                )
            }
        }
    }
}

@Composable
private fun SettingsNumberField(
    label: String,
    value: String,
    enabled: Boolean,
    helper: String,
    onValue: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValue(it.filter { ch -> ch.isDigit() }) },
        enabled = enabled,
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth(),
    )
    Text(helper, style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private data class ModelWindowDraft(
    val model: String = "",
    val tokens: String = "",
)

private data class LspDraft(
    val id: String = "",
    val command: String = "",
    val args: String = "[]",
    val extensions: String = "",
)

private data class SettingsDraft(
    val reasoningEffort: String = "default",
    val maxOutputTokens: String = "",
    val defaultPermission: String = "workspace",
    val requestTimeoutMs: String = "60000",
    val contextBudgetTokens: String = "",
    val contextBudgetChars: String = "100000",
    val browserAllowedOrigins: String = "",
    val browserExecutablePath: String = "",
    val modelContextWindows: List<ModelWindowDraft> = emptyList(),
    val lspServers: List<LspDraft> = emptyList(),
) {
    companion object {
        val EMPTY = SettingsDraft()

        fun from(settings: JSONObject): SettingsDraft {
            val windows = settings.optJSONObject("modelContextWindows")
            val modelWindows = windows?.let { obj ->
                obj.keys().asSequence().map { key ->
                    val value = obj.opt(key)
                    ModelWindowDraft(
                        model = key,
                        tokens = if (value == null || value == JSONObject.NULL) "" else value.toString(),
                    )
                }.toList()
            }.orEmpty()
            val lsp = settings.optObjects("lspServers").map { server ->
                LspDraft(
                    id = server.optText("id"),
                    command = server.optText("command"),
                    args = server.optJSONArray("args")?.toString() ?: "[]",
                    extensions = server.optStrings("extensions").joinToString(", "),
                )
            }
            return SettingsDraft(
                reasoningEffort = settings.optText("reasoningEffort").ifBlank { "default" },
                maxOutputTokens = if (settings.hasValue("maxOutputTokens")) settings.optInt("maxOutputTokens").toString() else "",
                defaultPermission = settings.optText("defaultPermission").ifBlank { "workspace" },
                requestTimeoutMs = if (settings.has("requestTimeoutMs")) settings.optInt("requestTimeoutMs").toString() else "60000",
                contextBudgetTokens = if (settings.hasValue("contextBudgetTokens")) settings.optInt("contextBudgetTokens").toString() else "",
                contextBudgetChars = if (settings.has("contextBudgetChars")) settings.optInt("contextBudgetChars").toString() else "100000",
                browserAllowedOrigins = settings.optStrings("browserAllowedOrigins").joinToString("\n"),
                browserExecutablePath = settings.optText("browserExecutablePath"),
                modelContextWindows = modelWindows,
                lspServers = lsp,
            )
        }
    }

    fun encode(): String {
        val json = JSONObject()
        json.put("reasoningEffort", reasoningEffort)
        json.put("maxOutputTokens", maxOutputTokens)
        json.put("defaultPermission", defaultPermission)
        json.put("requestTimeoutMs", requestTimeoutMs)
        json.put("contextBudgetTokens", contextBudgetTokens)
        json.put("contextBudgetChars", contextBudgetChars)
        json.put("browserAllowedOrigins", browserAllowedOrigins)
        json.put("browserExecutablePath", browserExecutablePath)
        json.put("modelContextWindows", JSONArray().also { array ->
            modelContextWindows.forEach {
                array.put(JSONObject().put("model", it.model).put("tokens", it.tokens))
            }
        })
        json.put("lspServers", JSONArray().also { array ->
            lspServers.forEach {
                array.put(JSONObject().put("id", it.id).put("command", it.command)
                    .put("args", it.args).put("extensions", it.extensions))
            }
        })
        return json.toString()
    }

    object Decode {
        fun decode(value: String): SettingsDraft? = runCatching {
            val json = JSONObject(value)
            SettingsDraft(
                reasoningEffort = json.optText("reasoningEffort"),
                maxOutputTokens = json.optText("maxOutputTokens"),
                defaultPermission = json.optText("defaultPermission"),
                requestTimeoutMs = json.optText("requestTimeoutMs"),
                contextBudgetTokens = json.optText("contextBudgetTokens"),
                contextBudgetChars = json.optText("contextBudgetChars"),
                browserAllowedOrigins = json.optText("browserAllowedOrigins"),
                browserExecutablePath = json.optText("browserExecutablePath"),
                modelContextWindows = json.optObjects("modelContextWindows").map {
                    ModelWindowDraft(it.optText("model"), it.optText("tokens"))
                },
                lspServers = json.optObjects("lspServers").map {
                    LspDraft(it.optText("id"), it.optText("command"), it.optText("args"), it.optText("extensions"))
                },
            )
        }.getOrNull()
    }
}

private val SettingsDraftSaver = Saver<SettingsDraft, String>(
    save = { it.encode() },
    restore = { SettingsDraft.Decode.decode(it) },
)

private fun buildSettingsPatch(draft: SettingsDraft, baseline: SettingsDraft): JSONObject {
    val patch = JSONObject()
    if (draft.reasoningEffort != baseline.reasoningEffort) {
        require(draft.reasoningEffort in setOf("default", "none", "minimal", "low", "medium", "high", "xhigh", "max")) {
            "推理强度无效。"
        }
        patch.put("reasoningEffort", draft.reasoningEffort)
    }
    if (draft.maxOutputTokens != baseline.maxOutputTokens) {
        if (draft.maxOutputTokens.isBlank()) {
            if (baseline.maxOutputTokens.isNotBlank()) {
                throw IllegalArgumentException("最大输出 tokens 不能通过本界面清空；请保留非空值。")
            }
        } else {
            patch.put("maxOutputTokens", integerValue(draft.maxOutputTokens, "最大输出 tokens", 1, 1_000_000))
        }
    }
    if (draft.defaultPermission != baseline.defaultPermission) {
        require(draft.defaultPermission in setOf("readonly", "workspace", "unrestricted")) { "默认权限无效。" }
        patch.put("defaultPermission", draft.defaultPermission)
    }
    if (draft.requestTimeoutMs != baseline.requestTimeoutMs) {
        patch.put("requestTimeoutMs", integerValue(draft.requestTimeoutMs, "请求空闲超时", 1_000, 600_000))
    }
    if (draft.contextBudgetTokens != baseline.contextBudgetTokens) {
        if (draft.contextBudgetTokens.isBlank()) {
            patch.put("contextBudgetTokens", JSONObject.NULL)
        } else {
            patch.put("contextBudgetTokens", integerValue(draft.contextBudgetTokens, "上下文 token 上限", 4_096, 10_000_000))
        }
    }
    if (draft.contextBudgetChars != baseline.contextBudgetChars) {
        patch.put("contextBudgetChars", integerValue(draft.contextBudgetChars, "旧版字符预算", 4_096, 2_000_000))
    }
    if (draft.browserAllowedOrigins != baseline.browserAllowedOrigins) {
        val origins = draft.browserAllowedOrigins.lines().map { it.trim() }.filter { it.isNotEmpty() }
        require(origins.size <= 32) { "浏览器允许来源最多 32 个。" }
        origins.forEach(::validateOrigin)
        patch.put("browserAllowedOrigins", JSONArray(origins))
    }
    if (draft.browserExecutablePath != baseline.browserExecutablePath) {
        val path = draft.browserExecutablePath.trim()
        require(!path.contains('\n') && !path.contains('\r')) { "浏览器可执行路径不能包含换行。" }
        require(path.length <= 4096) { "浏览器可执行路径过长。" }
        patch.put("browserExecutablePath", path)
    }
    if (draft.modelContextWindows != baseline.modelContextWindows) {
        val windows = JSONObject()
        draft.modelContextWindows.forEach { row ->
            val model = row.model.trim()
            require(model.isNotEmpty()) { "模型窗口：模型 ID 不能为空。" }
            require(!windows.has(model)) { "模型窗口：模型 ID 不能重复（$model）。" }
            if (row.tokens.isBlank()) {
                windows.put(model, JSONObject.NULL)
            } else {
                windows.put(model, integerValue(row.tokens, "模型窗口 tokens", 1, 10_000_000))
            }
        }
        patch.put("modelContextWindows", windows)
    }
    if (draft.lspServers != baseline.lspServers) {
        val servers = JSONArray()
        val ids = HashSet<String>()
        val extensions = HashSet<String>()
        require(draft.lspServers.size <= 8) { "语言服务最多 8 个。" }
        draft.lspServers.forEach { row ->
            val id = row.id.trim()
            val command = row.command.trim()
            require(Regex("^[a-z][a-z0-9_-]{0,31}$").matches(id)) {
                "语言服务 ID 必须匹配 ^[a-z][a-z0-9_-]{0,31}$。"
            }
            require(ids.add(id)) { "语言服务 ID 必须唯一（$id）。" }
            require(command.isNotEmpty() && command.length <= 4096 && command.none { it.code < 32 }) {
                "语言服务 $id：启动命令不能为空或包含控制字符。"
            }
            val args = try { JSONArray(row.args.ifBlank { "[]" }) } catch (_: Exception) {
                throw IllegalArgumentException("语言服务 $id：参数必须是 JSON 字符串数组。")
            }
            require(args.length() <= 32) { "语言服务 $id：参数最多 32 个。" }
            val outArgs = JSONArray()
            for (index in 0 until args.length()) {
                val arg = args.opt(index)
                require(arg is String && arg.length <= 1024 && !arg.contains('\u0000')) {
                    "语言服务 $id：参数必须是字符串且不超过 1024 字符。"
                }
                outArgs.put(arg)
            }
            val exts = row.extensions.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            require(exts.isNotEmpty() && exts.size <= 32) { "语言服务 $id：至少一个扩展名，最多 32 个。" }
            exts.forEach { ext ->
                require(Regex("^\\.[a-zA-Z0-9_-]{1,16}$").matches(ext)) {
                    "语言服务 $id：扩展名格式无效（$ext）。"
                }
                require(extensions.add(ext.lowercase())) { "语言服务扩展名必须唯一（$ext）。" }
            }
            servers.put(
                JSONObject().put("id", id).put("command", command).put("args", outArgs)
                    .put("extensions", JSONArray(exts)),
            )
        }
        require(servers.toString().length <= 24_000) { "语言服务配置过大。" }
        patch.put("lspServers", servers)
    }
    return patch
}

private fun integerValue(raw: String, label: String, min: Int, max: Int): Int {
    val value = raw.trim().toIntOrNull()
        ?: throw IllegalArgumentException("$label：请输入整数。")
    require(value in min..max) { "$label：范围 $min–$max。" }
    return value
}

private fun validateOrigin(raw: String) {
    require(raw.length <= 256) { "浏览器来源过长。" }
    val uri = try { URI(raw) } catch (_: Exception) {
        throw IllegalArgumentException("浏览器来源格式无效：$raw")
    }
    require(uri.scheme == "http" || uri.scheme == "https") { "浏览器来源必须是 HTTP(S)：$raw" }
    require(uri.userInfo == null) { "浏览器来源不能包含凭据：$raw" }
    require(uri.host != null && uri.host.isNotBlank() && !uri.host.contains('*')) {
        "浏览器来源必须包含精确主机：$raw"
    }
    require(uri.rawPath.isEmpty() && uri.rawQuery == null && uri.rawFragment == null) {
        "浏览器来源不能包含路径、查询或片段：$raw"
    }
    require(uri.toString() == raw) { "浏览器来源必须使用规范的 origin：$raw" }
}
@Composable
private fun ModelSourcesSection(
    state: ChatUiState,
    actions: ChatActions,
    settings: JSONObject?,
    sourcesEnabled: Boolean,
    connected: Boolean,
) {
    var dialogOpen by rememberSaveable { mutableStateOf(false) }
    var editingId by rememberSaveable { mutableStateOf<String?>(null) }
    var removingId by rememberSaveable { mutableStateOf<String?>(null) }
    val sources = remember(settings?.toString()) { settings?.optObjects("providerSources").orEmpty() }
    val editingSource = editingId?.let { id -> sources.find { it.optText("id") == id } }
    val canMutate = state.canSendSideEffect()
    val activeSourceId = settings?.optText("activeSourceId").orEmpty()
    val sourceError = state.panelError("source") ?: state.panelError("settings")

    if (!connected) {
        PanelSection(title = "模型", subtitle = "需要连接 Core 才能读取模型来源。") {
            PanelEmpty(
                title = "尚未连接",
                message = "连接页可用；模型来源、目录与推理设置需要 Core 的公共 schema。",
            )
        }
        return
    }
    if (settings == null) {
        PanelSection(title = "模型", subtitle = "读取 Core 的公共模型配置。") {
            if (state.panelLoading("settings")) PanelLoading("正在读取模型来源…")
            else PanelError(
                state.panelError("settings") ?: "设置尚未加载。",
                onRetry = { actions.loadPanel("settings") },
            )
        }
        return
    }

    PanelSection(
        title = "模型服务",
        subtitle = if (settings.optBoolean("isConfigured")) "Core 已配置模型服务" else "Core 尚未配置模型服务",
        action = {
            Button(
                onClick = { editingId = null; dialogOpen = true },
                enabled = sourcesEnabled && canMutate,
                modifier = Modifier.heightIn(min = 48.dp).testTag("model-source-add"),
            ) {
                Icon(Icons.Default.Add, null)
                Spacer(Modifier.width(6.dp))
                Text("添加来源")
            }
        },
    ) {
        if (!sourceError.isNullOrBlank()) {
            PanelError(sourceError, onRetry = { actions.loadPanel("settings") })
        }
        if (settings.optBoolean("environmentOverride")) {
            PanelNotice("FORGE_* 环境变量优先于本页配置；修改可能不会覆盖环境变量。")
        }
        PanelInfoRow("当前模型", settings.optText("model").ifBlank { "服务器默认" }, mono = true)
        PanelInfoRow("当前协议", settings.optText("apiMode").ifBlank { "—" })
        if (settings.optText("baseUrl").isNotBlank()) {
            PanelInfoRow("当前端点", settings.optText("baseUrl"), mono = true)
        }
        if (activeSourceId.isNotBlank()) {
            PanelInfoRow("活动来源", activeSourceId, mono = true)
        }
        if (sources.isEmpty()) {
            PanelEmpty(
                title = "没有模型来源",
                message = "Core 的公共 providerSources 为空。可添加一个来源，或先在服务器 CLI 配置。",
                actionLabel = if (sourcesEnabled && canMutate) "添加模型来源" else null,
                onAction = if (sourcesEnabled && canMutate) ({ editingId = null; dialogOpen = true }) else null,
            )
        } else {
            sources.forEach { source ->
                ModelSourceCard(
                    source = source,
                    active = source.optText("id") == activeSourceId,
                    state = state,
                    actions = actions,
                    canMutate = canMutate,
                    onEdit = { editingId = source.optText("id"); dialogOpen = true },
                    onRemove = { removingId = source.optText("id") },
                )
            }
        }
        Text(
            "来源目录单独加载，失败时保留已显示的模型；刷新不会阻塞当前聊天。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    val routeGroups = remember(settings.toString()) { settings.optObjects("routeGroups") }
    PanelSection(
        title = "路由组",
        subtitle = "只读展示 Core 的公开 routeGroups；本机界面未提供复杂路由编辑器。",
    ) {
        if (routeGroups.isEmpty()) {
            Text("没有公开路由组。", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            routeGroups.forEach { group ->
                Surface(
                    Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                group.optText("label").ifBlank { group.optText("id") },
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall,
                            )
                            PanelBadge(group.optText("strategy").ifBlank { "order" })
                        }
                        Text(group.optText("id"), style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace)
                        val members = group.optObjects("members")
                        Text(
                            "${members.size} 个成员 · " + members.take(3).joinToString("、") {
                                "${it.optText("sourceId")}:${it.optText("model")}"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    PanelSection(title = "本机未提供的高级模型操作") {
        listOf(
            "OAuth / Copilot 账号登录、设备码与登录轮询",
            "多凭据路由、凭据启停与额度查询",
            "模型目录导入、推理/目录连通性测试",
            "routeGroups 的增删改与模型选择模式编辑",
            "来源移除时的 forgottenSessionIds 交互",
        ).forEach {
            Text("· $it", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            "以上操作不会显示伪按钮；可在桌面端、CLI 或后续原生页面完成。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    if (dialogOpen && sourcesEnabled) {
        ModelSourceDialog(
            state = state,
            actions = actions,
            source = editingSource,
            onClose = { dialogOpen = false; editingId = null },
        )
    }
    val remove = removingId?.let { id -> sources.find { it.optText("id") == id } }
    if (remove != null) {
        PanelConfirmDialog(
            title = "移除模型来源？",
            text = "将移除 ${remove.optText("label")}（${remove.optText("id")}）。" +
                "如果仍有会话引用此来源，Core 可能拒绝并返回引用列表；界面不会绕过该拒绝。" +
                "已保存的 API Key 不会被回显。",
            confirmLabel = "确认移除",
            danger = true,
            enabled = canMutate,
            onConfirm = {
                actions.configureModelSource(
                    JSONObject().put("type", "remove").put("id", remove.optText("id")),
                )
                removingId = null
            },
            onDismiss = { removingId = null },
        )
    }
}

@Composable
private fun ModelSourceCard(
    source: JSONObject,
    active: Boolean,
    state: ChatUiState,
    actions: ChatActions,
    canMutate: Boolean,
    onEdit: () -> Unit,
    onRemove: () -> Unit,
) {
    val sourceId = source.optText("id")
    var expanded by rememberSaveable(sourceId) { mutableStateOf(false) }
    val connection = source.optJSONObject("connection")
    val credentials = source.optObjects("credentials")
    PanelSection(
        title = source.optText("label").ifBlank { sourceId },
        subtitle = "$sourceId · ${source.optText("apiMode").ifBlank { "协议未知" }}",
        action = {
            if (active) PanelStatus("当前使用", PanelTone.Success)
            else PanelStatus("备用", PanelTone.Neutral)
        },
    ) {
        PanelInfoRow("模型", source.optText("model").ifBlank { "未选择" }, mono = true)
        PanelInfoRow("端点", source.optText("baseUrl").ifBlank { "—" }, mono = true)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PanelStatus(
                if (source.optBoolean("hasApiKey")) "已保存密钥" else "无 API Key",
                if (source.optBoolean("hasApiKey")) PanelTone.Success else PanelTone.Warning,
            )
            if (source.hasValue("revision")) PanelBadge("v${source.optInt("revision")}")
            PanelBadge("${credentials.size} 个凭据")
        }
        if (connection != null) {
            val auth = connection.optJSONObject("auth")?.optText("type").orEmpty()
            val headers = connection.optStrings("headerNames")
            Text(
                "连接配置 · ${auth.ifBlank { "默认鉴权" }}" +
                    if (headers.isNotEmpty()) " · ${headers.size} 个请求头" else "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            OutlinedButton(
                onClick = {
                    actions.configureModelSource(
                        JSONObject().put("type", "activate").put("id", sourceId),
                    )
                },
                enabled = canMutate && !active,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("激活") }
            TextButton(
                onClick = onEdit,
                enabled = canMutate,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Icon(Icons.Default.Edit, null); Spacer(Modifier.width(4.dp)); Text("编辑") }
            TextButton(
                onClick = { expanded = !expanded },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(if (expanded) "收起目录" else "目录") }
            TextButton(
                onClick = onRemove,
                enabled = canMutate,
                modifier = Modifier.heightIn(min = 48.dp),
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Icon(Icons.Default.Delete, null); Spacer(Modifier.width(4.dp)); Text("移除") }
        }
        if (expanded) {
            ModelCatalogPanel(sourceId, state, actions, state.isConnected())
        }
    }
}

@Composable
private fun ModelCatalogPanel(
    sourceId: String,
    state: ChatUiState,
    actions: ChatActions,
    connected: Boolean,
) {
    val key = "models:$sourceId"
    val raw = state.workbench.values[key]
    val loading = key in state.workbench.loading
    val error = state.workbench.errors[key]
    val models = remember(raw) {
        raw?.let { runCatching { JSONArray(it).stringList() }.getOrNull() }
    }
    LaunchedEffect(sourceId, connected, raw, error) {
        if (connected && raw == null && error == null && !loading) {
            actions.loadModelCatalog(sourceId, false)
        }
    }
    Surface(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("模型目录", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold)
                TextButton(
                    onClick = { actions.loadModelCatalog(sourceId, true) },
                    enabled = connected,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(4.dp))
                    Text("刷新目录")
                }
            }
            if (!error.isNullOrBlank()) {
                PanelError(error, onRetry = { actions.loadModelCatalog(sourceId, false) })
            }
            if (loading) PanelLoading("正在读取 $sourceId 的模型目录…")
            if (raw != null && models == null) {
                PanelError("模型目录响应不是 JSON 字符串数组；未覆盖已有显示。")
            }
            if (models != null) {
                if (models.isEmpty()) {
                    Text("目录为空。可能是来源未配置、目录请求失败，或服务端没有返回模型。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Text("${models.size} 个模型", style = MaterialTheme.typography.labelMedium)
                    var showAll by rememberSaveable(sourceId) { mutableStateOf(false) }
                    val visible = if (showAll) models else models.take(24)
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        visible.forEach { model ->
                            Text(
                                model,
                                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                fontFamily = FontFamily.Monospace,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    if (models.size > visible.size) {
                        TextButton(
                            onClick = { showAll = true },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text("显示其余 ${models.size - visible.size} 个模型") }
                    }
                }
            }
            if (!connected) {
                Text("连接 Core 后才能加载目录。", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ModelSourceDialog(
    state: ChatUiState,
    actions: ChatActions,
    source: JSONObject?,
    onClose: () -> Unit,
) {
    val sourceId = source?.optText("id") ?: remember { newSourceId() }
    var label by remember { mutableStateOf(source?.optText("label").orEmpty()) }
    var baseUrl by remember { mutableStateOf(source?.optText("baseUrl").orEmpty()) }
    var model by remember { mutableStateOf(source?.optText("model").orEmpty()) }
    var apiMode by remember { mutableStateOf(source?.optText("apiMode").orEmpty().ifBlank { "chat-completions" }) }
    // Secrets intentionally stay in composition memory only, never saved state or logs.
    var apiKey by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf("") }
    var submittedNotice by remember { mutableStateOf<String?>(null) }
    var submittedSettingsError by remember { mutableStateOf<String?>(null) }
    var submittedActionError by remember { mutableStateOf<String?>(null) }
    val notice = state.workbench.notice
    val settingsError = state.panelError("settings") ?: state.panelError("source")
    val settingsRaw = state.workbench.values["settings"]
    val currentSources = remember(settingsRaw) {
        parseSectionObject(settingsRaw, "settings")?.optObjects("providerSources").orEmpty()
    }
    val current = currentSources.find { it.optText("id") == sourceId }
    val originalRevision = source?.optInt("revision", -1) ?: -1
    val canMutate = state.canSendSideEffect()

    LaunchedEffect(pending, current?.toString(), settingsError, notice, state.error) {
        if (!pending) return@LaunchedEffect
        if (!settingsError.isNullOrBlank() && settingsError != submittedSettingsError) {
            pending = false
            localError = settingsError
            return@LaunchedEffect
        }
        val actionError = state.error
        if (!actionError.isNullOrBlank() && actionError != submittedActionError) {
            pending = false
            localError = actionError
            return@LaunchedEffect
        }
        val saved = current
        if (saved != null) {
            val fieldsMatch = saved.optText("label") == label.trim() &&
                saved.optText("baseUrl") == baseUrl.trim() &&
                saved.optText("model") == model.trim() &&
                saved.optText("apiMode") == apiMode
            val revisionChanged = source == null || saved.optInt("revision", -1) != originalRevision
            if (fieldsMatch && revisionChanged) {
                pending = false
                apiKey = ""
                onClose()
                return@LaunchedEffect
            }
        }
        if (!notice.isNullOrBlank() && notice != submittedNotice) {
            pending = false
            apiKey = ""
            actions.loadPanel("settings")
            onClose()
        }
    }
    LaunchedEffect(pending) {
        if (pending) {
            kotlinx.coroutines.delay(12_000)
            if (pending) {
                pending = false
                localError = "尚未收到 Core 确认。请刷新来源列表检查；表单内容已保留。"
            }
        }
    }

    val dialogDirty = source == null || label.trim() != source.optText("label") ||
        baseUrl.trim() != source.optText("baseUrl") ||
        model.trim() != source.optText("model") ||
        apiMode != source.optText("apiMode") ||
        apiKey.isNotEmpty()

    AlertDialog(
        onDismissRequest = { if (!pending) onClose() },
        title = { Text(if (source == null) "添加模型来源" else "编辑模型来源") },
        text = {
            Column(
                Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "来源 $sourceId。保存只提交此来源；不会回显已保存密钥。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!state.error.isNullOrBlank()) {
                    SettingsErrorBanner(state.error.orEmpty(), onDismiss = actions::dismissError)
                }
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text("来源名称") },
                    singleLine = true,
                    enabled = !pending,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = baseUrl,
                    onValueChange = { baseUrl = it },
                    label = { Text("Base URL") },
                    placeholder = { Text("https://api.example.com/v1") },
                    singleLine = true,
                    enabled = !pending,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("默认模型 ID") },
                    singleLine = true,
                    enabled = !pending,
                    modifier = Modifier.fillMaxWidth(),
                )
                SettingsDropdown(
                    label = "API 协议",
                    value = apiMode,
                    options = listOf(
                        "chat-completions" to "Chat Completions",
                        "responses" to "Responses",
                        "anthropic" to "Anthropic Messages",
                        "gemini" to "Gemini",
                    ),
                    enabled = !pending,
                    onSelect = { apiMode = it },
                )
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it },
                    label = { Text(if (source?.optBoolean("hasApiKey") == true) "API Key（留空不覆盖）" else "API Key（可选）") },
                    singleLine = true,
                    enabled = !pending,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    if (source?.optBoolean("hasApiKey") == true) {
                        "已保存密钥不会回显；输入新值会替换，留空保持现有密钥。密钥只保留在本次进程内。"
                    } else {
                        "密钥只保留在本次进程内，不写入 saved state、偏好或日志。"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (source != null) {
                    DialogCatalogSuggestions(state, actions, sourceId, onSelect = { model = it })
                }
                if (localError.isNotBlank()) PanelError(localError)
                if (pending) PanelLoading("已提交，等待 Core 确认…")
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    localError = ""
                    try {
                        val sourceObject = sourceForSave(source)
                        sourceObject.put("id", sourceId)
                        sourceObject.put("label", label.trim())
                        sourceObject.put("baseUrl", baseUrl.trim())
                        sourceObject.put("model", model.trim())
                        sourceObject.put("apiMode", apiMode)
                        val operation = JSONObject().put("type", "save").put("source", sourceObject)
                        if (source != null && source.hasValue("revision")) {
                            operation.put("expectedRevision", source.optInt("revision"))
                        }
                        if (apiKey.isNotEmpty()) {
                            require(!apiKey.contains('\n') && !apiKey.contains('\r')) { "API Key 不能包含换行。" }
                            require(apiKey.length <= 16384) { "API Key 过长。" }
                            operation.put("apiKey", apiKey)
                        }
                        validateSourceDraft(sourceId, label, baseUrl, model, apiMode)
                        submittedNotice = notice
                        submittedSettingsError = settingsError
                        submittedActionError = state.error
                        pending = true
                        actions.configureModelSource(operation)
                    } catch (error: IllegalArgumentException) {
                        localError = error.message ?: "来源字段无效。"
                    } catch (error: Exception) {
                        localError = error.message ?: "无法构建来源配置。"
                    }
                },
                enabled = canMutate && dialogDirty && !pending,
                modifier = Modifier.heightIn(min = 48.dp).testTag("model-source-save"),
            ) { Text(if (pending) "提交中…" else "保存来源") }
        },
        dismissButton = {
            TextButton(
                onClick = onClose,
                enabled = !pending,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("取消") }
        },
    )
}

@Composable
private fun DialogCatalogSuggestions(
    state: ChatUiState,
    actions: ChatActions,
    sourceId: String,
    onSelect: (String) -> Unit,
) {
    val key = "models:$sourceId"
    val raw = state.workbench.values[key]
    val loading = key in state.workbench.loading
    val error = state.workbench.errors[key]
    val models = remember(raw) {
        raw?.let { runCatching { JSONArray(it).stringList() }.getOrNull() }
    }
    LaunchedEffect(sourceId, raw, error) {
        if (state.isConnected() && raw == null && !loading && error == null) {
            actions.loadModelCatalog(sourceId, false)
        }
    }
    if (models.isNullOrEmpty() && !loading && error == null) return
    PanelDisclosure("从来源目录选择模型", initiallyExpanded = false) {
        if (!error.isNullOrBlank()) PanelError(error)
        if (loading) PanelLoading("正在读取目录…")
        models?.take(16)?.forEach { model ->
            Text(
                model,
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .clickable { onSelect(model) }
                    .padding(vertical = 8.dp),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if ((models?.size ?: 0) > 16) {
            Text("仅显示前 16 个；可在来源卡片中展开完整目录。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun sourceForSave(source: JSONObject?): JSONObject {
    val out = JSONObject()
    if (source == null) return out
    val preserve = listOf(
        "preset", "endpoints", "modelSelection", "modelAliases", "credentialRouting",
        "sticky", "activeCredentialId",
    )
    preserve.forEach { key ->
        if (source.hasValue(key)) out.put(key, source.opt(key))
    }
    return out
}

private fun validateSourceDraft(
    id: String,
    label: String,
    baseUrl: String,
    model: String,
    apiMode: String,
) {
    require(Regex("^[a-z][a-z0-9_-]{0,31}$").matches(id)) { "来源 ID 格式无效。" }
    require(label.trim().isNotEmpty() && label.trim().length <= 80) { "来源名称必须为 1–80 字符。" }
    validateProviderBaseUrl(baseUrl.trim())
    require(model.trim().length <= 256) { "默认模型 ID 不能超过 256 字符。" }
    require(apiMode in setOf("chat-completions", "responses", "anthropic", "gemini")) { "API 协议无效。" }
}

private fun validateProviderBaseUrl(value: String) {
    require(value.isNotEmpty() && value.length <= 4096) { "Base URL 不能为空。" }
    require(!value.contains('\n') && !value.contains('\r')) { "Base URL 不能包含换行。" }
    val uri = try { URI(value) } catch (_: Exception) {
        throw IllegalArgumentException("Base URL 格式无效。")
    }
    require(uri.scheme == "http" || uri.scheme == "https") { "Base URL 必须是 HTTP(S)。" }
    require(uri.host != null && uri.host.isNotBlank()) { "Base URL 必须包含主机。" }
    require(uri.userInfo == null) { "Base URL 不能包含用户名或密码。" }
    require(uri.rawQuery == null && uri.rawFragment == null) { "Base URL 不能包含查询或片段。" }
}

private fun newSourceId(): String =
    "source-" + UUID.randomUUID().toString().replace("-", "").take(10)

@Composable
private fun McpSection(state: ChatUiState, actions: ChatActions, enabled: Boolean) {
    val connected = state.isConnected()
    val canMutate = state.canSendSideEffect()
    val servers = state.panelObjects("mcp", "servers")
    val loading = state.panelLoading("mcp")
    val error = state.panelError("mcp")
    var removing by remember { mutableStateOf<JSONObject?>(null) }
    var showForm by rememberSaveable { mutableStateOf(false) }
    var jsonMode by rememberSaveable { mutableStateOf(false) }
    var formError by remember { mutableStateOf("") }
    var pendingId by remember { mutableStateOf<String?>(null) }
    var submittedNotice by remember { mutableStateOf<String?>(null) }
    var submittedError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(connected, enabled) {
        if (connected && enabled && state.workbench.values["mcp"] == null &&
            !loading && error == null
        ) actions.loadPanel("mcp")
    }
    LaunchedEffect(servers.map { it.optText("id") }, state.workbench.notice, error) {
        val id = pendingId ?: return@LaunchedEffect
        if (!error.isNullOrBlank() && error != submittedError) {
            formError = error
            pendingId = null
            return@LaunchedEffect
        }
        if (servers.any { it.optText("id") == id } ||
            (!state.workbench.notice.isNullOrBlank() && state.workbench.notice != submittedNotice)
        ) {
            if (servers.none { it.optText("id") == id }) actions.loadPanel("mcp")
            pendingId = null
            showForm = false
            formError = ""
        }
    }

    PanelSection(
        title = "MCP 服务器 · ${servers.size}",
        subtitle = "MCP 服务器可在本机执行命令；只注册可信来源。启用/停用立即生效。",
        action = {
            TextButton(
                onClick = { actions.loadPanel("mcp") },
                enabled = connected,
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Icon(Icons.Default.Refresh, null)
                Spacer(Modifier.width(4.dp))
                Text("刷新")
            }
        },
    ) {
        if (!connected) {
            PanelNotice("连接 Core 后才能读取和管理 MCP。")
        }
        if (!error.isNullOrBlank()) PanelError(error, onRetry = { actions.loadPanel("mcp") })
        if (loading) PanelLoading("正在读取 MCP 服务器…")
        if (servers.isEmpty() && !loading && error == null && connected) {
            PanelEmpty(
                title = "尚未注册 MCP 服务器",
                message = "可添加 stdio 服务器，或使用服务器端 CLI 注册。",
            )
        }
        servers.forEach { server ->
            val id = server.optText("id")
            val transport = server.optText("transport").ifBlank { "stdio" }
            Surface(
                Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            server.optText("label").ifBlank { id },
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Switch(
                            checked = server.optBoolean("enabled"),
                            onCheckedChange = { actions.setMcpEnabled(id, it) },
                            enabled = canMutate && !state.busy,
                        )
                    }
                    PanelInfoRow("ID", id, mono = true)
                    PanelInfoRow("传输", transport)
                    if (transport == "stdio") {
                        PanelInfoRow("命令", server.optText("command"), mono = true)
                        val args = server.optStrings("args")
                        if (args.isNotEmpty()) PanelInfoRow("参数", args.joinToString(" "), mono = true)
                    } else {
                        PanelInfoRow("URL", server.optText("url"), mono = true)
                    }
                    Text(
                        "环境变量 ${server.optInt("envNameCount", 0)} · " +
                            "私有环境 ${if (server.optBoolean("hasPrivateEnv")) "有" else "无"} · " +
                            "请求头 ${server.optInt("headerCount", 0)}" +
                            (if (server.optBoolean("hasPrivateHeaders")) "（有私有值）" else ""),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        PanelStatus(if (server.optBoolean("enabled")) "已启用" else "已停用",
                            if (server.optBoolean("enabled")) PanelTone.Success else PanelTone.Neutral)
                        PanelBadge("超时 ${server.optInt("requestTimeoutMs", 0)} ms")
                    }
                    TextButton(
                        onClick = { removing = server },
                        enabled = canMutate,
                        modifier = Modifier.heightIn(min = 48.dp),
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Icon(Icons.Default.Delete, null); Spacer(Modifier.width(4.dp)); Text("移除服务器") }
                }
            }
        }
    }

    PanelSection(
        title = "注册 stdio MCP",
        subtitle = "注册后由 Core 在主机执行命令。仅支持公开的 stdio 注册 schema；远程 MCP 请用服务器 CLI。",
        action = {
            OutlinedButton(
                onClick = { showForm = !showForm; formError = "" },
                enabled = connected && canMutate,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(if (showForm) "收起" else "添加") }
        },
    ) {
        if (!showForm) {
            Text("支持表单或直接提交 stdio JSON。不会显示或保存环境变量值。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { jsonMode = false },
                    enabled = !jsonMode && pendingId == null,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                ) { Text("表单") }
                OutlinedButton(
                    onClick = { jsonMode = true },
                    enabled = jsonMode && pendingId == null,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                ) { Text("stdio JSON") }
            }
            if (jsonMode) {
                McpJsonForm(
                    pending = pendingId != null,
                    error = formError,
                    onSubmit = { input, id ->
                        formError = ""
                        submittedNotice = state.workbench.notice
                        submittedError = error
                        pendingId = id
                        actions.registerMcpServer(input)
                    },
                )
            } else {
                McpServerForm(
                    pending = pendingId != null,
                    error = formError,
                    onSubmit = { input, id ->
                        formError = ""
                        submittedNotice = state.workbench.notice
                        submittedError = error
                        pendingId = id
                        actions.registerMcpServer(input)
                    },
                )
            }
            if (pendingId != null) PanelLoading("已提交注册，等待 Core 确认…")
            if (formError.isNotBlank()) PanelError(formError)
        }
    }

    val removeServer = removing
    if (removeServer != null) {
        PanelConfirmDialog(
            title = "移除 MCP 服务器？",
            text = "将移除 ${removeServer.optText("label")}（${removeServer.optText("id")}）。" +
                "此操作会影响后续工具发现与调用；正在使用该服务器的请求可能失败。" +
                "Core 的拒绝会原样显示，不会绕过。",
            confirmLabel = "确认移除",
            danger = true,
            enabled = canMutate,
            onConfirm = {
                actions.removeMcpServer(removeServer.optText("id"))
                removing = null
            },
            onDismiss = { removing = null },
        )
    }
}

@Composable
private fun McpServerForm(
    pending: Boolean,
    error: String,
    onSubmit: (JSONObject, String) -> Unit,
) {
    var id by rememberSaveable { mutableStateOf("") }
    var label by rememberSaveable { mutableStateOf("") }
    var command by rememberSaveable { mutableStateOf("") }
    var args by rememberSaveable { mutableStateOf("[]") }
    var enabled by rememberSaveable { mutableStateOf(true) }
    var localError by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(id, { id = it }, label = { Text("服务器 ID") },
            placeholder = { Text("例如 filesystem") }, singleLine = true,
            enabled = !pending, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(label, { label = it }, label = { Text("显示名称") },
            singleLine = true, enabled = !pending, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(command, { command = it }, label = { Text("启动命令") },
            placeholder = { Text("例如 npx") }, singleLine = true,
            enabled = !pending, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(args, { args = it }, label = { Text("参数（JSON 字符串数组）") },
            placeholder = { Text("[\"-y\", \"@modelcontextprotocol/server-filesystem\"]") },
            singleLine = true, enabled = !pending, modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = enabled, onCheckedChange = { enabled = it }, enabled = !pending)
            Text("注册后启用")
        }
        if (localError.isNotBlank()) PanelError(localError)
        if (error.isNotBlank()) PanelError(error)
        Button(
            onClick = {
                try {
                    val input = JSONObject()
                        .put("id", id.trim())
                        .put("label", label.trim())
                        .put("command", command.trim())
                        .put("args", parseMcpArgs(args))
                        .put("enabled", enabled)
                    validateMcpRegister(input)
                    localError = ""
                    onSubmit(input, id.trim())
                } catch (failure: IllegalArgumentException) {
                    localError = failure.message ?: "MCP 注册字段无效。"
                }
            },
            enabled = !pending && id.isNotBlank() && label.isNotBlank() && command.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text("注册服务器") }
        Text("参数必须是 JSON 字符串数组；不要在此填写密钥。服务器环境由服务器端受控配置。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun McpJsonForm(
    pending: Boolean,
    error: String,
    onSubmit: (JSONObject, String) -> Unit,
) {
    var text by rememberSaveable {
        mutableStateOf("{\n  \"id\": \"\",\n  \"label\": \"\",\n  \"command\": \"\",\n  \"args\": []\n}")
    }
    var localError by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            label = { Text("stdio JSON") },
            minLines = 6,
            maxLines = 12,
            enabled = !pending,
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
        )
        if (localError.isNotBlank()) PanelError(localError)
        if (error.isNotBlank()) PanelError(error)
        Button(
            onClick = {
                try {
                    val input = JSONObject(text)
                    input.keys().forEach { key ->
                        require(key in setOf("id", "label", "command", "args", "enabled", "requestTimeoutMs", "transport")) {
                            "不支持的字段：$key。stdio 注册不接受 env、headers 或凭据。"
                        }
                    }
                    require(input.optText("transport").ifBlank { "stdio" } == "stdio") {
                        "此表单只支持 stdio；远程 MCP 请使用服务器 CLI。"
                    }
                    validateMcpRegister(input)
                    localError = ""
                    onSubmit(input, input.optText("id"))
                } catch (failure: IllegalArgumentException) {
                    localError = failure.message ?: "JSON 注册字段无效。"
                } catch (failure: Exception) {
                    localError = "JSON 格式错误：${failure.message.orEmpty()}"
                }
            },
            enabled = !pending && text.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text("提交 JSON 注册") }
        Text("只接受真实 mcpStdioRegisterDto 字段；env 值、headers 与账号凭据不会通过此入口发送。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun parseMcpArgs(raw: String): JSONArray {
    val array = try { JSONArray(raw.ifBlank { "[]" }) } catch (_: Exception) {
        throw IllegalArgumentException("MCP 参数必须是 JSON 字符串数组。")
    }
    require(array.length() <= 64) { "MCP 参数最多 64 个。" }
    val out = JSONArray()
    for (index in 0 until array.length()) {
        val value = array.opt(index)
        require(value is String && value.length <= 8192) { "MCP 参数必须是字符串且不超过 8192 字符。" }
        require(!value.contains('\n') && !value.contains('\r') && !value.contains('\u0000')) {
            "MCP 参数不能包含换行或 NUL。"
        }
        out.put(value)
    }
    return out
}

private fun validateMcpRegister(input: JSONObject) {
    val id = input.optText("id").trim()
    require(Regex("^[a-z0-9][a-z0-9-]{0,31}$").matches(id) && !id.contains("__")) {
        "MCP ID 必须匹配 ^[a-z0-9][a-z0-9-]{0,31}$ 且不能包含 __。"
    }
    val label = input.optText("label").trim()
    require(label.isNotEmpty() && label.length <= 64 && !label.contains('\n') && !label.contains('\r')) {
        "MCP 显示名称必须为 1–64 字符且不能换行。"
    }
    val command = input.optText("command").trim()
    require(command.isNotEmpty() && command.length <= 4096 && !command.contains('\n') && !command.contains('\r')) {
        "MCP 启动命令必须为 1–4096 字符且不能换行。"
    }
    val args = input.optJSONArray("args") ?: JSONArray()
    require(args.length() <= 64) { "MCP 参数最多 64 个。" }
    for (index in 0 until args.length()) {
        require(args.opt(index) is String) { "MCP 参数必须是字符串。" }
    }
    if (input.hasValue("requestTimeoutMs")) {
        val timeout = input.optInt("requestTimeoutMs", -1)
        require(timeout in 1_000..60_000) { "MCP 请求超时范围为 1000–60000 ms。" }
    }
}

@Composable
private fun ConnectionSection(state: ChatUiState, actions: ChatActions, onClose: () -> Unit) {
    var url by rememberSaveable { mutableStateOf(state.serverUrl) }
    // Process-memory only: the credential is never saved to preferences or saved instance state.
    var credential by remember { mutableStateOf("") }
    var pair by rememberSaveable { mutableStateOf(false) }
    var awaitingConnect by remember { mutableStateOf(false) }
    val connected = state.connection == ConnectionPhase.Connected
    val locked = state.sending || state.busy

    LaunchedEffect(state.serverUrl) {
        if (url.isBlank() && state.serverUrl.isNotBlank()) url = state.serverUrl
    }
    LaunchedEffect(state.connection, awaitingConnect) {
        if (!awaitingConnect) return@LaunchedEffect
        when (state.connection) {
            ConnectionPhase.Connected -> {
                awaitingConnect = false
                onClose()
            }
            ConnectionPhase.Disconnected, ConnectionPhase.Paused -> awaitingConnect = false
            else -> Unit
        }
    }

    PanelSection(
        title = "服务器连接",
        subtitle = "原生聊天直连 Core API，不需要部署 Web 界面。",
        action = {
            PanelStatus(
                when (state.connection) {
                    ConnectionPhase.Connected -> "已连接"
                    ConnectionPhase.Connecting -> "正在连接"
                    ConnectionPhase.Reconnecting -> "正在重连"
                    ConnectionPhase.Paused -> "连接暂停"
                    ConnectionPhase.Disconnected -> "未连接"
                },
                when (state.connection) {
                    ConnectionPhase.Connected -> PanelTone.Success
                    ConnectionPhase.Connecting, ConnectionPhase.Reconnecting -> PanelTone.Accent
                    ConnectionPhase.Paused -> PanelTone.Warning
                    ConnectionPhase.Disconnected -> PanelTone.Danger
                },
            )
        },
    ) {
        if (state.serverUrl.isNotBlank() || state.workspace.isNotBlank()) {
            PanelInfoRow("当前服务器", state.serverUrl.ifBlank { "—" }, mono = true)
        }
        if (state.workspace.isNotBlank()) {
            PanelInfoRow("远端工作区", state.workspace, mono = true)
        }
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("服务器地址") },
            placeholder = { Text("http://192.168.1.10:5173/") },
            singleLine = true,
            enabled = !locked,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth().testTag("connection-url"),
        )
        OutlinedTextField(
            value = credential,
            onValueChange = { credential = it },
            label = { Text(if (pair) "一次性配对码（可选）" else "设备凭据（可选）") },
            singleLine = true,
            enabled = !locked,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth().testTag("connection-credential"),
        )
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = pair, onCheckedChange = { pair = it }, enabled = !locked)
            Text("使用一次性配对码换取设备凭据", style = MaterialTheme.typography.bodySmall)
        }
        Text(
            "可信局域网直连通常留空。凭据只保留在本次进程；重启应用后需重新填写。" +
                "HTTP 不加密，勿直接暴露到公网。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (state.connectionDetail.isNotBlank()) {
            Text(state.connectionDetail, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (connected) {
            PanelNotice("已连接 · 远端任务不会因为关闭此页面而停止。")
        }
        // Keep connection actions in the page's single vertical scroll container.
        // A nested horizontal scroller can leave the button outside the clipped
        // viewport when accessibility/keyboard users ask to bring it into view.
        Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (!connected) {
                Button(
                    onClick = {
                        awaitingConnect = true
                        actions.connect(url.trim(), credential, pair)
                        credential = ""
                    },
                    enabled = url.isNotBlank() && (!pair || credential.isNotBlank()) && !locked,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("connect"),
                ) { Text(if (awaitingConnect) "正在连接…" else "连接") }
            }
            if (state.connection == ConnectionPhase.Reconnecting || state.connection == ConnectionPhase.Paused) {
                OutlinedButton(
                    onClick = { actions.reconnect() },
                    enabled = !locked,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("重新连接") }
            }
            if (state.connection != ConnectionPhase.Disconnected) {
                TextButton(
                    onClick = {
                        actions.disconnect()
                        onClose()
                    },
                    enabled = !locked,
                    modifier = Modifier.heightIn(min = 48.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("断开连接（不停止远端任务）") }
            }
        }
        if (connected) {
            OutlinedButton(
                onClick = { actions.reconnect() },
                enabled = !locked,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("重新连接") }
        }
        Text(
            "连接成功后此页会关闭。断开连接也只关闭本机连接，不取消远端任务。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
