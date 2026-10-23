package dev.forge.nativeapp.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.forge.nativeapp.ChatActions
import dev.forge.nativeapp.ChatUiState
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

@Composable
fun ForgeUsage(
    state: ChatUiState,
    actions: ChatActions,
    onClose: () -> Unit,
) {
    val connected = state.isConnected()
    val raw = state.workbench.values["usage"]
    val usage = remember(raw) {
        parseSectionObject(raw, "usage", "stats")
    }
    val loading = state.panelLoading("usage")
    val error = state.panelError("usage")

    LaunchedEffect(connected) {
        if (connected) actions.loadPanel("usage")
    }

    Column(Modifier.fillMaxSize().testTag("usage-page")) {
        PanelHeader(
            title = "用量",
            onClose = onClose,
            subtitle = "来自 Core 的真实用量统计；价格未知时不会显示为免费。",
            trailing = {
                TextButton(
                    onClick = { actions.loadPanel("usage") },
                    enabled = connected && !loading,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(4.dp))
                    Text("刷新")
                }
            },
        )
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 1040.dp).fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                val notice = state.workbench.notice
                if (!notice.isNullOrBlank()) {
                    PanelNotice(notice, onDismiss = actions::dismissPanelNotice)
                }
                if (!connected) {
                    PanelNotice("连接 Core 后才能读取用量统计。")
                }
                if (error != null) {
                    PanelError(error, onRetry = { actions.loadPanel("usage") })
                }
                if (loading && usage == null) {
                    PanelLoading("正在读取用量统计…")
                }
                if (usage == null) {
                    if (!loading && error == null) {
                        PanelEmpty(
                            title = "尚未读取用量",
                            message = if (connected) "Core 还没有返回统计，或统计服务不可用。" else "连接 Core 后重试。",
                            actionLabel = if (connected) "读取用量" else null,
                            onAction = if (connected) ({ actions.loadPanel("usage") }) else null,
                        )
                    }
                    return@Column
                }
                UsageContent(usage, connected)
            }
        }
    }
}

