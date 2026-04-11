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
import com.magichat.mobile.state.MagicHatUiState

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
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Team App Instances", style = MaterialTheme.typography.titleLarge)
        Text(
            text = "Active host: ${state.activeHostId ?: "none"}${state.activeHostPresence?.let { " • $it" } ?: ""}",
            style = MaterialTheme.typography.bodyMedium,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onRefresh) {
                Text("Refresh")
            }
            Button(onClick = onLaunchInstance) {
                Text("Launch New")
            }
        }

        OutlinedTextField(
            value = state.launchTitleInput,
            onValueChange = onLaunchTitleChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("New Instance Title") },
            singleLine = true,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = state.restoreSessionInput,
                onValueChange = onRestoreSessionChanged,
                modifier = Modifier.weight(1f),
                label = { Text("Restore Path / Restore Ref") },
                singleLine = true,
            )
            Button(onClick = onRestoreSession) {
                Text("Restore")
            }
        }

        if (state.knownRestoreRefs.isNotEmpty()) {
            Text("Known Restore Refs", style = MaterialTheme.typography.titleMedium)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.knownRestoreRefs, key = { it.restoreRef }) { restoreRef ->
                    RestoreRefRow(restoreRef = restoreRef, onPick = { onPickRestoreRef(restoreRef.restoreRef) })
                }
            }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.instances, key = { it.instanceId }) { instance ->
                InstanceRow(
                    instance = instance,
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
    onPick: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(restoreRef.title ?: restoreRef.restoreRef, style = MaterialTheme.typography.titleSmall)
            Text(restoreRef.restoreRef)
            restoreRef.sessionId?.takeIf { it.isNotBlank() }?.let {
                Text("session: $it")
            }
            Button(onClick = onPick) {
                Text("Use Restore Ref")
            }
        }
    }
}

@Composable
private fun InstanceRow(
    instance: TeamAppInstance,
    onOpen: () -> Unit,
    onClose: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(instance.title, style = MaterialTheme.typography.titleSmall)
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
                Button(onClick = onOpen) {
                    Text("Open")
                }
                Button(onClick = onClose) {
                    Text("Close")
                }
            }
        }
    }
}
