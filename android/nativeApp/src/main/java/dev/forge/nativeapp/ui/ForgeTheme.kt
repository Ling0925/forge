package dev.forge.nativeapp.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.forge.nativeapp.R

/**
 * The warm neutral palette from the current Forge workspace theme.  MaterialTheme
 * slots are derived from this palette, but panels that need a surface/ink pair
 * which has no exact Material slot can read [LocalForgePalette] directly.
 */
@Immutable
data class ForgePalette(
    val canvas: Color,
    val sidebar: Color,
    val shell: Color,
    val elevated: Color,
    val soft: Color,
    val hover: Color,
    val active: Color,
    val selected: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val borderSubtle: Color,
    val borderControl: Color,
    val borderHover: Color,
    val accent: Color,
    val accentSoft: Color,
    val focus: Color,
    val link: Color,
    val runBackground: Color,
    val runInk: Color,
    val runHover: Color,
    val runActive: Color,
    val success: Color,
    val successBackground: Color,
    val warning: Color,
    val warningBackground: Color,
    val warningBorder: Color,
    val error: Color,
    val errorBackground: Color,
    val errorBorder: Color,
)

val ForgeLightPalette = ForgePalette(
    canvas = Color(0xFFFAF9F6),
    sidebar = Color(0xFFF2F1ED),
    shell = Color(0xFFEAE9E4),
    elevated = Color(0xFFFFFFFF),
    soft = Color(0xFFF0EFEB),
    hover = Color(0xFFE8E6E0),
    active = Color(0xFFDEDBD3),
    selected = Color(0xFFE6E3DC),
    textPrimary = Color(0xFF292824),
    textSecondary = Color(0xFF68665F),
    textMuted = Color(0xFF716E66),
    borderSubtle = Color(0xFFE5E3DC),
    borderControl = Color(0xFFD1CEC5),
    borderHover = Color(0xFFABA69A),
    accent = Color(0xFFA54F35),
    accentSoft = Color(0xFFF3E6DF),
    focus = Color(0xFFA54F35),
    link = Color(0xFFA54F35),
    runBackground = Color(0xFF35332E),
    runInk = Color(0xFFFFFFFF),
    runHover = Color(0xFF49463F),
    runActive = Color(0xFF24221E),
    success = Color(0xFF226D40),
    successBackground = Color(0xFFEDF7EF),
    warning = Color(0xFF975A06),
    warningBackground = Color(0xFFFEF7E9),
    warningBorder = Color(0xFFFEDF89),
    error = Color(0xFFB82420),
    errorBackground = Color(0xFFFEF3F2),
    errorBorder = Color(0xFFFECDCA),
)

val ForgeDarkPalette = ForgePalette(
    canvas = Color(0xFF171716),
    sidebar = Color(0xFF121211),
    shell = Color(0xFF191918),
    elevated = Color(0xFF222221),
    soft = Color(0xFF252524),
    hover = Color(0xFF30302E),
    active = Color(0xFF3A3936),
    selected = Color(0xFF343330),
    textPrimary = Color(0xFFEEEDE8),
    textSecondary = Color(0xFFAAA79F),
    textMuted = Color(0xFFAAA79F),
    borderSubtle = Color(0xFF2B2B28),
    borderControl = Color(0xFF3D3C37),
    borderHover = Color(0xFF706D64),
    accent = Color(0xFFDC9477),
    accentSoft = Color(0xFF3B2B24),
    focus = Color(0xFFDC9477),
    link = Color(0xFFDC9477),
    runBackground = Color(0xFFE9E6DE),
    runInk = Color(0xFF242320),
    runHover = Color(0xFFFFFFFF),
    runActive = Color(0xFFD4D0C5),
    success = Color(0xFF7ED99E),
    successBackground = Color(0xFF152C1E),
    warning = Color(0xFFF0BE65),
    warningBackground = Color(0xFF332510),
    warningBorder = Color(0xFF5E451B),
    error = Color(0xFFFF8F85),
    errorBackground = Color(0xFF351A18),
    errorBorder = Color(0xFF5E2B27),
)

val LocalForgePalette = staticCompositionLocalOf { ForgeLightPalette }

