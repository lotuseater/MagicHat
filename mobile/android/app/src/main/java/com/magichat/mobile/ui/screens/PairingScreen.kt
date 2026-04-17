package com.magichat.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Router
import androidx.compose.material.icons.outlined.WifiTethering
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard
import com.magichat.mobile.ui.components.StatusChip

@Composable
fun PairingScreen(
    state: MagicHatUiState,
    onBaseUrlChanged: (String) -> Unit,
    onRemotePairUriChanged: (String) -> Unit,
    onPairCodeChanged: (String) -> Unit,
    onToggleLanPairing: () -> Unit,
    onDiscover: () -> Unit,
    onPair: (String) -> Unit,
    onPairRemote: () -> Unit,
    onSelectPairedHost: (String) -> Unit,
    onForgetHost: (String) -> Unit,
    onRefreshActiveHost: () -> Unit,
    onError: (String) -> Unit,
) {
    val context = LocalContext.current
    val scanner = remember(context) {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build()
        GmsBarcodeScanning.getClient(context, options)
    }
    val canPairRemote = state.isLoading.not() && state.remotePairUriInput.isNotBlank()

    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Hosts", style = MaterialTheme.typography.headlineSmall)
        }

        item {
            Text(
                "Remote pairing is the fastest path. LAN pairing is still available when you need direct local setup.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        item {
            Text("Active Host", style = MaterialTheme.typography.titleMedium)
            HostContextCard(
                host = state.activeHost,
                presence = state.activeHostPresence,
                onRefreshStatus = if (state.activeHost != null) onRefreshActiveHost else null,
                refreshEnabled = state.isLoading.not(),
            )
        }

        item {
            Text("Pair New Host", style = MaterialTheme.typography.titleMedium)
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Remote Pairing", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Scan the QR from the host pairing window or paste the pair URI manually.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                scanner.startScan()
                                    .addOnSuccessListener { barcode ->
                                        val raw = barcode.rawValue.orEmpty().trim()
                                        if (raw.startsWith("magichat://pair", ignoreCase = true)) {
                                            onRemotePairUriChanged(raw)
                                        } else {
                                            onError("Scanned QR does not contain a MagicHat pair URI.")
                                        }
                                    }
                                    .addOnFailureListener { error ->
                                        val message = if (error is MlKitException &&
                                            error.errorCode == CommonStatusCodes.CANCELED
                                        ) {
                                            null
                                        } else {
                                            error.message ?: "QR scan failed"
                                        }
                                        message?.let(onError)
                                    }
                            },
                            enabled = state.isLoading.not(),
                        ) {
                            Text("Scan QR")
                        }
                        OutlinedButton(
                            onClick = onPairRemote,
                            enabled = canPairRemote,
                        ) {
                            Text("Pair Remote")
                        }
                    }

                    OutlinedTextField(
                        value = state.remotePairUriInput,
                        onValueChange = onRemotePairUriChanged,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Remote Pair URI") },
                        placeholder = { Text("magichat://pair?...") },
                        minLines = 2,
                        enabled = state.isLoading.not(),
                    )
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Outlined.Router, contentDescription = null)
                                Text("Advanced LAN Pairing", style = MaterialTheme.typography.titleSmall)
                            }
                            Text(
                                "Use this when you want to pair directly with a host on the same network.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = onToggleLanPairing) {
                            Icon(
                                imageVector = if (state.lanPairingExpanded) Icons.Outlined.WifiTethering else Icons.Outlined.Computer,
                                contentDescription = null,
                            )
                        }
                    }

                    if (state.lanPairingExpanded) {
                        OutlinedTextField(
                            value = state.baseUrlInput,
                            onValueChange = onBaseUrlChanged,
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("PC Host Base URL") },
                            placeholder = { Text("http://192.168.1.10:18765/") },
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
                            OutlinedButton(onClick = onDiscover, enabled = state.isLoading.not()) {
                                Text("Probe Host")
                            }
                            Button(
                                onClick = { state.discoveredHosts.firstOrNull()?.hostId?.let(onPair) },
                                enabled = state.isLoading.not() &&
                                    state.discoveredHosts.isNotEmpty() &&
                                    state.pairCodeInput.isNotBlank(),
                            ) {
                                Text("Pair LAN Host")
                            }
                        }
                    }
                }
            }
        }

        if (state.discoveredHosts.isNotEmpty()) {
            item {
                Text("LAN Hosts", style = MaterialTheme.typography.titleMedium)
            }
            items(state.discoveredHosts, key = { it.hostId }) { host ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(host.displayName, style = MaterialTheme.typography.titleSmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip(
                                label = host.address,
                                background = MaterialTheme.colorScheme.primaryContainer,
                                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                            StatusChip(
                                label = host.hostId,
                                background = MaterialTheme.colorScheme.surfaceVariant,
                                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Button(
                            onClick = { onPair(host.hostId) },
                            enabled = state.pairCodeInput.isNotBlank() && state.isLoading.not(),
                        ) {
                            Text("Use This Host")
                        }
                    }
                }
            }
        }

        item {
            Text("Saved Hosts", style = MaterialTheme.typography.titleMedium)
        }

        if (state.pairedHosts.isEmpty()) {
            item {
                Text(
                    "No saved hosts yet. Pair once here and the rest of the app stays focused on sessions.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = host.displayName,
                style = MaterialTheme.typography.titleSmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(
                    label = if (host.mode.lowercase() == "remote_relay") "Remote relay" else "LAN direct",
                    background = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                host.lastKnownHostPresence?.takeIf { it.isNotBlank() }?.let {
                    StatusChip(
                        label = it.replace('_', ' '),
                        background = if (it.lowercase() == "online") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer,
                        contentColor = if (it.lowercase() == "online") MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
                if (active) {
                    StatusChip(
                        label = "In use",
                        background = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            }
            Text(
                if (host.mode.lowercase() == "remote_relay") host.relayUrl ?: host.baseUrl else host.baseUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSelect, enabled = active.not() && isLoading.not()) {
                    Text(if (active) "Selected" else "Use")
                }
                OutlinedButton(onClick = onForget, enabled = isLoading.not()) {
                    Text("Forget")
                }
            }
        }
    }
}
