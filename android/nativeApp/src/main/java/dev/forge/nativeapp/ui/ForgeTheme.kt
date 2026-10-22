package dev.forge.nativeapp.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(
    primary = Color(0xFF047857), onPrimary = Color.White,
    primaryContainer = Color(0xFFECFDF5), onPrimaryContainer = Color(0xFF065F46),
    background = Color(0xFFFFFFFF), onBackground = Color(0xFF111827),
    surface = Color(0xFFF8F9FA), onSurface = Color(0xFF111827),
    surfaceVariant = Color(0xFFF1F3F5), onSurfaceVariant = Color(0xFF4B5563),
    outlineVariant = Color(0xFFE5E7EB),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF34D399), onPrimary = Color(0xFF052E23),
    primaryContainer = Color(0xFF064E3B), onPrimaryContainer = Color(0xFFA7F3D0),
    background = Color(0xFF0D1117), onBackground = Color(0xFFF0F6FC),
    surface = Color(0xFF161B22), onSurface = Color(0xFFF0F6FC),
    surfaceVariant = Color(0xFF21262D), onSurfaceVariant = Color(0xFFADB7C2),
    outlineVariant = Color(0xFF30363D),
)

@Composable
fun ForgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
