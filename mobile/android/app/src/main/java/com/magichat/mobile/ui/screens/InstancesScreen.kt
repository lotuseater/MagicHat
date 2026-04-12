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
import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard

@Composable
fun InstancesScreen(
    state: MagicHatUiState,
    onLaunchTitleChanged: (String) -> Unit,
    onRestoreSessionChanged: (String) -> Unit,
    onRefresh: () -> Unit,
    onLaunchInstance: () -> Unit,
    onCloseInstance: (String) -> Unit,
    onOpenInstance: (String) -> Unit,
    onPickRestoreRef: (String) -> Unit,
    onRestoreSession: () -> Unit,
) {
    val hasActiveHost = state.activeHost != null
    val canRunCommands = state.activeHost?.canRunCommands(state.activeHostPresence) == true

    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Text("Team App Instances", style = MaterialTheme.typography.titleLarge)
        }

        item {
            HostContextCard(
                host = state.activeHost,
                presence = state.activeHostPresence,
                activeInstanceId = state.selectedInstanceId,
            )
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onRefresh, enabled = hasActiveHost && state.isLoading.not()) {
                    Text("Refresh")
                }
                Button(onClick = onLaunchInstance, enabled = canRunCommands && state.isLoading.not()) {
                    Text("Launch New")
                }
            }
        }

        item {
            OutlinedTextField(
                value = state.launchTitleInput,
                onValueChange = onLaunchTitleChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("New Instance Title") },
                singleLine = true,
                enabled = hasActiveHost && state.isLoading.not(),
            )
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.restoreSessionInput,
                    onValueChange = onRestoreSessionChanged,
                    modifier = Modifier.weight(1f),
                    label = { Text("Restore Ref / Session") },
                    singleLine = true,
                    enabled = hasActiveHost && state.isLoading.not(),
                )
                Button(
                    onClick = onRestoreSession,
                    enabled = canRunCommands && state.restoreSessionInput.isNotBlank() && state.isLoading.not(),
                ) {
                    Text("Restore")
                }
            }
        }

        if (hasActiveHost.not()) {
            item {
                Text(
                    "Select a paired host on the PCs screen first. Launch, restore, and instance refresh all depend on that host context.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        } else if (!canRunCommands) {
            item {
                Text(
                    "The active host is offline, so Team App commands are temporarily disabled. You can still refresh or switch hosts.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        if (state.knownRestoreRefs.isNotEmpty()) {
            item {
                Text("Known Restore Refs", style = MaterialTheme.typography.titleMedium)
            }
            items(state.knownRestoreRefs, key = { it.restoreRef }) { restoreRef ->
                RestoreRefRow(
                    restoreRef = restoreRef,
                    enabled = canRunCommands && state.isLoading.not(),
                    onPick = { onPickRestoreRef(restoreRef.restoreRef) },
                )
            }
        }

        item {
            Text("Open Instances", style = MaterialTheme.typography.titleMedium)
        }

        if (state.instances.isEmpty()) {
            item {
                Text(
                    if (hasActiveHost) {
                        "Connected, but this host does not currently have any open Team App instances."
                    } else {
                        "No instances to show yet."
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        } else {
            items(state.instances, key = { it.instanceId }) { instance ->
                InstanceRow(
                    instance = instance,
                    selected = instance.instanceId == state.selectedInstanceId,
                    enabled = canRunCommands && state.isLoading.not(),
                    onOpen = { onOpenInstance(instance.instanceId) },
                    onClose = { onCloseInstance(instance.instanceId) },
                )
            }
        }
    }
}

@Composable
private fun RestoreRefRow(
    restoreRef: KnownRestoreRef,
    enabled: Boolean,
    onPick: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(restoreRef.title ?: restoreRef.restoreRef, style = MaterialTheme.typography.titleSmall)
            Text(restoreRef.restoreRef)
            restoreRef.sessionId?.takeIf { it.isNotBlank() }?.let {
                Text("session: $it")
            }
            restoreRef.observedAt?.takeIf { it.isNotBlank() }?.let {
                Text("seen: $it")
            }
            Button(onClick = onPick, enabled = enabled) {
                Text("Use Restore Ref")
            }
        }
    }
}

@Composable
private fun InstanceRow(
    instance: TeamAppInstance,
    selected: Boolean,
    enabled: Boolean,
    onOpen: () -> Unit,
    onClose: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (selected) "${instance.title} (Selected)" else instance.title,
                style = MaterialTheme.typography.titleSmall,
            )
            Text("${instance.instanceId} • ${instance.health} • active=${instance.active}")
            instance.sessionId?.takeIf { it.isNotBlank() }?.let {
                Text("session: $it")
            }
            if (!instance.resultPreview.isNullOrBlank()) {
                Text(instance.resultPreview)
            }
            instance.restoreRef?.takeIf { it.isNotBlank() }?.let {
                Text("restore ref: $it")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpen, enabled = enabled && selected.not()) {
                    Text("Open")
                }
                Button(onClick = onClose, enabled = enabled) {
                    Text("Close")
                }
            }
        }
    }
}
