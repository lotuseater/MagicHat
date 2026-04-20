package com.magichat.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.FenrusLauncherOption
import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.LauncherPresetOption
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.model.TeamModeOption
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard
import com.magichat.mobile.ui.components.StatusChip

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InstancesScreen(
    state: MagicHatUiState,
    onLaunchTitleChanged: (String) -> Unit,
    onLaunchTeamModeChanged: (TeamModeOption) -> Unit,
    onLaunchLauncherPresetChanged: (LauncherPresetOption) -> Unit,
    onLaunchFenrusLauncherChanged: (FenrusLauncherOption) -> Unit,
    onRestoreSessionChanged: (String) -> Unit,
    onRefresh: () -> Unit,
    onLaunchInstance: () -> Unit,
    onCloseInstance: (String) -> Unit,
    onOpenInstance: (String) -> Unit,
    onPickRestoreRef: (String) -> Unit,
    onRestoreSession: () -> Unit,
    onRefreshActiveHost: () -> Unit,
) {
    val hasActiveHost = state.activeHost != null
    val canRunCommands = state.activeHost?.canRunCommands(state.activeHostPresence) == true
    var pendingClose by remember { mutableStateOf<TeamAppInstance?>(null) }

    pendingClose?.let { target ->
        AlertDialog(
            onDismissRequest = { pendingClose = null },
            title = { Text("Close session?") },
            text = {
                Text(
                    "This will close \"${target.title}\" on the host. Any unsaved work in the Team App window may be lost.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onCloseInstance(target.instanceId)
                    pendingClose = null
                }) { Text("Close session") }
            },
            dismissButton = {
                TextButton(onClick = { pendingClose = null }) { Text("Cancel") }
            },
        )
    }

    PullToRefreshBox(
        isRefreshing = state.isLoading && hasActiveHost,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Sessions", style = MaterialTheme.typography.headlineSmall)
            }

            item {
                HostContextCard(
                    host = state.activeHost,
                    presence = state.activeHostPresence,
                    activeInstanceId = state.selectedInstanceId,
                    onRefreshStatus = if (state.activeHost != null) onRefreshActiveHost else null,
                    refreshEnabled = state.isLoading.not(),
                )
            }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onRefresh, enabled = hasActiveHost && state.isLoading.not()) {
                        Icon(Icons.Outlined.Refresh, contentDescription = null)
                        Text(" Refresh")
                    }
                    Text(
                        "Pull down to refresh",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 4.dp, top = 10.dp),
                    )
                }
            }

            item {
                SessionComposerCard(
                    state = state,
                    canRunCommands = canRunCommands,
                    onLaunchTitleChanged = onLaunchTitleChanged,
                    onLaunchTeamModeChanged = onLaunchTeamModeChanged,
                    onLaunchLauncherPresetChanged = onLaunchLauncherPresetChanged,
                    onLaunchFenrusLauncherChanged = onLaunchFenrusLauncherChanged,
                    onLaunchInstance = onLaunchInstance,
                )
            }

            item {
                RestoreSessionCard(
                    state = state,
                    canRunCommands = canRunCommands,
                    onRestoreSessionChanged = onRestoreSessionChanged,
                    onPickRestoreRef = onPickRestoreRef,
                    onRestoreSession = onRestoreSession,
                )
            }

            item {
                Text("Open Sessions", style = MaterialTheme.typography.titleMedium)
            }

            if (!hasActiveHost) {
                item {
                    Text(
                        "Choose a host on the Hosts screen first.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else if (state.instances.isEmpty()) {
                item {
                    Text(
                        "Connected, but this host does not currently expose any open Team App sessions.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                items(state.instances, key = { it.instanceId }) { instance ->
                    SessionRow(
                        instance = instance,
                        selected = instance.instanceId == state.selectedInstanceId,
                        enabled = canRunCommands && state.isLoading.not(),
                        onOpen = { onOpenInstance(instance.instanceId) },
                        onCloseRequested = { pendingClose = instance },
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionComposerCard(
    state: MagicHatUiState,
    canRunCommands: Boolean,
    onLaunchTitleChanged: (String) -> Unit,
    onLaunchTeamModeChanged: (TeamModeOption) -> Unit,
    onLaunchLauncherPresetChanged: (LauncherPresetOption) -> Unit,
    onLaunchFenrusLauncherChanged: (FenrusLauncherOption) -> Unit,
    onLaunchInstance: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        val hasInitialPrompt = state.launchTitleInput.isNotBlank()
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Start Session", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Launch a new Team App session and optionally override the startup profile.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            OutlinedTextField(
                value = state.launchTitleInput,
                onValueChange = onLaunchTitleChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Initial prompt") },
                placeholder = { Text("Describe the task for the team") },
                minLines = 3,
                enabled = canRunCommands && state.isLoading.not() && state.sessionLaunchInFlight.not(),
            )

            LaunchOptionSelector(
                label = "Team Mode",
                options = TeamModeOption.entries,
                selected = state.launchTeamMode,
                optionLabel = { it.label },
                enabled = canRunCommands && state.isLoading.not() && state.sessionLaunchInFlight.not(),
                onSelected = onLaunchTeamModeChanged,
            )

            LaunchOptionSelector(
                label = "Launcher",
                options = LauncherPresetOption.entries,
                selected = state.launchLauncherPreset,
                optionLabel = { it.label },
                enabled = canRunCommands && state.isLoading.not() && state.sessionLaunchInFlight.not(),
                onSelected = onLaunchLauncherPresetChanged,
            )

            LaunchOptionSelector(
                label = "Fenrus",
                options = FenrusLauncherOption.entries,
                selected = state.launchFenrusLauncher,
                optionLabel = { it.label },
                enabled = canRunCommands && state.isLoading.not(),
                onSelected = onLaunchFenrusLauncherChanged,
            )

            Button(
                onClick = onLaunchInstance,
                modifier = Modifier.semantics {
                    contentDescription = "start-session-button"
                },
                enabled = canRunCommands && state.isLoading.not()
                    && state.sessionLaunchInFlight.not()
                    && hasInitialPrompt,
            ) {
                Text(if (state.sessionLaunchInFlight) "Starting..." else "Start Session")
            }
            if (!canRunCommands) {
                Text(
                    "Host is offline — can't start a session right now.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (!hasInitialPrompt) {
                Text(
                    "Enter an initial prompt to enable Start Session.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RestoreSessionCard(
    state: MagicHatUiState,
    canRunCommands: Boolean,
    onRestoreSessionChanged: (String) -> Unit,
    onPickRestoreRef: (String) -> Unit,
    onRestoreSession: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.Restore, contentDescription = null)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Restore Session", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Use a saved restore ref or paste a known session selector.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.restoreSessionInput,
                    onValueChange = onRestoreSessionChanged,
                    modifier = Modifier.weight(1f),
                    label = { Text("Restore Ref / Session") },
                    singleLine = true,
                    enabled = canRunCommands && state.isLoading.not(),
                )
                Button(
                    onClick = onRestoreSession,
                    enabled = canRunCommands && state.restoreSessionInput.isNotBlank() && state.isLoading.not(),
                ) {
                    Text("Restore")
                }
            }

            if (state.knownRestoreRefs.isNotEmpty()) {
                Text("Known Restore Refs", style = MaterialTheme.typography.titleSmall)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.knownRestoreRefs, key = { it.restoreRef }) { restoreRef ->
                        RestoreRefChipCard(
                            restoreRef = restoreRef,
                            onPick = { onPickRestoreRef(restoreRef.restoreRef) },
                            enabled = canRunCommands && state.isLoading.not(),
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> LaunchOptionSelector(
    label: String,
    options: List<T>,
    selected: T,
    optionLabel: (T) -> String,
    enabled: Boolean,
    onSelected: (T) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(options) { option ->
                val isSelected = option == selected
                FilterChip(
                    selected = isSelected,
                    onClick = { if (!isSelected) onSelected(option) },
                    enabled = enabled,
                    label = { Text(optionLabel(option)) },
                    colors = FilterChipDefaults.filterChipColors(),
                )
            }
        }
    }
}

@Composable
private fun RestoreRefChipCard(
    restoreRef: KnownRestoreRef,
    onPick: () -> Unit,
    enabled: Boolean,
) {
    Card {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(restoreRef.title ?: restoreRef.restoreRef, style = MaterialTheme.typography.titleSmall)
            Text(
                restoreRef.restoreRef,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = onPick, enabled = enabled) {
                Text("Use")
            }
        }
    }
}

@Composable
private fun SessionRow(
    instance: TeamAppInstance,
    selected: Boolean,
    enabled: Boolean,
    onOpen: () -> Unit,
    onCloseRequested: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                if (selected) "${instance.title} (Selected)" else instance.title,
                style = MaterialTheme.typography.titleMedium,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(
                    label = instance.health,
                    background = when (instance.health.lowercase()) {
                        "running", "planning", "reviewing", "executing" -> MaterialTheme.colorScheme.primaryContainer
                        "blocked", "error", "failed" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceVariant
                    },
                    contentColor = when (instance.health.lowercase()) {
                        "running", "planning", "reviewing", "executing" -> MaterialTheme.colorScheme.onPrimaryContainer
                        "blocked", "error", "failed" -> MaterialTheme.colorScheme.onErrorContainer
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
                StatusChip(
                    label = if (instance.active) "active" else "inactive",
                    background = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Row(
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    instance.instanceId,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { clipboard.setText(AnnotatedString(instance.instanceId)) }) {
                    Icon(
                        Icons.Outlined.ContentCopy,
                        contentDescription = "Copy instance id",
                    )
                }
            }
            instance.sessionId?.takeIf { it.isNotBlank() }?.let {
                Text(
                    "session: $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!instance.resultPreview.isNullOrBlank()) {
                Text(instance.resultPreview, style = MaterialTheme.typography.bodyMedium)
            }
            instance.restoreRef?.takeIf { it.isNotBlank() }?.let {
                Text(
                    "restore ref: $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpen, enabled = enabled && !selected) {
                    Text(if (selected) "Open" else "View")
                }
                OutlinedButton(onClick = onCloseRequested, enabled = enabled) {
                    Text("Close")
                }
            }
        }
    }
}