/**
 * The Web workbench ships Geist for UI and prose plus Geist Mono for code.
 * Falling back to the platform sans was the biggest reason the native shell
 * read as a different product.  These static faces cover Latin/Greek/Cyrillic;
 * CJK still falls back to the platform's Noto/PingFang, exactly like the
 * desktop font stack.
 */
val ForgeSansFamily: FontFamily = FontFamily(
    Font(R.font.geist_regular, FontWeight.Normal, FontStyle.Normal),
    Font(R.font.geist_medium, FontWeight.Medium, FontStyle.Normal),
    Font(R.font.geist_semibold, FontWeight.SemiBold, FontStyle.Normal),
)

val ForgeMonoFamily: FontFamily = FontFamily(
    Font(R.font.geist_mono_regular, FontWeight.Normal, FontStyle.Normal),
)

val ForgeSerifFamily: FontFamily = FontFamily.Serif

/**
 * Spacing and control metrics shared by every screen.  Values mirror
 * `styles/tokens.css` and `workbench-header.css`: a row that is 32px on the Web
 * workbench is 32dp here, not Material's 48dp default.
 */
object ForgeDimens {
    val hairline = 1.dp
    val controlSm = 28.dp
    val control = 32.dp
    val controlLg = 36.dp
    val touch = 44.dp
    val headerWide = 44.dp
    val headerCompact = 56.dp
    val readingMeasure = 760.dp
    val settingsMeasure = 820.dp
    val railWidth = 264.dp
    val radiusXs = 4.dp
    val radiusSm = 6.dp
    val radiusMd = 8.dp
    val radiusCard = 12.dp
    val radiusLg = 14.dp
    val radiusComposer = 18.dp
}

/** The small serif italic `f.` wordmark used by the home greeting and rail. */
val ForgeWordmarkStyle = TextStyle(
    fontFamily = ForgeSerifFamily,
    fontStyle = FontStyle.Italic,
    fontWeight = FontWeight.Medium,
    fontSize = 22.sp,
    lineHeight = 30.sp,
    letterSpacing = (-0.2).sp,
)

private val ForgeTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 40.sp,
        lineHeight = 48.sp,
        letterSpacing = (-0.5).sp,
    ),
    displayMedium = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 34.sp,
        lineHeight = 42.sp,
    ),
    displaySmall = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 28.sp,
        lineHeight = 36.sp,
    ),
    headlineLarge = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        letterSpacing = (-0.35).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.3).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 19.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.2).sp,
    ),
    titleLarge = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.2).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.5.sp,
        lineHeight = 21.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 20.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 22.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 11.5.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        lineHeight = 20.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 11.5.sp,
        lineHeight = 16.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = ForgeSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 10.5.sp,
        lineHeight = 15.sp,
    ),
)

private val ForgeShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(4.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
)

