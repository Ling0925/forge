package dev.forge.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.activity.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.forge.nativeapp.ui.ForgeScreen
import dev.forge.nativeapp.ui.ForgeTheme

class MainActivity : ComponentActivity() {
    private val chat: ChatViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val state = chat.state.collectAsStateWithLifecycle().value
            val dark = when (state.themeMode) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            SideEffect {
                val bars = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                    else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            ForgeTheme(themeMode = state.themeMode) { ForgeScreen(state, chat) }
        }
    }
    override fun onStart() { super.onStart(); chat.foreground(true) }
    override fun onStop() {
        if (!isChangingConfigurations) chat.foreground(false)
        super.onStop()
    }
}
