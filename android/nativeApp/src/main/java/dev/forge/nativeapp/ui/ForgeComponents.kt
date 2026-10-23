package dev.forge.nativeapp.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * Compact, flat primitives shared by the native workbench.  The Web surface
 * draws almost everything as a 4/6/8/12px-radius rectangle with a hairline
 * border and a 28–36px control; stock Material components (48dp icon buttons,
 * 56dp filled text fields, elevated cards) are the main reason the first
 * native pass felt unrelated to it.  These helpers keep that vocabulary in one
 * place so the next screen cannot silently drift back to Material defaults.
 */

@Composable
fun ForgeIconButton(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    active: Boolean = false,
    size: Dp = ForgeDimens.controlLg,
    content: @Composable () -> Unit,
) {
    val palette = LocalForgePalette.current
    Box(
        modifier.size(size)
            .clip(RoundedCornerShape(ForgeDimens.radiusMd))
            .background(if (active) palette.selected else Color.Transparent)
            .clickable(
                enabled = enabled,
                role = Role.Button,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick,
            )
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

@Composable
fun ForgeTextAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
    tint: Color? = null,
    leading: (@Composable RowScope.() -> Unit)? = null,
) {
    val palette = LocalForgePalette.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(ForgeDimens.radiusSm),
        color = Color.Transparent,
        contentColor = when {
            !enabled -> palette.textMuted
            tint != null -> tint
            danger -> palette.error
            else -> palette.textSecondary
        },
        modifier = modifier.heightIn(min = ForgeDimens.control),
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            leading?.invoke(this)
            Text(label, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
fun ForgePrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
) {
    val palette = LocalForgePalette.current
    val container = when {
        !enabled -> palette.soft
        danger -> palette.error
        else -> palette.runBackground
    }
    val ink = when {
        !enabled -> palette.textMuted
        danger -> Color.White
        else -> palette.runInk
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(ForgeDimens.radiusMd),
        color = container,
        contentColor = ink,
        modifier = modifier.heightIn(min = ForgeDimens.controlLg),
    ) {
        Box(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(label, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
fun ForgeSecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
) {
    ForgeOutlineButton(onClick, modifier, enabled, danger) {
        Text(label, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
    }
}

/** Filled workbench button with the `Button {}` content shape. */
@Composable
fun ForgeButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(ForgeDimens.radiusMd),
        color = if (enabled) palette.runBackground else palette.soft,
        contentColor = if (enabled) palette.runInk else palette.textMuted,
        modifier = modifier.heightIn(min = ForgeDimens.controlLg),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

/** Hairline secondary button with the `OutlinedButton {}` content shape. */
@Composable
fun ForgeOutlineButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(ForgeDimens.radiusMd),
        color = Color.Transparent,
        contentColor = when {
            !enabled -> palette.textMuted
            danger -> palette.error
            else -> palette.textPrimary
        },
        border = BorderStroke(1.dp, if (enabled) palette.borderControl else palette.borderSubtle),
        modifier = modifier.heightIn(min = ForgeDimens.controlLg),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

/** Compact search field matching `.sidebar-search-input` / `.settings-search`. */
@Composable
fun ForgeSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "搜索…",
    contentDescription: String? = null,
    onClear: (() -> Unit)? = null,
    height: Dp = ForgeDimens.controlLg,
) {
    val palette = LocalForgePalette.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Row(
        modifier.fillMaxWidth().height(height)
            .clip(RoundedCornerShape(ForgeDimens.radiusMd))
            .background(if (focused) palette.elevated else palette.soft)
            .border(
                1.dp,
                when {
                    focused -> palette.borderControl
                    else -> Color.Transparent
                },
                RoundedCornerShape(ForgeDimens.radiusMd),
            )
            .padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(Icons.Default.Search, null, tint = palette.textMuted, modifier = Modifier.size(15.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) {
                Text(
                    placeholder,
                    color = palette.textMuted,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TextStyle(color = palette.textPrimary, fontSize = 12.5.sp, lineHeight = 17.sp),
                cursorBrush = SolidColor(palette.accent),
                interactionSource = interaction,
                modifier = Modifier.fillMaxWidth()
                    .then(
                        if (contentDescription != null) {
                            Modifier.semantics { this.contentDescription = contentDescription }
                        } else {
                            Modifier
                        },
                    ),
            )
        }
        if (value.isNotEmpty() && onClear != null) {
            ForgeIconButton(
                onClick = onClear,
                contentDescription = "清空搜索",
                size = 24.dp,
                modifier = Modifier,
            ) {
                Icon(Icons.Default.Close, null, tint = palette.textMuted, modifier = Modifier.size(13.dp))
            }
        }
    }
}

/**
 * Compact single-line / multi-line field used by settings, rename dialogs and
 * inspector filters.  It intentionally mirrors the common OutlinedTextField
 * parameters so screens can switch without rewriting their form logic, but it
 * renders a 38dp bordered box instead of Material's 56dp floating-label field.
 */
@Composable
fun ForgeTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    label: (@Composable () -> Unit)? = null,
    placeholder: (@Composable () -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    visualTransformation: androidx.compose.ui.text.input.VisualTransformation =
        androidx.compose.ui.text.input.VisualTransformation.None,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions =
        androidx.compose.foundation.text.KeyboardOptions.Default,
    keyboardActions: androidx.compose.foundation.text.KeyboardActions =
        androidx.compose.foundation.text.KeyboardActions.Default,
    textStyle: TextStyle? = null,
    interactionSource: MutableInteractionSource? = null,
) {
    val palette = LocalForgePalette.current
    val source = interactionSource ?: remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val border = when {
        isError -> palette.error
        focused -> palette.accent
        else -> palette.borderControl
    }
    Column(Modifier.fillMaxWidth()) {
        if (label != null) {
            androidx.compose.runtime.CompositionLocalProvider(
                LocalContentColor provides palette.textSecondary,
            ) {
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.labelMedium,
                ) {
                    Row(Modifier.padding(start = 2.dp, bottom = 4.dp)) { label() }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(ForgeDimens.radiusMd))
                .background(if (enabled) palette.elevated else palette.soft)
                .border(1.dp, border, RoundedCornerShape(ForgeDimens.radiusMd))
                .padding(horizontal = 10.dp, vertical = if (singleLine) 8.dp else 9.dp),
            verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
        ) {
            if (leadingIcon != null) {
                androidx.compose.runtime.CompositionLocalProvider(
                    LocalContentColor provides palette.textMuted,
                ) {
                    Box(Modifier.padding(end = 7.dp)) { leadingIcon() }
                }
            }
            Box(Modifier.weight(1f)) {
                if (value.isEmpty() && placeholder != null) {
                    androidx.compose.runtime.CompositionLocalProvider(
                        LocalContentColor provides palette.textMuted,
                    ) {
                        androidx.compose.runtime.CompositionLocalProvider(
                            androidx.compose.material3.LocalTextStyle provides TextStyle(
                                fontSize = 12.5.sp,
                                lineHeight = 19.sp,
                            ),
                        ) {
                            placeholder()
                        }
                    }
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    readOnly = readOnly,
                    singleLine = singleLine,
                    minLines = minLines,
                    maxLines = maxLines,
                    textStyle = textStyle ?: TextStyle(
                        color = if (enabled) palette.textPrimary else palette.textMuted,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                    ),
                    cursorBrush = SolidColor(palette.accent),
                    visualTransformation = visualTransformation,
                    keyboardOptions = keyboardOptions,
                    keyboardActions = keyboardActions,
                    interactionSource = source,
                    modifier = modifier.fillMaxWidth(),
                )
            }
            if (trailingIcon != null) {
                androidx.compose.runtime.CompositionLocalProvider(
                    LocalContentColor provides palette.textMuted,
                ) {
                    Box(Modifier.padding(start = 6.dp)) { trailingIcon() }
                }
            }
        }
        if (supportingText != null) {
            androidx.compose.runtime.CompositionLocalProvider(
                LocalContentColor provides if (isError) palette.error else palette.textMuted,
            ) {
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.labelSmall,
                ) {
                    Row(Modifier.padding(start = 2.dp, top = 4.dp)) { supportingText() }
                }
            }
        }
    }
}

/** Flat settings/execution card: soft header strip + hairline border, no tonal elevation. */@Composable
fun ForgeSectionCard(
    title: String? = null,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    action: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    Column(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(ForgeDimens.radiusCard))
            .background(palette.elevated)
            .border(1.dp, palette.borderSubtle, RoundedCornerShape(ForgeDimens.radiusCard)),
    ) {
        if (title != null) {
            Row(
                Modifier.fillMaxWidth().background(palette.soft)
                    .padding(start = 16.dp, end = 10.dp, top = 11.dp, bottom = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        title,
                        color = palette.textPrimary,
                        fontSize = 14.sp,
                        lineHeight = 19.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (!subtitle.isNullOrBlank()) {
                        Text(
                            subtitle,
                            color = palette.textSecondary,
                            fontSize = 11.5.sp,
                            lineHeight = 17.sp,
                        )
                    }
                }
                action?.invoke(this)
            }
        }
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            content()
        }
    }
}

@Composable
fun ForgePill(
    text: String,
    modifier: Modifier = Modifier,
    tone: PanelTone = PanelTone.Neutral,
    dot: Boolean = false,
) {
    val palette = LocalForgePalette.current
    val (container, ink) = when (tone) {
        PanelTone.Accent -> palette.accentSoft to palette.accent
        PanelTone.Success -> palette.successBackground to palette.success
        PanelTone.Warning -> palette.warningBackground to palette.warning
        PanelTone.Danger -> palette.errorBackground to palette.error
        PanelTone.Neutral -> palette.soft to palette.textSecondary
    }
    Row(
        modifier.clip(CircleShape).background(container)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (dot) Box(Modifier.size(5.dp).clip(CircleShape).background(ink))
        Text(text, color = ink, fontSize = 10.5.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

/** Popup menu with the workbench's hairline card instead of Material's tonal menu. */
@Composable
fun ForgeMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier.widthIn(min = 180.dp, max = 320.dp),
        shape = RoundedCornerShape(10.dp),
        containerColor = palette.elevated,
        tonalElevation = 0.dp,
        shadowElevation = 10.dp,
        border = BorderStroke(1.dp, palette.borderSubtle),
    ) {
        content()
    }
}

@Composable
fun ForgeMenuItem(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    selected: Boolean = false,
    danger: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    val palette = LocalForgePalette.current
    DropdownMenuItem(
        text = {
            Column {
                Text(
                    text,
                    color = if (danger) palette.error else palette.textPrimary,
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, color = palette.textMuted, fontSize = 10.5.sp, lineHeight = 15.sp)
                }
            }
        },
        onClick = onClick,
        modifier = modifier,
        trailingIcon = trailing,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
    )
    if (selected) {
        // Selection is carried by the accent check in `trailing`; keeping this
        // branch empty documents intent without a second background layer.
    }
}

/**
 * Native dialog shell with the same 14px card language as the workbench.
 * `usePlatformDefaultWidth = false` lets the width cap survive tablets.
 */
@Composable
fun ForgeDialog(
    onDismissRequest: () -> Unit,
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalForgePalette.current
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = modifier.widthIn(max = 420.dp).fillMaxWidth().padding(horizontal = 20.dp),
            shape = RoundedCornerShape(ForgeDimens.radiusLg),
            color = palette.elevated,
            contentColor = palette.textPrimary,
            border = BorderStroke(1.dp, palette.borderSubtle),
            shadowElevation = 16.dp,
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        title,
                        color = palette.textPrimary,
                        fontSize = 16.sp,
                        lineHeight = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (!subtitle.isNullOrBlank()) {
                        Text(subtitle, color = palette.textSecondary, fontSize = 11.5.sp, lineHeight = 17.sp)
                    }
                }
                content()
                Row(
                    Modifier.fillMaxWidth().padding(top = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    content = actions,
                )
            }
        }
    }
}

