package com.magichat.mobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.magichat.mobile.state.MagicHatAutomationIntent
import com.magichat.mobile.state.MagicHatViewModel
import com.magichat.mobile.ui.MagicHatApp
import com.magichat.mobile.ui.theme.MagicHatTheme

class MainActivity : ComponentActivity() {

    private val viewModel: MagicHatViewModel by viewModels {
        MagicHatViewModel.provideFactory(applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        consumePairingIntent(intent)
        consumeAutomationIntent(intent)
        setContent {
            MagicHatTheme {
                MagicHatApp(viewModel = viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumePairingIntent(intent)
        consumeAutomationIntent(intent)
    }

    private fun consumePairingIntent(intent: Intent?) {
        val pairUri = intent?.dataString?.takeIf { it.startsWith("magichat://pair", ignoreCase = true) }
            ?: return
        viewModel.importRemotePairUri(pairUri)
    }

    private fun consumeAutomationIntent(intent: Intent?) {
        val automation = MagicHatAutomationIntent.fromIntent(intent) ?: return
        viewModel.applyAutomationIntent(automation)
    }
}