@Composable
private fun UsageContent(usage: JSONObject, connected: Boolean) {
    val totalTokens = usage.optLong("totalTokens").toLong()
    val prompt = usage.optLong("totalPromptTokens").toLong()
    val completion = usage.optLong("totalCompletionTokens").toLong()
    val cached = usage.optLong("totalCachedTokens").toLong()
    val runs = usage.optLong("totalRuns").toLong()
    val sessions = usage.optLong("totalSessions").toLong()
    val cacheRate = usage.optDouble("averageCacheRate", 0.0)
    val models = remember(usage.toString()) { usage.optObjects("models") }
    val daily = remember(usage.toString()) {
        usage.optObjects("daily").sortedBy { it.optText("date") }
    }
    val topSessions = remember(usage.toString()) { usage.optObjects("topSessions") }
    val pricing = usage.optJSONObject("pricing")
    val priced = models.mapNotNull(::modelCost)
    val estimatedTotal = priced.sum()
    val hasAnyPrice = priced.isNotEmpty()
    val missingPrice = models.size > priced.size

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= 760.dp) 3 else 2
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(
                UsageMetric("总 Tokens", formatCount(totalTokens), "输入 + 输出 + 缓存"),
                UsageMetric("输入 Tokens", formatCount(prompt), "Prompt tokens"),
                UsageMetric("输出 Tokens", formatCount(completion), "Completion tokens"),
                UsageMetric("缓存 Tokens", formatCount(cached), formatPercent(cacheRate) + " 缓存率"),
                UsageMetric("运行次数", formatCount(runs), "已结算运行"),
                UsageMetric("会话数", formatCount(sessions), "有统计的会话"),
            ).chunked(columns).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { metric ->
                        Surface(
                            Modifier.weight(1f),
                            shape = MaterialTheme.shapes.large,
                            color = MaterialTheme.colorScheme.surface,
                            tonalElevation = 1.dp,
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(metric.label, style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(metric.value, style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.SemiBold)
                                Text(metric.caption, style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    repeat(columns - row.size) {
                        Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }

    PanelSection(
        title = "估算费用",
        subtitle = "价格来自 Core 公开价格状态；缺失单价不等于 $0。",
    ) {
        when {
            !hasAnyPrice -> Text(
                "价格未知。Core 没有返回可用的估算单价，不能把缺失价格显示为免费。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            else -> {
                Text(
                    formatUsd(estimatedTotal) + if (missingPrice) "（部分模型价格未知，未计入）" else "",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "按 Core 返回的估算单价汇总，不代表实际账单。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        val pricingState = pricing?.optText("state").orEmpty()
        if (pricingState.isNotBlank()) {
            PanelInfoRow(
                "价格状态",
                when (pricingState) {
                    "ready" -> "可用"
                    "stale" -> "缓存价格（可能过期）"
                    "unavailable" -> "不可用"
                    else -> pricingState
                },
            )
            if (pricing?.optText("fetchedAt").orEmpty().isNotBlank()) {
                PanelInfoRow("价格更新时间", formatTimestamp(pricing?.optText("fetchedAt").orEmpty()))
            }
        } else {
            Text("Core 未提供价格状态；只显示已知估算。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    PanelSection(
        title = "每日趋势",
        subtitle = if (daily.isEmpty()) "Core 没有返回按日聚合。" else "按日总 tokens；横轴为日期，柱高相对当日最大值。",
    ) {
        if (daily.isEmpty()) {
            PanelEmpty(title = "暂无每日趋势", message = "完成一次运行后，daily 数组会显示在这里。")
        } else {
            DailyChart(daily)
            val costRows = daily.mapNotNull(::dailyCost)
            val totalDailyCost = costRows.sum()
            Text(
                if (costRows.isEmpty()) "每日费用：价格未知"
                else "每日费用估算 ${formatUsd(totalDailyCost)}" +
                    if (costRows.size < daily.size) "（部分日期价格未知）" else "",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (daily.isNotEmpty()) {
        PanelSection(title = "每日用量", subtitle = "最多显示最近 14 天。") {
            daily.takeLast(14).reversed().forEach { day ->
                DailyRow(day)
                PanelDivider()
            }
        }
    }

    PanelSection(
        title = "模型用量 · ${models.size}",
        subtitle = if (models.isEmpty()) "没有模型统计。" else "按 Core 的 models 数组展示；未定价模型显示“价格未知”。",
    ) {
        if (models.isEmpty()) {
            PanelEmpty(title = "暂无模型统计", message = "还没有可归因到模型的已结算用量。")
        } else {
            models.forEachIndexed { index, model ->
                ModelRow(model)
                if (index != models.lastIndex) PanelDivider()
            }
        }
    }

    PanelSection(
        title = "用量最高的会话 · ${topSessions.size}",
        subtitle = "来自 Core 的 topSessions；不依赖父页面的完整历史下载。",
    ) {
        if (topSessions.isEmpty()) {
            PanelEmpty(title = "暂无会话用量", message = "完成运行并产生 token 后，这里会显示会话排行。")
        } else {
            topSessions.forEachIndexed { index, session ->
                SessionUsageRow(session, index + 1)
                if (index != topSessions.lastIndex) PanelDivider()
            }
        }
    }

    if (!connected) {
        Text("数据为上次连接时读取；连接状态以下载时的 Core 为准。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private data class UsageMetric(val label: String, val value: String, val caption: String)

@Composable
private fun DailyChart(daily: List<JSONObject>) {
    val values = daily.map { it.optLong("totalTokens").toLong().coerceAtLeast(0) }
    val max = values.maxOrNull()?.coerceAtLeast(1L) ?: 1L
    val outline = MaterialTheme.colorScheme.outlineVariant
    val bar = MaterialTheme.colorScheme.primary
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.fillMaxWidth().height(150.dp)) {
            val height = size.height
            val width = size.width
            drawLine(outline, Offset(0f, height - 1f), Offset(width, height - 1f), strokeWidth = 2f)
            val gap = 4.dp.toPx()
            val barWidth = if (values.isEmpty()) 0f
            else ((width - gap * (values.size - 1).coerceAtLeast(0)) / values.size).coerceAtLeast(2f)
            values.forEachIndexed { index, value ->
                val fraction = value.toFloat() / max.toFloat()
                val barHeight = (height - 8f) * fraction
                drawRect(
                    color = bar,
                    topLeft = Offset(index * (barWidth + gap), height - barHeight - 2f),
                    size = Size(barWidth, barHeight.coerceAtLeast(if (value > 0) 2f else 0f)),
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(daily.firstOrNull()?.optText("date") ?: "", style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("峰值 ${formatCount(max)}", style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(daily.lastOrNull()?.optText("date") ?: "", style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DailyRow(day: JSONObject) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(day.optText("date").ifBlank { "—" }, Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(formatCount(day.optLong("totalTokens").toLong()), style = MaterialTheme.typography.labelLarge)
        }
        Text(
            "输入 ${formatCount(day.optLong("promptTokens").toLong())} · " +
                "输出 ${formatCount(day.optLong("completionTokens").toLong())} · " +
                "缓存 ${formatCount(day.optLong("cachedTokens").toLong())} · " +
                "运行 ${formatCount(day.optLong("runCount").toLong())}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            dailyCost(day)?.let { formatUsd(it) }
                ?: "价格未知" + if (day.optBoolean("costIncomplete")) "（估算不完整）" else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ModelRow(model: JSONObject) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            model.optText("model").ifBlank { "未知模型" },
            style = MaterialTheme.typography.titleSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            "${formatCount(model.optLong("totalTokens").toLong())} tokens · " +
                "输入 ${formatCount(model.optLong("promptTokens").toLong())} · " +
                "输出 ${formatCount(model.optLong("completionTokens").toLong())}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "缓存 ${formatCount(model.optLong("cachedTokens").toLong())} · " +
                "运行 ${formatCount(model.optLong("runCount").toLong())} · " +
                "会话 ${formatCount(model.optLong("sessionCount").toLong())}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val cost = modelCost(model)
        Text(
            if (cost == null) "价格未知" else formatUsd(cost) +
                if (model.optBoolean("costIncomplete")) "（估算不完整）" else "",
            style = MaterialTheme.typography.labelSmall,
            color = if (cost == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun SessionUsageRow(session: JSONObject, rank: Int) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Text("$rank", Modifier.width(26.dp), style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary)
            Text(
                session.optText("title").ifBlank { session.optText("sessionId") },
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(formatCount(session.optLong("totalTokens").toLong()),
                style = MaterialTheme.typography.labelLarge)
        }
        Text(
            session.optText("model").ifBlank { "模型未知" },
            Modifier.padding(start = 26.dp),
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            "运行 ${formatCount(session.optLong("runCount").toLong())} · " +
                "更新 ${formatTimestamp(session.optText("updatedAt"))}",
            Modifier.padding(start = 26.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (session.optText("workspace").isNotBlank()) {
            Text(
                session.optText("workspace"),
                Modifier.padding(start = 26.dp),
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private fun modelCost(model: JSONObject): Double? {
    if (model.has("estimatedCostUsd") && !model.isNull("estimatedCostUsd")) {
        val value = model.optDouble("estimatedCostUsd", Double.NaN)
        return value.takeIf { it.isFinite() && it >= 0.0 }
    }
    if (model.has("aggregateEstimatedCostUsd") && !model.isNull("aggregateEstimatedCostUsd")) {
        val value = model.optDouble("aggregateEstimatedCostUsd", Double.NaN)
        return value.takeIf { it.isFinite() && it >= 0.0 }
    }
    return null
}

private fun dailyCost(day: JSONObject): Double? {
    val value = when {
        day.has("estimatedCostUsd") && !day.isNull("estimatedCostUsd") ->
            day.optDouble("estimatedCostUsd", Double.NaN)
        day.has("aggregateEstimatedCostUsd") && !day.isNull("aggregateEstimatedCostUsd") ->
            day.optDouble("aggregateEstimatedCostUsd", Double.NaN)
        else -> Double.NaN
    }
    return value.takeIf { it.isFinite() && it >= 0.0 }
}

private fun formatUsd(value: Double?): String {
    if (value == null || !value.isFinite()) return "价格未知"
    if (value == 0.0) return "\$0.00"
    if (value >= 0.01) return String.format(Locale.US, "\$%.2f", value)
    if (value >= 0.0001) return String.format(Locale.US, "\$%.4f", value)
    return "<\$0.0001"
}