/** A quiet dot + label used for connection/run status in footers and headers. */
@Composable
fun ForgeStatusLine(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    trailing: String? = null,
) {
    val palette = LocalForgePalette.current
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Text(
            label,
            color = palette.textSecondary,
            fontSize = 10.5.sp,
            lineHeight = 15.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (!trailing.isNullOrBlank()) {
            Spacer(Modifier.width(2.dp))
            Text(trailing, color = palette.textMuted, fontSize = 10.sp, lineHeight = 14.sp)
        }
    }
}

/** Inline error/notice strip with the 1px border used across the Web panels. */
@Composable
fun ForgeNotice(
    text: String,
    modifier: Modifier = Modifier,
    tone: PanelTone = PanelTone.Warning,
    action: (@Composable RowScope.() -> Unit)? = null,
) {
    val palette = LocalForgePalette.current
    val (container, ink, border) = when (tone) {
        PanelTone.Danger -> Triple(palette.errorBackground, palette.error, palette.errorBorder)
        PanelTone.Success -> Triple(palette.successBackground, palette.success, palette.success.copy(alpha = 0.35f))
        PanelTone.Accent -> Triple(palette.accentSoft, palette.accent, palette.accent.copy(alpha = 0.35f))
        PanelTone.Warning -> Triple(palette.warningBackground, palette.warning, palette.warningBorder)
        PanelTone.Neutral -> Triple(palette.soft, palette.textSecondary, palette.borderSubtle)
    }
    Row(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(ForgeDimens.radiusMd))
            .background(container)
            .border(1.dp, border, RoundedCornerShape(ForgeDimens.radiusMd))
            .padding(start = 11.dp, end = 6.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(text, Modifier.weight(1f), color = ink, fontSize = 11.5.sp, lineHeight = 17.sp)
        action?.invoke(this)
    }
}