private fun forgeColorScheme(palette: ForgePalette, dark: Boolean) = if (dark) {
    darkColorScheme(
        primary = palette.accent,
        onPrimary = Color(0xFF242320),
        primaryContainer = palette.accentSoft,
        onPrimaryContainer = palette.accent,
        secondary = palette.textSecondary,
        onSecondary = Color(0xFF171716),
        secondaryContainer = palette.soft,
        onSecondaryContainer = palette.textPrimary,
        tertiary = palette.warning,
        onTertiary = Color(0xFF332510),
        tertiaryContainer = palette.warningBackground,
        onTertiaryContainer = palette.warning,
        background = palette.canvas,
        onBackground = palette.textPrimary,
        surface = palette.canvas,
        onSurface = palette.textPrimary,
        surfaceVariant = palette.soft,
        onSurfaceVariant = palette.textSecondary,
        surfaceTint = palette.accent,
        inverseSurface = palette.runBackground,
        inverseOnSurface = palette.runInk,
        error = palette.error,
        onError = Color(0xFF351A18),
        errorContainer = palette.errorBackground,
        onErrorContainer = palette.error,
        outline = palette.borderControl,
        outlineVariant = palette.borderSubtle,
        scrim = Color.Black,
        surfaceBright = palette.elevated,
        surfaceDim = palette.shell,
        surfaceContainer = palette.elevated,
        surfaceContainerHigh = palette.soft,
        surfaceContainerHighest = palette.soft,
        surfaceContainerLow = palette.shell,
        surfaceContainerLowest = palette.canvas,
    )
} else {
    lightColorScheme(
        primary = palette.accent,
        onPrimary = Color.White,
        primaryContainer = palette.accentSoft,
        onPrimaryContainer = palette.accent,
        secondary = palette.textSecondary,
        onSecondary = Color.White,
        secondaryContainer = palette.soft,
        onSecondaryContainer = palette.textPrimary,
        tertiary = palette.warning,
        onTertiary = Color.White,
        tertiaryContainer = palette.warningBackground,
        onTertiaryContainer = palette.warning,
        background = palette.canvas,
        onBackground = palette.textPrimary,
        surface = palette.canvas,
        onSurface = palette.textPrimary,
        surfaceVariant = palette.soft,
        onSurfaceVariant = palette.textSecondary,
        surfaceTint = palette.accent,
        inverseSurface = palette.runBackground,
        inverseOnSurface = palette.runInk,
        error = palette.error,
        onError = Color.White,
        errorContainer = palette.errorBackground,
        onErrorContainer = palette.error,
        outline = palette.borderControl,
        outlineVariant = palette.borderSubtle,
        scrim = Color.Black,
        surfaceBright = palette.elevated,
        surfaceDim = palette.shell,
        surfaceContainer = palette.elevated,
        surfaceContainerHigh = palette.soft,
        surfaceContainerHighest = palette.soft,
        surfaceContainerLow = palette.shell,
        surfaceContainerLowest = palette.canvas,
    )
}

@Composable
fun ForgeTheme(themeMode: String = "system", content: @Composable () -> Unit) {
    val dark = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    val palette = if (dark) ForgeDarkPalette else ForgeLightPalette
    CompositionLocalProvider(LocalForgePalette provides palette) {
        MaterialTheme(
            colorScheme = forgeColorScheme(palette, dark),
            typography = ForgeTypography,
            shapes = ForgeShapes,
            content = content,
        )
    }
}

/* Quiet line glyphs for the handful of marks absent from material-icons-core. */

private fun DrawScope.lineStroke() = Stroke(
    width = 1.5.dp.toPx(),
    cap = StrokeCap.Round,
    join = StrokeJoin.Round,
)

@Composable
internal fun FolderGlyph(
    open: Boolean = false,
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        if (open) {
            val path = Path().apply {
                moveTo(0.13f * s, 0.30f * s)
                lineTo(0.40f * s, 0.30f * s)
                lineTo(0.48f * s, 0.40f * s)
                lineTo(0.84f * s, 0.40f * s)
                lineTo(0.76f * s, 0.72f * s)
                lineTo(0.15f * s, 0.72f * s)
                close()
            }
            drawPath(path, tint, style = stroke)
        } else {
            drawRoundRect(
                color = tint,
                topLeft = Offset(0.13f * s, 0.28f * s),
                size = Size(0.74f * s, 0.48f * s),
                cornerRadius = CornerRadius(0.08f * s),
                style = stroke,
            )
            drawLine(tint, Offset(0.13f * s, 0.39f * s), Offset(0.45f * s, 0.39f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        }
    }
}

@Composable
internal fun ArchiveGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        drawRoundRect(
            color = tint,
            topLeft = Offset(0.16f * s, 0.20f * s),
            size = Size(0.68f * s, 0.15f * s),
            cornerRadius = CornerRadius(0.03f * s),
            style = stroke,
        )
        drawRoundRect(
            color = tint,
            topLeft = Offset(0.20f * s, 0.35f * s),
            size = Size(0.60f * s, 0.45f * s),
            cornerRadius = CornerRadius(0.05f * s),
            style = stroke,
        )
        drawLine(tint, Offset(0.50f * s, 0.48f * s), Offset(0.50f * s, 0.65f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.41f * s, 0.58f * s), Offset(0.50f * s, 0.67f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.59f * s, 0.58f * s), Offset(0.50f * s, 0.67f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
    }
}

@Composable
internal fun UsageGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        drawLine(tint, Offset(0.16f * s, 0.80f * s), Offset(0.84f * s, 0.80f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.26f * s, 0.80f * s), Offset(0.26f * s, 0.58f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.50f * s, 0.80f * s), Offset(0.50f * s, 0.36f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.74f * s, 0.80f * s), Offset(0.74f * s, 0.48f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
    }
}

@Composable
internal fun ForkGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        val r = 0.07f * s
        drawCircle(tint, r, Offset(0.25f * s, 0.50f * s), style = stroke)
        drawCircle(tint, r, Offset(0.72f * s, 0.27f * s), style = stroke)
        drawCircle(tint, r, Offset(0.72f * s, 0.73f * s), style = stroke)
        val path = Path().apply {
            moveTo(0.32f * s, 0.50f * s)
            cubicTo(0.48f * s, 0.50f * s, 0.52f * s, 0.27f * s, 0.65f * s, 0.27f * s)
            moveTo(0.32f * s, 0.50f * s)
            cubicTo(0.48f * s, 0.50f * s, 0.52f * s, 0.73f * s, 0.65f * s, 0.73f * s)
        }
        drawPath(path, tint, style = stroke)
    }
}

