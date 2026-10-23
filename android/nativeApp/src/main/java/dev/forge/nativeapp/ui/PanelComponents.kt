package dev.forge.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.ChatUiState
import java.text.NumberFormat
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

internal data class PanelTabItem(
    val id: String,
    val label: String,
    val badge: String? = null,
    val tag: String? = null,
)

enum class PanelTone { Neutral, Accent, Success, Warning, Danger }

@Composable
internal fun PanelHeader(
    title: String,
    onClose: () -> Unit,
    subtitle: String? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val palette = LocalForgePalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .padding(start = 6.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ForgeIconButton(
            onClick = onClose,
            contentDescription = "返回工作台",
            size = 40.dp,
            modifier = Modifier.testTag("panel-back"),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                null,
                tint = palette.textSecondary,
                modifier = Modifier.size(19.dp),
            )
        }
        Column(Modifier.weight(1f).padding(horizontal = 6.dp)) {
            Text(
                title,
                color = palette.textPrimary,
                fontSize = 17.sp,
                lineHeight = 23.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.2).sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    subtitle,
                    color = palette.textMuted,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = trailing,
        )
    }
}

/** Compact, scrollable category switcher (Web `.settings-nav-item`). */
@Composable
internal fun PanelTabRow(
    tabs: List<PanelTabItem>,
    selectedId: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalForgePalette.current
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEach { tab ->
            val selected = tab.id == selectedId
            val base = Modifier.heightIn(min = 32.dp)
                .clip(RoundedCornerShape(ForgeDimens.radiusSm))
                .background(if (selected) palette.selected else Color.Transparent)
                .then(if (tab.tag != null) Modifier.testTag(tab.tag) else Modifier)
                .selectable(
                    selected = selected,
                    role = Role.Tab,
                    onClick = { onSelect(tab.id) },
                )
            Row(
                base.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    tab.label,
                    color = if (selected) palette.textPrimary else palette.textSecondary,
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    maxLines = 1,
                )
                if (!tab.badge.isNullOrBlank()) {
                    Text(
                        tab.badge,
                        color = if (selected) palette.accent else palette.textMuted,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

@Composable
internal fun PanelSection(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    action: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    ForgeSectionCard(
        title = title,
        subtitle = subtitle,
        modifier = modifier,
        action = if (action != null) {
            { action() }
        } else {
            null
        },
        content = content,
    )
}

@Composable
internal fun PanelInfoRow(label: String, value: String, mono: Boolean = false) {
    val palette = LocalForgePalette.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(
            label,
            Modifier.width(92.dp),
            color = palette.textMuted,
            fontSize = 11.sp,
            lineHeight = 18.sp,
        )
        SelectionContainer(Modifier.weight(1f)) {
            Text(
                value.ifBlank { "—" },
                color = palette.textPrimary,
                fontFamily = if (mono) ForgeMonoFamily else null,
                fontSize = 12.sp,
                lineHeight = 18.sp,
            )
        }
    }
}

@Composable
internal fun PanelStatus(text: String, tone: PanelTone, modifier: Modifier = Modifier) {
    val palette = LocalForgePalette.current
    ForgePill(text, modifier, tone, dot = tone == PanelTone.Success || tone == PanelTone.Warning)
}

internal fun statusTone(status: String): PanelTone = when (status) {
    "running", "in_progress" -> PanelTone.Accent
    "completed", "idle", "succeeded", "ready" -> PanelTone.Success
    "awaiting_approval", "pending", "paused", "stale" -> PanelTone.Warning
    "failed", "cancelled", "interrupted", "error", "unavailable" -> PanelTone.Danger
    else -> PanelTone.Neutral
}

@Composable
internal fun PanelEmpty(
    title: String,
    message: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val palette = LocalForgePalette.current
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            title,
            color = palette.textPrimary,
            fontSize = 13.sp,
            lineHeight = 19.sp,
            fontWeight = FontWeight.SemiBold,
        )
        if (!message.isNullOrBlank()) {
            Text(
                message,
                color = palette.textSecondary,
                fontSize = 11.5.sp,
                lineHeight = 17.sp,
            )
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(2.dp))
            ForgeTextAction(actionLabel, onAction)
        }
    }
}

@Composable
internal fun PanelError(message: String, onRetry: (() -> Unit)? = null) {
    ForgeNotice(
        text = message,
        tone = PanelTone.Danger,
        action = if (onRetry != null) {
            { ForgeTextAction("重试", onRetry, danger = true) }
        } else {
            null
        },
    )
}

@Composable
internal fun PanelNotice(message: String, onDismiss: (() -> Unit)? = null) {
    ForgeNotice(
        text = message,
        tone = PanelTone.Accent,
        action = if (onDismiss != null) {
            { ForgeTextAction("知道了", onDismiss) }
        } else {
            null
        },
    )
}

@Composable
internal fun PanelLoading(text: String = "正在读取…") {
    val palette = LocalForgePalette.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        CircularProgressIndicator(
            Modifier.size(15.dp),
            strokeWidth = 1.6.dp,
            color = palette.accent,
        )
        Text(text, color = palette.textSecondary, fontSize = 11.5.sp, lineHeight = 17.sp)
    }
}

@Composable
internal fun PanelConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    danger: Boolean = false,
    enabled: Boolean = true,
) {
    ForgeDialog(
        onDismissRequest = onDismiss,
        title = title,
        actions = {
            ForgeTextAction("取消", onDismiss)
            ForgePrimaryButton(confirmLabel, onConfirm, enabled = enabled, danger = danger)
        },
    ) {
        Text(
            text,
            color = LocalForgePalette.current.textSecondary,
            fontSize = 12.5.sp,
            lineHeight = 19.sp,
        )
    }
}

