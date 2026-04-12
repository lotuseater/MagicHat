package com.magichat.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard

@Composable
fun PairingScreen(
    state: MagicHatUiState,
    onBaseUrlChanged: (String) -> Unit,
    onRemotePairUriChanged: (String) -> Unit,
    onPairCodeChanged: (String) -> Unit,
    onDiscover: () -> Unit,
    onPair: (String) -> Unit,
    onPairRemote: () -> Unit,
    onSelectPairedHost: (String) -> Unit,
    onForgetHost: (String) -> Unit,
    onRefreshActiveHost: () -> Unit,
) {
    val canProbe = state.isLoading.not()
    val canPairLan = state.isLoading.not() && state.discoveredHosts.isNotEmpty() && state.pairCodeInput.isNotBlank()
    val canPairRemote = state.isLoading.not() && state.remotePairUriInput.isNotBlank()

    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Text("Paired PC Selection", style = MaterialTheme.typography.titleLarge)
        }

        item {
            HostContextCard(
                host = state.activeHost,
                presence = state.activeHostPresence,
                onRefreshStatus = if (state.activeHost != null) onRefreshActiveHost else null,
                refreshEnabled = state.isLoading.not(),
            )
        }

        item {
            OutlinedTextField(
                value = state.baseUrlInput,
                onValueChange = onBaseUrlChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("PC Host Base URL (LAN)") },
                placeholder = { Text("http://192.168.1.10:8787/") },
                singleLine = true,
            )
        }

        item {
            OutlinedTextField(
                value = state.remotePairUriInput,
                onValueChange = onRemotePairUriChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Remote Pair URI") },
                placeholder = { Text("magichat://pair?...") },
                singleLine = true,
            )
        }

        item {
            OutlinedTextField(
                value = state.pairCodeInput,
                onValueChange = onPairCodeChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("One-Time Pairing Code") },
                singleLine = true,
            )
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onDiscover, enabled = canProbe) {
                    Text("Probe Host")
                }
                Button(
                    onClick = { state.discoveredHosts.firstOrNull()?.hostId?.let(onPair) },
                    enabled = canPairLan,
                ) {
                    Text("Pair Host")
                }
                Button(onClick = onPairRemote, enabled = canPairRemote) {
                    Text("Pair Remote")
                }
            }
        }

        item {
            Text("Discovered Hosts", style = MaterialTheme.typography.titleMedium)
        }

        if (state.discoveredHosts.isEmpty()) {
            item {
                Text(
                    "Probe a LAN host or paste a remote pairing URI to get started.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        } else {
            items(state.discoveredHosts, key = { it.hostId }) { host ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(host.displayName, style = MaterialTheme.typography.titleSmall)
                        Text("${host.address} • ${host.hostId}")
                        Button(
                            onClick = { onPair(host.hostId) },
                            enabled = state.pairCodeInput.isNotBlank() && state.isLoading.not(),
                        ) {
                            Text("Pair")
                        }
                    }
                }
            }
        }

        item {
            Text("Paired Hosts", style = MaterialTheme.typography.titleMedium)
        }

        if (state.pairedHosts.isEmpty()) {
            item {
                Text(
                    "No paired hosts yet. Pair once here and the rest of the app can stay focused on controlling Team App.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        } else {
            items(state.pairedHosts, key = { it.hostId }) { paired ->
                PairedHostRow(
                    host = paired,
                    active = paired.hostId == state.activeHostId,
                    isLoading = state.isLoading,
                    onSelect = { onSelectPairedHost(paired.hostId) },
                    onForget = { onForgetHost(paired.hostId) },
                )
            }
        }
    }
}

@Composable
private fun PairedHostRow(
    host: PairedHostRecord,
    active: Boolean,
    isLoading: Boolean,
    onSelect: () -> Unit,
    onForget: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = if (active) "${host.displayName} (Active)" else host.displayName,
                style = MaterialTheme.typography.titleSmall,
            )
            Text(if (host.mode.lowercase() == "remote_relay") host.relayUrl ?: host.baseUrl else host.baseUrl)
            host.lastKnownHostPresence?.takeIf { it.isNotBlank() }?.let {
                Text("presence: $it")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSelect, enabled = active.not() && isLoading.not()) {
                    Text("Select")
                }
                Button(onClick = onForget, enabled = isLoading.not()) {
                    Text("Forget")
                }
            }
        }
    }
}
