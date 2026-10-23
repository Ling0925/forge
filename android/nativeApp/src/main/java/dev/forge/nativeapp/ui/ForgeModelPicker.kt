package dev.forge.nativeapp.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import dev.forge.nativeapp.ConnectionPhase
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

private val effortLevels = listOf("none", "minimal", "low", "medium", "high", "xhigh", "max")
private val allEfforts = listOf("default") + effortLevels

private data class ProviderChoice(val id: String, val label: String, val model: String)
private data class RouteChoice(val id: String, val label: String)

/**
 * Model + source + route + global reasoning effort.  The five-bar meter at the
 * composer trigger is continued here as a seven-position preview slider.  The
 * slider never changes the run payload; only the explicit save button patches
 * the server's public settings with `reasoningEffort`.
 */
@Composable
fun ForgeModelPicker(
    state: ChatUiState,
    actions: ChatActions,
    onDismiss: () -> Unit,
) {
    val palette = LocalForgePalette.current
    val compact = LocalConfiguration.current.screenWidthDp <= 600
    val settingsRaw = state.workbench.values["settings"]
    val settings = remember(settingsRaw) {
        state.workbench.obj("settings")
    }
    val sources = remember(settingsRaw) { parseSources(settings) }
    val routes = remember(settingsRaw) { parseRoutes(settings) }
    val savedEffort = remember(settingsRaw) {
        normalizeEffort(settings?.optString("reasoningEffort").orEmpty())
    }
    var draftEffort by rememberSaveable { mutableStateOf(savedEffort) }
    var pendingEffort by remember { mutableStateOf<String?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    val settingsError = state.workbench.errors["settings"].orEmpty()
    val settingsLoading = state.workbench.loading.contains("settings")
    val catalogKey = "models:${state.providerSourceId}"
    val modelsLoading = catalogKey in state.workbench.loading
    val modelsError = state.workbench.errors[catalogKey]
    val saving = settingsLoading || pendingEffort != null
    val connected = state.connection == ConnectionPhase.Connected
    val canMutate = connected && !state.sending && !state.busy && !state.uncertain && !saving
    val routeSelected = state.routeGroupId.isNotBlank()

    val activeSourceId = state.providerSourceId.ifBlank {
        settings?.optString("activeSourceId").orEmpty()
    }
    val activeSource = sources.firstOrNull { it.id == activeSourceId }
    val activeRoute = routes.firstOrNull { it.id == state.routeGroupId }
    val filteredModels = remember(state.models, search) {
        val needle = search.trim()
        state.models.filter { needle.isEmpty() || it.contains(needle, ignoreCase = true) }.distinct()
    }

    LaunchedEffect(Unit) {
        if (settings == null) actions.loadPanel("settings")
    }
    LaunchedEffect(savedEffort, settingsError, settingsRaw) {
        if (pendingEffort != null) {
            if (settingsError.isNotBlank()) {
                pendingEffort = null
            } else if (savedEffort == pendingEffort) {
                pendingEffort = null
            }
        }
        if (pendingEffort == null) draftEffort = savedEffort
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val screenHeight = LocalConfiguration.current.screenHeightDp.dp
        Box(
            Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = palette.elevated,
                contentColor = palette.textPrimary,
                border = BorderStroke(1.dp, palette.borderSubtle),
                shadowElevation = 10.dp,
                modifier = Modifier.widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .heightIn(max = screenHeight * 0.88f)
                    .testTag("model-picker-panel"),
            ) {
                Column(Modifier.fillMaxSize()) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 10.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("模型与思考", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                when {
                                    activeRoute != null -> "路由组：${activeRoute.label}"
                                    activeSource != null -> "来源：${activeSource.label}"
                                    else -> "来源、模型与全局思考强度"
                                },
                                fontSize = 11.sp,
                                color = palette.textSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        IconButton(onClick = onDismiss, modifier = Modifier.size(44.dp)) {
                            Icon(Icons.Default.Close, "关闭模型与思考", tint = palette.textSecondary)
                        }
                    }
                    HorizontalDivider(color = palette.borderSubtle)
                    LazyColumn(
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        if (settings == null) {
                            item("settings-missing") {
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = palette.soft,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text(
                                            if (settingsLoading) "正在读取服务器设置…" else "尚未读取服务器设置",
                                            fontSize = 12.sp,
                                            color = palette.textSecondary,
                                        )
                                        TextButton(
                                            onClick = { actions.loadPanel("settings") },
                                            enabled = connected,
                                            modifier = Modifier.heightIn(min = 44.dp),
                                        ) { Text("重新读取设置") }
                                    }
                                }
                            }
                        }
                        if (settingsError.isNotBlank()) {
                            item("settings-error") {
                                Text(
                                    settingsError,
                                    color = palette.error,
                                    fontSize = 11.sp,
                                    lineHeight = 16.sp,
                                )
                            }
                        }

                        item("sources") {
                            PickerSection(
                                title = "来源",
                                subtitle = if (routeSelected) {
                                    "路由组正在决定模型；先取消路由组再选择来源。"
                                } else {
                                    "切换来源会由服务器重新加载模型目录。"
                                },
                            ) {
                                if (sources.isEmpty()) {
                                    Text(
                                        "服务器未提供可选来源，将使用当前设置。",
                                        fontSize = 12.sp,
                                        color = palette.textSecondary,
                                    )
                                } else {
                                    Row(
                                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        sources.forEach { source ->
                                            ChoiceChip(
                                                label = source.label,
                                                selected = source.id == activeSourceId,
                                                enabled = canMutate && !routeSelected,
                                                onClick = { actions.setModelSource(source.id) },
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        if (routes.isNotEmpty()) {
                            item("routes") {
                                PickerSection(
                                    title = "路由组",
                                    subtitle = "路由组按服务器策略选择模型；启用后不再提交单独模型。",
                                ) {
                                    Row(
                                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        ChoiceChip(
                                            label = "不使用",
                                            selected = state.routeGroupId.isBlank(),
                                            enabled = canMutate,
                                            onClick = { actions.setRouteGroup("") },
                                        )
                                        routes.forEach { route ->
                                            ChoiceChip(
                                                label = route.label,
                                                selected = route.id == state.routeGroupId,
                                                enabled = canMutate,
                                                onClick = { actions.setRouteGroup(route.id) },
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        item("models-title") {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("模型", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    Spacer(Modifier.weight(1f))
                                    TextButton(
                                        onClick = { actions.loadModelCatalog(state.providerSourceId, refresh = true) },
                                        enabled = connected && !state.busy && !state.sending && !routeSelected && !modelsLoading,
                                        contentPadding = PaddingValues(horizontal = 6.dp),
                                        modifier = Modifier.heightIn(min = 44.dp),
                                    ) {
                                        if (modelsLoading) {
                                            CircularProgressIndicator(Modifier.size(13.dp), strokeWidth = 1.5.dp)
                                            Spacer(Modifier.width(5.dp))
                                        } else {
                                            Icon(
                                                Icons.Default.Refresh,
                                                null,
                                                modifier = Modifier.size(14.dp),
                                                tint = palette.textSecondary,
                                            )
                                            Spacer(Modifier.width(4.dp))
                                        }
                                        Text("重新读取", fontSize = 11.sp)
                                    }
                                }
                                Text(
                                    if (routeSelected) "模型由路由组决定。" else "仅显示服务器返回的模型目录；可搜索完整 ID。",
                                    fontSize = 11.sp,
                                    color = palette.textSecondary,
                                )
                            }
                        }

                        if (!routeSelected) {
                            if (!modelsError.isNullOrBlank()) {
                                item("model-error") {
                                    Text("目录读取失败：$modelsError。已有目录仍保留。", color = palette.error,
                                        fontSize = 12.sp, lineHeight = 18.sp)
                                }
                            }
                            item("model-search") {
                                SearchField(
                                    value = search,
                                    onValueChange = { search = it },
                                    enabled = canMutate,
                                    onClear = { search = "" },
                                )
                            }
                            item("default-model") {
                                ModelRow(
                                    model = "",
                                    title = "服务器默认模型",
                                    subtitle = if (activeSource != null && activeSource.model.isNotBlank()) {
                                        "来源 ${activeSource.label} · ${activeSource.model}"
                                    } else {
                                        "不固定模型，由服务器配置决定"
                                    },
                                    selected = state.selectedModel.isBlank(),
                                    enabled = canMutate,
                                    onClick = {
                                        actions.selectModel("")
                                        onDismiss()
                                    },
                                )
                            }
                            if (state.models.isEmpty()) {
                                item("models-empty") {
                                    Text(
                                        if (modelsLoading) "正在读取模型目录…" else "服务器尚未返回模型目录。",
                                        color = palette.textSecondary,
                                        fontSize = 12.sp,
                                        lineHeight = 18.sp,
                                        modifier = Modifier.padding(vertical = 4.dp),
                                    )
                                }
                            } else if (filteredModels.isEmpty()) {
                                item("models-no-match") {
                                    Text(
                                        "没有匹配的模型。",
                                        color = palette.textSecondary,
                                        fontSize = 12.sp,
                                        modifier = Modifier.padding(vertical = 4.dp),
                                    )
                                }
                            } else {
                                items(filteredModels, key = { it }) { model ->
                                    val owner = sources.firstOrNull { it.model == model }?.label.orEmpty()
                                    ModelRow(
                                        model = model,
                                        title = model,
                                        subtitle = if (owner.isNotBlank()) "来源 $owner" else "",
                                        selected = state.selectedModel == model,
                                        enabled = canMutate,
                                        onClick = {
                                            actions.selectModel(model)
                                            onDismiss()
                                        },
                                    )
                                }
                            }
                        } else {
                            item("route-model-note") {
                                Text(
                                    "已启用「${activeRoute?.label ?: state.routeGroupId}」，模型目录不参与本次请求。",
                                    color = palette.textSecondary,
                                    fontSize = 12.sp,
                                    lineHeight = 18.sp,
                                )
                            }
                        }

                        item("effort") {
                            EffortSection(
                                savedEffort = savedEffort,
                                draftEffort = draftEffort,
                                pending = pendingEffort,
                                saving = saving,
                                canMutate = canMutate && settings != null,
                                error = settingsError,
                                onDraftChange = { draftEffort = it },
                                onSave = {
                                    pendingEffort = draftEffort
                                    actions.saveSettings(JSONObject().put("reasoningEffort", draftEffort))
                                },
                            )
                        }
                    }
                    HorizontalDivider(color = palette.borderSubtle)
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "全局 · 仅后续请求",
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                        )
                        Spacer(Modifier.weight(1f))
                        TextButton(
                            onClick = onDismiss,
                            modifier = Modifier.heightIn(min = 44.dp),
                        ) { Text("完成") }
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerSection(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    val palette = LocalForgePalette.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(subtitle, fontSize = 11.sp, lineHeight = 16.sp, color = palette.textSecondary)
        content()
    }
}

@Composable
private fun ChoiceChip(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(6.dp),
        color = when {
            selected -> palette.selected
            else -> palette.soft
        },
        contentColor = if (selected) palette.textPrimary else palette.textSecondary,
        border = if (selected) BorderStroke(1.dp, palette.accent.copy(alpha = 0.45f)) else null,
        modifier = Modifier.heightIn(min = 44.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            if (selected) {
                Icon(Icons.Default.Check, null, tint = palette.accent, modifier = Modifier.size(13.dp))
            }
            Text(label, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    onClear: () -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = palette.soft,
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Search, null, tint = palette.textMuted, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(7.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text("搜索模型", color = palette.textMuted, fontSize = 13.sp)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 13.sp, color = palette.textPrimary),
                    cursorBrush = SolidColor(palette.accent),
                    modifier = Modifier.fillMaxWidth().testTag("model-search")
                        .semantics { contentDescription = "搜索模型" },
                )
            }
            if (value.isNotEmpty()) {
                IconButton(onClick = onClear, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Default.Close, "清空模型搜索", tint = palette.textMuted, modifier = Modifier.size(15.dp))
                }
            }
        }
    }
}

@Composable
private fun ModelRow(
    model: String,
    title: String,
    subtitle: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(8.dp),
        color = if (selected) palette.selected else Color.Transparent,
        contentColor = palette.textPrimary,
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    fontFamily = if (model.isNotEmpty()) FontFamily.Monospace else FontFamily.SansSerif,
                    fontSize = if (model.isNotEmpty()) 12.sp else 13.sp,
                    lineHeight = 18.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle.isNotBlank()) {
                    Text(
                        subtitle,
                        fontSize = 10.sp,
                        lineHeight = 15.sp,
                        color = palette.textSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (selected) {
                Icon(Icons.Default.Check, null, tint = palette.accent, modifier = Modifier.size(17.dp))
            }
        }
    }
}

@Composable
private fun EffortSection(
    savedEffort: String,
    draftEffort: String,
    pending: String?,
    saving: Boolean,
    canMutate: Boolean,
    error: String,
    onDraftChange: (String) -> Unit,
    onSave: () -> Unit,
) {
    val palette = LocalForgePalette.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("思考强度", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "全局 · 后续请求",
                    fontSize = 10.sp,
                    color = palette.textSecondary,
                )
            }
            Text(
                if (draftEffort == "default") "自动" else reasoningEffortLabel(draftEffort),
                color = palette.accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ChoiceChip(
                label = "自动",
                selected = draftEffort == "default",
                enabled = canMutate,
                onClick = { onDraftChange("default") },
            )
            if (draftEffort != "default") {
                Text(
                    "拖动或选择下方档位",
                    color = palette.textMuted,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(top = 11.dp),
                )
            }
        }
        val sliderIndex = effortLevels.indexOf(draftEffort).coerceAtLeast(0)
        Slider(
            value = sliderIndex.toFloat(),
            onValueChange = { value ->
                if (canMutate) onDraftChange(effortLevels[value.roundToInt().coerceIn(0, effortLevels.lastIndex)])
            },
            valueRange = 0f..effortLevels.lastIndex.toFloat(),
            steps = 5,
            enabled = canMutate,
            colors = SliderDefaults.colors(
                thumbColor = palette.accent,
                activeTrackColor = palette.accent,
                inactiveTrackColor = palette.borderControl,
                disabledThumbColor = palette.textMuted,
                disabledActiveTrackColor = palette.borderControl,
                disabledInactiveTrackColor = palette.borderSubtle,
            ),
            modifier = Modifier.fillMaxWidth().testTag("reasoning-effort-slider"),
        )
        Row(Modifier.fillMaxWidth()) {
            effortLevels.forEach { level ->
                Text(
                    if (level == "none") "关" else reasoningEffortLabel(level),
                    modifier = Modifier.weight(1f),
                    color = if (draftEffort == level) palette.accent else palette.textMuted,
                    fontSize = 9.sp,
                    lineHeight = 13.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            effortLevels.forEach { level ->
                ChoiceChip(
                    label = if (level == "none") "关" else reasoningEffortLabel(level),
                    selected = draftEffort == level,
                    enabled = canMutate,
                    onClick = { onDraftChange(level) },
                )
            }
        }
        Text(
            "保存后只影响后续请求；本条消息不会携带 per-message 思考字段。",
            color = palette.textSecondary,
            fontSize = 10.sp,
            lineHeight = 15.sp,
        )
        if (draftEffort != savedEffort) {
            Text(
                "预览：${if (draftEffort == "default") "自动" else reasoningEffortLabel(draftEffort)} · 尚未保存",
                color = palette.warning,
                fontSize = 10.sp,
            )
        }
        if (pending != null && pending != savedEffort) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (saving) {
                    CircularProgressIndicator(Modifier.size(13.dp), strokeWidth = 1.5.dp, color = palette.accent)
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    if (saving) "正在保存，等待服务器确认…" else "已提交，等待设置快照更新，避免重复写入。",
                    color = palette.textSecondary,
                    fontSize = 10.sp,
                )
            }
        }
        if (error.isNotBlank()) {
            Text(error, color = palette.error, fontSize = 10.sp, lineHeight = 15.sp)
        }
        Button(
            onClick = onSave,
            enabled = canMutate && draftEffort != savedEffort && !saving && pending == null,
            modifier = Modifier.heightIn(min = 44.dp),
            colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                containerColor = palette.runBackground,
                contentColor = palette.runInk,
            ),
        ) {
            if (saving) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = palette.runInk)
                Spacer(Modifier.width(7.dp))
            }
            Text("保存为全局设置", fontSize = 12.sp)
        }
    }
}

@Composable
internal fun EffortMeter(effort: String, modifier: Modifier = Modifier) {
    val palette = LocalForgePalette.current
    val filled = when (effort) {
        "minimal", "low" -> 1
        "medium" -> 2
        "high" -> 3
        "xhigh" -> 4
        "max" -> 5
        else -> 0
    }
    Canvas(modifier.size(width = 21.dp, height = 11.dp)) {
        val barWidth = 3.dp.toPx()
        val gap = 2.dp.toPx()
        val total = barWidth * 5 + gap * 4
        val startX = (size.width - total) / 2f
        repeat(5) { index ->
            drawRoundRect(
                color = if (index < filled) palette.accent else palette.borderControl,
                topLeft = Offset(startX + index * (barWidth + gap), 0f),
                size = Size(barWidth, size.height),
                cornerRadius = CornerRadius(barWidth / 2f),
            )
        }
    }
}

private fun parseSources(settings: JSONObject?): List<ProviderChoice> {
    val array = settings?.optJSONArray("providerSources") ?: return emptyList()
    return (0 until array.length()).mapNotNull { index ->
        val source = array.optJSONObject(index) ?: return@mapNotNull null
        val id = source.optString("id")
        if (id.isBlank()) return@mapNotNull null
        ProviderChoice(
            id = id,
            label = source.optString("label").ifBlank { id },
            model = source.optString("model"),
        )
    }
}

private fun parseRoutes(settings: JSONObject?): List<RouteChoice> {
    val array = settings?.optJSONArray("routeGroups") ?: return emptyList()
    return (0 until array.length()).mapNotNull { index ->
        val route = array.optJSONObject(index) ?: return@mapNotNull null
        val id = route.optString("id")
        if (id.isBlank()) return@mapNotNull null
        RouteChoice(id, route.optString("label").ifBlank { id })
    }
}

private fun normalizeEffort(value: String): String = if (value in allEfforts) value else "default"