@Composable
internal fun PanelDisclosure(
    title: String,
    initiallyExpanded: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    var expanded by rememberSaveable(title) { mutableStateOf(initiallyExpanded) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 34.dp)
                .clip(RoundedCornerShape(ForgeDimens.radiusSm))
                .selectable(selected = expanded, role = Role.Button, onClick = { expanded = !expanded })
                .padding(horizontal = 6.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                title,
                Modifier.weight(1f),
                color = palette.textPrimary,
                fontSize = 12.5.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                if (expanded) "收起" else "展开",
                tint = palette.textMuted,
                modifier = Modifier.size(16.dp).rotate(if (expanded) 90f else 0f),
            )
        }
        if (expanded) {
            Column(
                Modifier.padding(start = 6.dp, end = 6.dp, top = 6.dp, bottom = 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { content() }
        }
    }
}

@Composable
internal fun PanelCodeBlock(
    text: String,
    modifier: Modifier = Modifier,
    maxLines: Int = 280,
    emptyText: String = "没有可显示的差异。",
) {
    val palette = LocalForgePalette.current
    if (text.isBlank()) {
        Text(emptyText, color = palette.textMuted, fontSize = 11.5.sp, lineHeight = 17.sp)
        return
    }
    var expanded by rememberSaveable(text) { mutableStateOf(false) }
    val allLines = text.lines()
    val shown = if (expanded || allLines.size <= maxLines) text else allLines.take(maxLines).joinToString("\n")
    Surface(
        modifier.fillMaxWidth(),
        shape = RoundedCornerShape(ForgeDimens.radiusMd),
        color = palette.soft,
    ) {
        Column(Modifier.padding(vertical = 8.dp)) {
            SelectionContainer {
                Text(
                    shown,
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
                    fontFamily = ForgeMonoFamily,
                    fontSize = 11.5.sp,
                    lineHeight = 18.sp,
                    color = palette.textPrimary,
                )
            }
            if (allLines.size > maxLines) {
                ForgeTextAction(
                    label = if (expanded) "收起差异" else "展开其余 ${allLines.size - maxLines} 行",
                    onClick = { expanded = !expanded },
                    modifier = Modifier.padding(start = 6.dp, top = 2.dp),
                )
            }
        }
    }
}

@Composable
internal fun PanelBadge(text: String, tone: PanelTone = PanelTone.Neutral) {
    PanelStatus(text, tone)
}

@Composable
internal fun PanelDivider() {
    HorizontalDivider(color = LocalForgePalette.current.borderSubtle)
}

@Composable
internal fun PanelSpacer(height: Int = 8) {
    Spacer(Modifier.height(height.dp))
}

internal fun ChatUiState.panelObject(section: String, vararg nested: String): JSONObject? {
    var current = workbench.obj(section) ?: return null
    for (key in nested) {
        current = current.optJSONObject(key) ?: return null
    }
    return current
}

internal fun parseSectionObject(raw: String?, vararg wrapperKeys: String): JSONObject? {
    val parsed = raw?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
    for (key in wrapperKeys) {
        parsed.optJSONObject(key)?.let { return it }
    }
    return parsed
}

internal fun ChatUiState.panelObjects(section: String, vararg arrayKeys: String): List<JSONObject> {
    val direct = workbench.array(section)
    if (direct.isNotEmpty()) return direct
    val raw = workbench.values[section]
    if (raw != null && raw.trimStart().startsWith("[")) return emptyList()
    val obj = workbench.obj(section) ?: return emptyList()
    for (key in arrayKeys) {
        val array = obj.optJSONArray(key) ?: continue
        return array.objectList()
    }
    return emptyList()
}

internal fun ChatUiState.panelLoading(section: String): Boolean = section in workbench.loading

internal fun ChatUiState.panelError(section: String): String? = workbench.errors[section]

internal fun ChatUiState.canSendSideEffect(): Boolean =
    connection == dev.forge.nativeapp.ConnectionPhase.Connected && !busy && !sending && !uncertain

internal fun ChatUiState.isConnected(): Boolean =
    connection == dev.forge.nativeapp.ConnectionPhase.Connected

internal fun JSONArray.objectList(): List<JSONObject> {
    val out = ArrayList<JSONObject>(length())
    for (index in 0 until length()) optJSONObject(index)?.let(out::add)
    return out
}

internal fun JSONArray.stringList(): List<String> {
    val out = ArrayList<String>(length())
    for (index in 0 until length()) if (!isNull(index)) out.add(optString(index, ""))
    return out
}

internal fun JSONObject.optText(name: String): String = if (isNull(name)) "" else optString(name, "")

internal fun JSONObject.optObjects(name: String): List<JSONObject> = optJSONArray(name)?.objectList().orEmpty()

internal fun JSONObject.optStrings(name: String): List<String> = optJSONArray(name)?.stringList().orEmpty()

internal fun JSONObject.hasValue(name: String): Boolean = has(name) && !isNull(name)

internal fun formatCount(value: Long): String = NumberFormat.getIntegerInstance(Locale.getDefault()).format(value)

internal fun formatPercent(value: Double): String =
    String.format(Locale.getDefault(), "%.1f%%", (value.coerceIn(0.0, 1.0)) * 100.0)

internal fun formatFileSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.getDefault(), "%.1f KB", bytes / 1024.0)
    else -> String.format(Locale.getDefault(), "%.2f MB", bytes / (1024.0 * 1024.0))
}

internal fun formatTimestamp(value: String): String {
    if (value.isBlank()) return "—"
    return value.replace('T', ' ').removeSuffix("Z").take(19)
}

internal fun compactText(text: String, limit: Int = 220): String =
    if (text.length <= limit) text else text.take(limit).trimEnd() + "…"