@Composable
internal fun ImageGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        drawRoundRect(
            color = tint,
            topLeft = Offset(0.16f * s, 0.20f * s),
            size = Size(0.68f * s, 0.60f * s),
            cornerRadius = CornerRadius(0.08f * s),
            style = stroke,
        )
        drawCircle(tint, 0.055f * s, Offset(0.36f * s, 0.38f * s), style = stroke)
        val path = Path().apply {
            moveTo(0.20f * s, 0.70f * s)
            lineTo(0.41f * s, 0.50f * s)
            lineTo(0.55f * s, 0.63f * s)
            lineTo(0.65f * s, 0.54f * s)
            lineTo(0.79f * s, 0.70f * s)
        }
        drawPath(path, tint, style = stroke)
    }
}

@Composable
internal fun StopGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        drawRoundRect(
            color = tint,
            topLeft = Offset(0.30f * s, 0.30f * s),
            size = Size(0.40f * s, 0.40f * s),
            cornerRadius = CornerRadius(0.06f * s),
        )
    }
}

@Composable
internal fun DetailsGlyph(
    collapsed: Boolean,
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        drawRoundRect(
            color = tint,
            topLeft = Offset(0.15f * s, 0.20f * s),
            size = Size(0.70f * s, 0.60f * s),
            cornerRadius = CornerRadius(0.07f * s),
            style = stroke,
        )
        drawLine(
            tint,
            Offset(if (collapsed) 0.58f * s else 0.62f * s, 0.20f * s),
            Offset(if (collapsed) 0.58f * s else 0.62f * s, 0.80f * s),
            strokeWidth = stroke.width,
        )
    }
}

@Composable
internal fun SteerGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        drawLine(tint, Offset(0.18f * s, 0.72f * s), Offset(0.76f * s, 0.25f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.52f * s, 0.24f * s), Offset(0.78f * s, 0.24f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.77f * s, 0.23f * s), Offset(0.77f * s, 0.49f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(tint, Offset(0.18f * s, 0.82f * s), Offset(0.48f * s, 0.82f * s), strokeWidth = stroke.width, cap = StrokeCap.Round)
    }
}

@Composable
internal fun QueueGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        listOf(0.30f, 0.50f, 0.70f).forEachIndexed { index, y ->
            drawCircle(tint, 0.035f * s, Offset(0.22f * s, y * s))
            drawLine(
                tint,
                Offset(0.36f * s, y * s),
                Offset(if (index == 1) 0.70f * s else 0.78f * s, y * s),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
internal fun PlanGlyph(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val stroke = lineStroke()
        drawCircle(tint, 0.30f * s, Offset(0.50f * s, 0.50f * s), style = stroke)
        val path = Path().apply {
            moveTo(0.62f * s, 0.30f * s)
            lineTo(0.50f * s, 0.53f * s)
            lineTo(0.38f * s, 0.70f * s)
            lineTo(0.50f * s, 0.47f * s)
            close()
        }
        drawPath(path, tint, style = stroke)
    }
}