@Composable
fun ForgeCodeText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = LocalForgePalette.current.textPrimary,
    fontSize: androidx.compose.ui.unit.TextUnit = 11.5.sp,
    lineHeight: androidx.compose.ui.unit.TextUnit = 18.sp,
) {
    Text(
        text,
        modifier = modifier,
        color = color,
        fontFamily = ForgeMonoFamily,
        fontSize = fontSize,
        lineHeight = lineHeight,
    )
}

@Composable
fun ForgeLabel(text: String, modifier: Modifier = Modifier, muted: Boolean = true) {
    val palette = LocalForgePalette.current
    Text(
        text,
        modifier = modifier,
        color = if (muted) palette.textMuted else palette.textPrimary,
        fontSize = 10.5.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.1.sp,
    )
}

/** Shared content column width; keeps reading and settings surfaces aligned. */
@Composable
fun ForgeContentWidth(
    modifier: Modifier = Modifier,
    maxWidth: Dp = ForgeDimens.readingMeasure,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().widthIn(max = maxWidth), content = content)
}

@Composable
internal fun MutedText(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        color = LocalForgePalette.current.textMuted,
        fontSize = 11.sp,
        lineHeight = 16.sp,
    )
}

@Composable
internal fun ForgeMenuDivider() {
    Spacer(
        Modifier.fillMaxWidth().height(1.dp).background(LocalForgePalette.current.borderSubtle),
    )
}

@Composable
internal fun ForgeDot(color: Color, size: Dp = 6.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(color))
}
