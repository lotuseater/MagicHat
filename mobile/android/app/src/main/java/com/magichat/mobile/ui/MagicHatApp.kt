package com.magichat.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.magichat.mobile.state.MagicHatScreen
import com.magichat.mobile.state.MagicHatViewModel
import com.magichat.mobile.ui.screens.CliInstancesScreen
import com.magichat.mobile.ui.screens.BrowserScreen
import com.magichat.mobile.ui.screens.InstanceDetailScreen
import com.magichat.mobile.ui.screens.InstancesScreen
import com.magichat.mobile.ui.screens.PairingScreen

@OptIn(ExperimentalMaterial3Api::class)
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
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (uiState.screen) {
                            MagicHatScreen.PAIRED_PC_SELECTION -> "Hosts"
                            MagicHatScreen.INSTANCES -> "Sessions"
                            MagicHatScreen.INSTANCE_DETAIL -> "Session"
                            MagicHatScreen.CLI_INSTANCES -> "CLI"
                            MagicHatScreen.BROWSER -> "Browser"
                        },
                    )
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = uiState.screen == MagicHatScreen.PAIRED_PC_SELECTION,
                    onClick = { viewModel.navigateTo(MagicHatScreen.PAIRED_PC_SELECTION) },
                    icon = { Icon(Icons.Outlined.Computer, contentDescription = null) },
                    label = { Text("Hosts") },
                )
                NavigationBarItem(
                    selected = uiState.screen == MagicHatScreen.INSTANCES,
                    onClick = { viewModel.navigateTo(MagicHatScreen.INSTANCES) },
                    icon = { Icon(Icons.Outlined.FolderOpen, contentDescription = null) },
                    label = { Text("Sessions") },
                )
                NavigationBarItem(
                    selected = uiState.screen == MagicHatScreen.INSTANCE_DETAIL,
                    onClick = {
                        if (uiState.selectedInstanceId != null) {
                            viewModel.navigateTo(MagicHatScreen.INSTANCE_DETAIL)
                        } else {
                            viewModel.navigateTo(MagicHatScreen.INSTANCES)
                            viewModel.clearError()
                        }
                    },
                    icon = { Icon(Icons.Outlined.Terminal, contentDescription = null) },
                    enabled = uiState.selectedInstanceId != null,
                    label = { Text("Session") },
                )
                NavigationBarItem(
                    selected = uiState.screen == MagicHatScreen.CLI_INSTANCES,
                    onClick = { viewModel.navigateTo(MagicHatScreen.CLI_INSTANCES) },
                    icon = { Icon(Icons.Outlined.Code, contentDescription = null) },
                    label = { Text("CLI") },
                )
                NavigationBarItem(
                    selected = uiState.screen == MagicHatScreen.BROWSER,
                    onClick = { viewModel.navigateTo(MagicHatScreen.BROWSER) },
                    icon = { Icon(Icons.Outlined.Language, contentDescription = null) },
                    label = { Text("Browser") },
                )
            }
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (uiState.isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            when (uiState.screen) {
                MagicHatScreen.PAIRED_PC_SELECTION -> PairingScreen(
                    state = uiState,
                    onBaseUrlChanged = viewModel::updateBaseUrl,
                    onRemotePairUriChanged = viewModel::updateRemotePairUri,
                    onPairRemoteFromUri = viewModel::pairRemoteFromUri,
                    onPairCodeChanged = viewModel::updatePairCode,
                    onToggleLanPairing = viewModel::toggleLanPairingExpanded,
                    onDiscover = viewModel::discoverHosts,
                    onPair = viewModel::pair,
                    onPairRemote = viewModel::pairRemote,
                    onSelectPairedHost = viewModel::selectPairedHost,
                    onForgetHost = viewModel::forgetHost,
                    onRefreshActiveHost = viewModel::refreshActiveHostStatus,
                    onError = viewModel::showError,
                )

                MagicHatScreen.INSTANCES -> InstancesScreen(
                    state = uiState,
                    onLaunchTitleChanged = viewModel::updateLaunchTitle,
                    onLaunchTeamModeChanged = viewModel::updateLaunchTeamMode,
                    onLaunchLauncherPresetChanged = viewModel::updateLaunchLauncherPreset,
                    onLaunchFenrusLauncherChanged = viewModel::updateLaunchFenrusLauncher,
                    onRestoreSessionChanged = viewModel::updateRestoreSession,
                    onRefresh = viewModel::refreshInstances,
                    onLaunchInstance = viewModel::launchInstance,
                    onCloseInstance = viewModel::closeInstance,
                    onOpenInstance = viewModel::openInstance,
                    onPickRestoreRef = viewModel::pickRestoreRef,
                    onRestoreSession = viewModel::restoreSession,
                    onRefreshActiveHost = viewModel::refreshActiveHostStatus,
                )

                MagicHatScreen.INSTANCE_DETAIL -> {
                    if (uiState.selectedInstanceId == null) {
                        Text(
                            text = "Pick a session from Sessions to see chat, team terminals, summary, and live stream output.",
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    } else {
                        InstanceDetailScreen(
                            state = uiState,
                            onPromptChanged = viewModel::updatePrompt,
                            onFollowUpChanged = viewModel::updateFollowUp,
                            onSendPrompt = viewModel::sendPrompt,
                            onSendFollowUp = viewModel::sendFollowUp,
                            onTrustApproved = { viewModel.answerTrustPrompt(true) },
                            onTrustDenied = { viewModel.answerTrustPrompt(false) },
                            onSelectTerminalAgent = viewModel::selectTerminalAgent,
                            onRefreshActiveHost = viewModel::refreshActiveHostStatus,
                        )
                    }
                }

                MagicHatScreen.CLI_INSTANCES -> CliInstancesScreen(
                    state = uiState,
                    onPresetChanged = viewModel::updateCliPreset,
                    onLaunchPromptChanged = viewModel::updateCliLaunchPrompt,
                    onLaunch = viewModel::launchCliInstance,
                    onSelectInstance = { viewModel.selectCliInstance(it) },
                    onFollowUpChanged = viewModel::updateCliFollowUp,
                    onSendFollowUp = viewModel::sendCliFollowUp,
                    onClose = viewModel::closeCliInstance,
                    onRefresh = viewModel::refreshCliPanel,
                    onSilentRefresh = viewModel::refreshCliPanelQuietly,
                    onRefreshActiveHost = viewModel::refreshActiveHostStatus,
                )

                MagicHatScreen.BROWSER -> BrowserScreen(
                    state = uiState,
                    onBrowserUrlChanged = viewModel::updateBrowserUrl,
                    onBrowserSearchChanged = viewModel::updateBrowserSearch,
                    onBrowserSearchEngineChanged = viewModel::updateBrowserSearchEngine,
                    onOpenBrowserUrl = viewModel::openBrowserUrl,
                    onSearchInBrowser = viewModel::searchInBrowser,
                    onSelectPage = viewModel::selectBrowserPage,
                    onRefresh = viewModel::refreshBrowserPanel,
                    onRefreshActiveHost = viewModel::refreshActiveHostStatus,
                )
            }
        }
    }
}
