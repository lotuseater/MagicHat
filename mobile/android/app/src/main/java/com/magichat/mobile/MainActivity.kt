package com.magichat.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.magichat.mobile.state.MagicHatViewModel
import com.magichat.mobile.ui.MagicHatApp
import com.magichat.mobile.ui.theme.MagicHatTheme

class MainActivity : ComponentActivity() {

    private val viewModel: MagicHatViewModel by viewModels {
        MagicHatViewModel.provideFactory(applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MagicHatTheme {
                MagicHatApp(viewModel = viewModel)
            }
        }
    }
}
