package dev.forge.nativeapp.ui

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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
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

internal enum class PanelTone { Neutral, Accent, Success, Warning, Danger }

@Composable
internal fun PanelHeader(
    title: String,
    onClose: () -> Unit,
    subtitle: String? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = onClose,
            modifier = Modifier.size(48.dp).testTag("panel-back"),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回工作台",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing()
    }
}

@Composable
internal fun PanelTabRow(
    tabs: List<PanelTabItem>,
    selectedId: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEach { tab ->
            val selected = tab.id == selectedId
            val base = Modifier.heightIn(min = 48.dp)
                .then(if (tab.tag != null) Modifier.testTag(tab.tag) else Modifier)
                .selectable(
                    selected = selected,
                    role = Role.Tab,
                    onClick = { onSelect(tab.id) },
                )
            Surface(
                modifier = base,
                shape = MaterialTheme.shapes.large,
                color = if (selected) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = if (selected) MaterialTheme.colorScheme.onPrimaryContainer
                else MaterialTheme.colorScheme.onSurfaceVariant,
            ) {
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(tab.label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                    if (!tab.badge.isNullOrBlank()) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = if (selected) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outlineVariant,
                            contentColor = if (selected) MaterialTheme.colorScheme.onPrimary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        ) {
                            Text(
                                tab.badge,
                                Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
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
    Surface(
        modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (!subtitle.isNullOrBlank()) {
                        Text(
                            subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (action != null) Box(Modifier.padding(start = 8.dp)) { action() }
            }
            content()
        }
    }
}

@Composable
internal fun PanelInfoRow(label: String, value: String, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(
            label,
            Modifier.width(92.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SelectionContainer(Modifier.weight(1f)) {
            Text(
                value.ifBlank { "—" },
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = if (mono) FontFamily.Monospace else null,
            )
        }
    }
}

@Composable
internal fun PanelStatus(text: String, tone: PanelTone, modifier: Modifier = Modifier) {
    val colors = when (tone) {
        PanelTone.Accent -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        PanelTone.Success -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        PanelTone.Warning -> MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
        PanelTone.Danger -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        PanelTone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(modifier, shape = MaterialTheme.shapes.small, color = colors.first, contentColor = colors.second) {
        Text(
            text,
            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
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
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if (!message.isNullOrBlank()) {
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(actionLabel) }
        }
    }
}

@Composable
internal fun PanelError(message: String, onRetry: (() -> Unit)? = null) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            if (onRetry != null) {
                TextButton(
                    onClick = onRetry,
                    modifier = Modifier.heightIn(min = 48.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onErrorContainer),
                ) { Text("重试") }
            }
        }
    }
}

@Composable
internal fun PanelNotice(message: String, onDismiss: (() -> Unit)? = null) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            if (onDismiss != null) {
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.heightIn(min = 48.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onPrimaryContainer),
                ) { Text("知道了") }
            }
        }
    }
}

@Composable
internal fun PanelLoading(text: String = "正在读取…") {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = enabled,
                modifier = Modifier.heightIn(min = 48.dp),
                colors = ButtonDefaults.textButtonColors(
                    contentColor = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                ),
            ) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
        },
    )
}

@Composable
internal fun PanelDisclosure(
    title: String,
    initiallyExpanded: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    var expanded by rememberSaveable(title) { mutableStateOf(initiallyExpanded) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .selectable(selected = expanded, role = Role.Button, onClick = { expanded = !expanded })
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
            Text(
                if (expanded) "收起" else "展开",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
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
    if (text.isBlank()) {
        Text(emptyText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    var expanded by remember(text) { mutableStateOf(false) }
    val allLines = text.lines()
    val shown = if (expanded || allLines.size <= maxLines) text else allLines.take(maxLines).joinToString("\n")
    Surface(
        modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(Modifier.padding(vertical = 8.dp)) {
            SelectionContainer {
                Text(
                    shown,
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                )
            }
            if (allLines.size > maxLines) {
                TextButton(
                    onClick = { expanded = !expanded },
                    modifier = Modifier.heightIn(min = 48.dp).padding(start = 4.dp),
                ) {
                    Text(if (expanded) "收起差异" else "展开其余 ${allLines.size - maxLines} 行")
                }
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
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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
