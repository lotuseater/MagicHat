package com.magichat.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.CliInstanceWire
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard
import com.magichat.mobile.ui.components.StatusChip

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CliInstancesScreen(
    state: MagicHatUiState,
    onPresetChanged: (String) -> Unit,
    onLaunchPromptChanged: (String) -> Unit,
    onLaunch: () -> Unit,
    onSelectInstance: (String) -> Unit,
    onFollowUpChanged: (String) -> Unit,
    onSendFollowUp: () -> Unit,
    onClose: (String) -> Unit,
    onRefresh: () -> Unit,
    onSilentRefresh: () -> Unit,
    onRefreshActiveHost: () -> Unit,
) {
    val hasActiveHost = state.activeHost != null
    val canRunCommands = state.activeHost?.canRunCommands(state.activeHostPresence) == true
    val selected = state.cliSelectedInstanceId
        ?.let { id -> state.cliInstances.firstOrNull { it.instanceId == id } }
    var pendingClose by remember { mutableStateOf<CliInstanceWire?>(null) }

    // Auto-refresh the CLI instance list every 5 s while this screen is visible
    // — catches child exits/status changes without forcing the user to pull-refresh.
    // Uses the silent variant so a busy spinner doesn't flash every tick; SSE still
    // delivers live output for the selected instance in between.
    LaunchedEffect(canRunCommands, state.activeHost?.hostId) {
        if (!canRunCommands) return@LaunchedEffect
        while (true) {
            delay(5_000)
            onSilentRefresh()
        }
    }

    pendingClose?.let { target ->
        AlertDialog(
            onDismissRequest = { pendingClose = null },
            title = { Text("Close ${target.presetLabel}?") },
            text = {
                Text(
                    "Send SIGTERM to \"${target.title}\". The CLI process will exit and its output stops here.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onClose(target.instanceId)
                    pendingClose = null
                }) { Text("Close process") }
            },
            dismissButton = {
                TextButton(onClick = { pendingClose = null }) { Text("Cancel") }
            },
        )
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("CLI Instances", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Launch raw Claude / Codex / Gemini CLI processes on the host and prompt them from here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        item {
            HostContextCard(
                host = state.activeHost,
                presence = state.activeHostPresence,
                onRefreshStatus = if (state.activeHost != null) onRefreshActiveHost else null,
                refreshEnabled = state.isLoading.not(),
            )
        }

        selected?.let { target ->
            item {
                CliSelectedInstanceCard(
                    target = target,
                    followUpInput = state.cliFollowUpInput,
                    canRunCommands = canRunCommands,
                    isLoading = state.isLoading,
                    onFollowUpChanged = onFollowUpChanged,
                    onSendFollowUp = onSendFollowUp,
                )
            }
        }

        if (!hasActiveHost) {
            item {
                Text(
                    "Pair a host first on the Hosts screen.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@LazyColumn
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onRefresh, enabled = state.isLoading.not()) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null)
                    Text(" Refresh")
                }
            }
        }

        if (selected == null) {
            item {
                CliLauncherCard(
                    state = state,
                    canRunCommands = canRunCommands,
                    onPresetChanged = onPresetChanged,
                    onLaunchPromptChanged = onLaunchPromptChanged,
                    onLaunch = onLaunch,
                )
            }
        }

        item {
            Text("Running CLIs", style = MaterialTheme.typography.titleMedium)
        }

        if (state.cliInstances.isEmpty()) {
            item {
                Text(
                    "No CLI instances yet. Launch one above.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(state.cliInstances, key = { it.instanceId }) { instance ->
                CliInstanceRow(
                    instance = instance,
                    selected = instance.instanceId == selected?.instanceId,
                    enabled = state.isLoading.not(),
                    onSelect = { onSelectInstance(instance.instanceId) },
                    onCloseRequested = { pendingClose = instance },
                )
            }
        }

        if (selected != null) {
            item {
                CliLauncherCard(
                    state = state,
                    canRunCommands = canRunCommands,
                    onPresetChanged = onPresetChanged,
                    onLaunchPromptChanged = onLaunchPromptChanged,
                    onLaunch = onLaunch,
                )
            }
        }

    }
}

