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
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Paired PC Selection", style = MaterialTheme.typography.titleLarge)

        OutlinedTextField(
            value = state.baseUrlInput,
            onValueChange = onBaseUrlChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("PC Host Base URL (LAN)") },
            placeholder = { Text("http://192.168.1.10:8787/") },
            singleLine = true,
        )

        OutlinedTextField(
            value = state.remotePairUriInput,
            onValueChange = onRemotePairUriChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Remote Pair URI") },
            placeholder = { Text("magichat://pair?...") },
            singleLine = true,
        )

        OutlinedTextField(
            value = state.pairCodeInput,
            onValueChange = onPairCodeChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("One-Time Pairing Code") },
            singleLine = true,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onDiscover) {
                Text("Probe Host")
            }
            Button(onClick = { state.discoveredHosts.firstOrNull()?.hostId?.let(onPair) }) {
                Text("Pair Host")
            }
            Button(onClick = onPairRemote) {
                Text("Pair Remote")
            }
        }

        Text("Discovered Hosts", style = MaterialTheme.typography.titleMedium)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.discoveredHosts, key = { it.hostId }) { host ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(host.displayName, style = MaterialTheme.typography.titleSmall)
                        Text("${host.address} • ${host.hostId}")
                        Button(onClick = { onPair(host.hostId) }) {
                            Text("Pair")
                        }
                    }
                }
            }
        }

        Text("Paired Hosts", style = MaterialTheme.typography.titleMedium)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.pairedHosts, key = { it.hostId }) { paired ->
                PairedHostRow(
                    host = paired,
                    active = paired.hostId == state.activeHostId,
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
    onSelect: () -> Unit,
    onForget: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = if (active) "${host.displayName} (Active)" else host.displayName,
                style = MaterialTheme.typography.titleSmall,
            )
            Text(host.baseUrl)
            host.lastKnownHostPresence?.takeIf { it.isNotBlank() }?.let {
                Text("presence: $it")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSelect) {
                    Text("Select")
                }
                Button(onClick = onForget) {
                    Text("Forget")
                }
            }
        }
    }
}
