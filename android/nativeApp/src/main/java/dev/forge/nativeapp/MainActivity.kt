package dev.forge.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
            ForgeTheme { ForgeScreen(chat.state.collectAsStateWithLifecycle().value, chat) }
        }
    }
    override fun onStart() { super.onStart(); chat.foreground(true) }
    override fun onStop() {
        if (!isChangingConfigurations) chat.foreground(false)
        super.onStop()
    }
}
