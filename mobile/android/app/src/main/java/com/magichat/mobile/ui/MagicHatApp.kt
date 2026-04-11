package com.magichat.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.magichat.mobile.state.MagicHatScreen
import com.magichat.mobile.state.MagicHatViewModel
import com.magichat.mobile.ui.screens.InstanceDetailScreen
import com.magichat.mobile.ui.screens.InstancesScreen
import com.magichat.mobile.ui.screens.PairingScreen

@Composable
fun MagicHatApp(
    viewModel: MagicHatViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.errorMessage) {
        val error = uiState.errorMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(error)
        viewModel.clearError()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        bottomBar = {
            BottomAppBar {
                Button(onClick = { viewModel.navigateTo(MagicHatScreen.PAIRED_PC_SELECTION) }, modifier = Modifier.padding(horizontal = 6.dp)) {
                    Text("PCs")
                }
                Button(onClick = { viewModel.navigateTo(MagicHatScreen.INSTANCES) }, modifier = Modifier.padding(horizontal = 6.dp)) {
                    Text("Instances")
                }
                Button(
                    onClick = { viewModel.navigateTo(MagicHatScreen.INSTANCE_DETAIL) },
                    modifier = Modifier.padding(horizontal = 6.dp),
                ) {
                    Text("Detail")
                }
            }
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (uiState.isLoading) {
                CircularProgressIndicator()
            }

            when (uiState.screen) {
                MagicHatScreen.PAIRED_PC_SELECTION -> PairingScreen(
                    state = uiState,
                    onBaseUrlChanged = viewModel::updateBaseUrl,
                    onPairCodeChanged = viewModel::updatePairCode,
                    onDiscover = viewModel::discoverHosts,
                    onPair = viewModel::pair,
                    onSelectPairedHost = viewModel::selectPairedHost,
                    onForgetHost = viewModel::forgetHost,
                )

                MagicHatScreen.INSTANCES -> InstancesScreen(
                    state = uiState,
                    onLaunchTitleChanged = viewModel::updateLaunchTitle,
                    onRestoreSessionChanged = viewModel::updateRestoreSession,
                    onRefresh = viewModel::refreshInstances,
                    onLaunchInstance = viewModel::launchInstance,
                    onCloseInstance = viewModel::closeInstance,
                    onOpenInstance = viewModel::openInstance,
                    onRestoreSession = viewModel::restoreSession,
                )

                MagicHatScreen.INSTANCE_DETAIL -> {
                    if (uiState.selectedInstanceId == null) {
                        Text(
                            text = "Select an instance from the Instances screen",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    } else {
                        InstanceDetailScreen(
                            state = uiState,
                            onPromptChanged = viewModel::updatePrompt,
                            onFollowUpChanged = viewModel::updateFollowUp,
                            onSendPrompt = viewModel::sendPrompt,
                            onSendFollowUp = viewModel::sendFollowUp,
                        )
                    }
                }
            }
        }
    }
}