@Composable
private fun CliLauncherCard(
    state: MagicHatUiState,
    canRunCommands: Boolean,
    onPresetChanged: (String) -> Unit,
    onLaunchPromptChanged: (String) -> Unit,
    onLaunch: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.Terminal, contentDescription = null)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Launch new CLI", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Full permissions + plan mode are enabled by default for each preset.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (state.cliPresets.isEmpty()) {
                Text(
                    if (state.isLoading) "Fetching presets…" else "No presets loaded yet. Tap Refresh to retry.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.cliPresets, key = { it.preset }) { preset ->
                        val isSelected = state.cliSelectedPreset == preset.preset
                        FilterChip(
                            selected = isSelected,
                            onClick = { if (!isSelected) onPresetChanged(preset.preset) },
                            enabled = canRunCommands && state.isLoading.not() && state.cliLaunchInFlight.not(),
                            label = { Text(preset.label) },
                        )
                    }
                }
            }

            OutlinedTextField(
                value = state.cliLaunchPromptInput,
                onValueChange = onLaunchPromptChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Initial prompt (optional)") },
                placeholder = { Text("Task for the CLI to start with") },
                minLines = 2,
                enabled = canRunCommands && state.isLoading.not() && state.cliLaunchInFlight.not(),
            )

            Button(
                onClick = onLaunch,
                enabled = canRunCommands && state.isLoading.not()
                    && state.cliLaunchInFlight.not()
                    && state.cliPresets.isNotEmpty(),
            ) {
                Text(if (state.cliLaunchInFlight) "Launching..." else "Launch CLI")
            }
            if (!canRunCommands) {
                Text(
                    "Host offline — can't launch a CLI right now.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun CliSelectedInstanceCard(
    target: CliInstanceWire,
    followUpInput: String,
    canRunCommands: Boolean,
    isLoading: Boolean,
    onFollowUpChanged: (String) -> Unit,
    onSendFollowUp: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "Active CLI",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "${target.presetLabel} · ${target.status}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(
                    onClick = { clipboard.setText(AnnotatedString(target.output)) },
                    enabled = target.output.isNotBlank(),
                ) {
                    Icon(
                        Icons.Outlined.ContentCopy,
                        contentDescription = "Copy output",
                    )
                }
            }
            val body = target.output.ifBlank { "(no output yet)" }
            Text(
                body,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant,
                        MaterialTheme.shapes.medium,
                    )
                    .padding(12.dp)
                    .heightIn(min = 160.dp, max = 360.dp)
                    .verticalScroll(rememberScrollState()),
            )
            if (target.outputTruncated) {
                val totalKb = target.totalOutputChars / 1024
                Text(
                    "Buffer truncated — $totalKb KB written so far, earlier output dropped.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            OutlinedTextField(
                value = followUpInput,
                onValueChange = onFollowUpChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Send prompt") },
                minLines = 2,
                enabled = canRunCommands && isLoading.not() && target.status == "running",
            )
            Button(
                onClick = onSendFollowUp,
                enabled = canRunCommands && isLoading.not()
                    && followUpInput.isNotBlank() && target.status == "running",
            ) {
                Text("Send")
            }
            if (target.status != "running") {
                Text(
                    "Process is ${target.status}; prompts disabled.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun CliInstanceRow(
    instance: CliInstanceWire,
    selected: Boolean,
    enabled: Boolean,
    onSelect: () -> Unit,
    onCloseRequested: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val fullCommand = remember(instance.command, instance.args) {
        buildString {
            append(instance.command)
            instance.args.forEach { arg ->
                append(' ')
                append(shellQuote(arg))
            }
        }
    }
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
                    label = instance.presetLabel,
                    background = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                StatusChip(
                    label = instance.status,
                    background = when (instance.status) {
                        "running" -> MaterialTheme.colorScheme.secondaryContainer
                        "exited" -> MaterialTheme.colorScheme.surfaceVariant
                        else -> MaterialTheme.colorScheme.errorContainer
                    },
                    contentColor = when (instance.status) {
                        "running" -> MaterialTheme.colorScheme.onSecondaryContainer
                        "exited" -> MaterialTheme.colorScheme.onSurfaceVariant
                        else -> MaterialTheme.colorScheme.onErrorContainer
                    },
                )
                instance.pid?.let {
                    StatusChip(
                        label = "pid $it",
                        background = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                instance.instanceId,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    fullCommand,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { clipboard.setText(AnnotatedString(fullCommand)) }) {
                    Icon(
                        Icons.Outlined.ContentCopy,
                        contentDescription = "Copy command",
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSelect, enabled = enabled && !selected) {
                    Text(if (selected) "Open" else "View")
                }
                OutlinedButton(
                    onClick = onCloseRequested,
                    enabled = enabled && instance.status == "running",
                ) {
                    Text("Close")
                }
            }
        }
    }
}

private fun shellQuote(arg: String): String {
    if (arg.isEmpty()) return "''"
    // If it's already "safe" (alnum + a few shell-harmless chars), leave it alone.
    val safe = arg.all { c -> c.isLetterOrDigit() || c == '-' || c == '_' || c == '/' || c == '.' || c == '=' || c == ':' }
    if (safe) return arg
    // Otherwise wrap in single quotes, escaping any existing single quotes.
    return "'" + arg.replace("'", "'\\''") + "'"
}
