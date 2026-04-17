package com.magichat.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF0E4B5A),
    onPrimary = Color(0xFFF7F4EB),
    primaryContainer = Color(0xFFC8E6EA),
    onPrimaryContainer = Color(0xFF082129),
    secondary = Color(0xFF7A4A1B),
    onSecondary = Color(0xFFFFF7F2),
    secondaryContainer = Color(0xFFF6DFC7),
    onSecondaryContainer = Color(0xFF311707),
    tertiary = Color(0xFF9B2F4E),
    onTertiary = Color.White,
    background = Color(0xFFF5F1E8),
    onBackground = Color(0xFF1B1A17),
    surface = Color(0xFFFFFBF5),
    onSurface = Color(0xFF1B1A17),
    surfaceVariant = Color(0xFFE7E0D4),
    onSurfaceVariant = Color(0xFF4B463F),
    error = Color(0xFFB3261E),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF89D6E1),
    onPrimary = Color(0xFF002B35),
    primaryContainer = Color(0xFF114452),
    onPrimaryContainer = Color(0xFFC8E6EA),
    secondary = Color(0xFFF0C38F),
    onSecondary = Color(0xFF462707),
    secondaryContainer = Color(0xFF613A11),
    onSecondaryContainer = Color(0xFFF6DFC7),
    tertiary = Color(0xFFFFA9C0),
    onTertiary = Color(0xFF5E102B),
    background = Color(0xFF12110E),
    onBackground = Color(0xFFE7E1D8),
    surface = Color(0xFF1A1814),
    onSurface = Color(0xFFE7E1D8),
    surfaceVariant = Color(0xFF49443D),
    onSurfaceVariant = Color(0xFFCBC4B8),
    error = Color(0xFFF2B8B5),
)

private val MagicHatTypography = Typography()

@Composable
fun MagicHatTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = MagicHatTypography,
        content = content,
    )
}
