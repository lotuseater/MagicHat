package com.magichat.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard
import com.magichat.mobile.ui.components.StatusChip

private enum class DetailTab(val label: String) {
    OVERVIEW("Overview"),
    CHAT("Chat"),
    TEAM("Team"),
    STREAM("Stream"),
}

@Composable
fun InstanceDetailScreen(
    state: MagicHatUiState,
    onPromptChanged: (String) -> Unit,
    onFollowUpChanged: (String) -> Unit,
    onSendPrompt: () -> Unit,
    onSendFollowUp: () -> Unit,
    onTrustApproved: () -> Unit,
    onTrustDenied: () -> Unit,
    onSelectTerminalAgent: (String) -> Unit,
    onRefreshActiveHost: () -> Unit,
) {
    val detail = state.selectedDetail
    val canRunCommands = state.activeHost?.canRunCommands(state.activeHostPresence) == true
    val canSendPrompt = state.selectedInstanceId != null && state.promptInput.isNotBlank() && state.isLoading.not() && canRunCommands
    val canSendFollowUp = state.selectedInstanceId != null && state.followUpInput.isNotBlank() && state.isLoading.not() && canRunCommands
    var activeTab by remember(detail?.instance?.instanceId) { mutableStateOf(DetailTab.OVERVIEW) }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Session", style = MaterialTheme.typography.headlineSmall)
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

        if (state.selectedInstanceId != null && !canRunCommands) {
            item {
                Text(
                    "The active host is offline. Prompt, follow-up, and trust actions will resume when the host reconnects.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

        if (detail == null) {
            item {
                Text(
                    "Pick a session from the Sessions screen before sending prompts or reviewing the team output.",
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            return@LazyColumn
        }

        if (detail.trustStatus == "prompt_required") {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Project Trust Required", style = MaterialTheme.typography.titleMedium)
                        detail.pendingTrustProject?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium)
                        }
                        Text(
                            "Approve or deny trust here so the session can continue without going back to the PC.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onTrustApproved, enabled = state.isLoading.not() && canRunCommands) {
                                Text("Trust Project")
                            }
                            OutlinedButton(onClick = onTrustDenied, enabled = state.isLoading.not() && canRunCommands) {
                                Text("Deny")
                            }
                        }
                    }
                }
            }
        }

        item {
            PromptActionsCard(
                state = state,
                canRunCommands = canRunCommands,
                canSendPrompt = canSendPrompt,
                canSendFollowUp = canSendFollowUp,
                onPromptChanged = onPromptChanged,
                onFollowUpChanged = onFollowUpChanged,
                onSendPrompt = onSendPrompt,
                onSendFollowUp = onSendFollowUp,
            )
        }

        item {
            ScrollableTabRow(selectedTabIndex = activeTab.ordinal) {
                DetailTab.entries.forEach { tab ->
                    Tab(
                        selected = activeTab == tab,
                        onClick = { activeTab = tab },
                        text = { Text(tab.label) },
                    )
                }
            }
        }

        when (activeTab) {
            DetailTab.OVERVIEW -> {
                item { OverviewTab(detail, state.streamStatus) }
            }

            DetailTab.CHAT -> {
                if (detail.chat.isEmpty()) {
                    item { EmptyDetailState("No chat transcript yet.") }
                } else {
                    items(detail.chat.indices.toList()) { index ->
                        ChatEntryCard(detail.chat[index])
                    }
                }
            }

            DetailTab.TEAM -> {
                item {
                    TeamTab(
                        state = state,
                        onSelectTerminalAgent = onSelectTerminalAgent,
                    )
                }
            }

            DetailTab.STREAM -> {
                if (state.streamEvents.isEmpty()) {
                    item { EmptyDetailState("No non-heartbeat stream events yet.") }
                } else {
                    item {
                        StreamTab(state.streamEvents)
                    }
                }
            }
        }
    }
}

@Composable
private fun PromptActionsCard(
    state: MagicHatUiState,
    canRunCommands: Boolean,
    canSendPrompt: Boolean,
    canSendFollowUp: Boolean,
    onPromptChanged: (String) -> Unit,
    onFollowUpChanged: (String) -> Unit,
    onSendPrompt: () -> Unit,
    onSendFollowUp: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Actions", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = state.promptInput,
                onValueChange = onPromptChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Initial Prompt") },
                minLines = 2,
                enabled = state.selectedInstanceId != null && state.isLoading.not() && canRunCommands,
            )
            Button(onClick = onSendPrompt, enabled = canSendPrompt) {
                Text("Send Prompt")
            }

            OutlinedTextField(
                value = state.followUpInput,
                onValueChange = onFollowUpChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Follow-up") },
                minLines = 2,
                enabled = state.selectedInstanceId != null && state.isLoading.not() && canRunCommands,
            )
            Button(onClick = onSendFollowUp, enabled = canSendFollowUp) {
                Text("Send Follow-up")
            }
        }
    }
}

@Composable
private fun OverviewTab(detail: com.magichat.mobile.model.InstanceDetail, streamStatus: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(detail.instance.title, style = MaterialTheme.typography.titleLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(
                    label = detail.instance.health,
                    background = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                StatusChip(
                    label = detail.status,
                    background = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                StatusChip(
                    label = "stream $streamStatus",
                    background = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("ID: ${detail.instance.instanceId}", style = MaterialTheme.typography.bodySmall)
            detail.instance.sessionId?.takeIf { it.isNotBlank() }?.let {
                Text("Session: $it", style = MaterialTheme.typography.bodySmall)
            }
            detail.progress?.let { progress ->
                Text(
                    "Progress: ${progress.completedSteps ?: 0}/${progress.totalSteps ?: 0} ${progress.stepLabel ?: ""}",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            detail.summaryText?.takeIf { it.isNotBlank() }?.let {
                Text("Summary", style = MaterialTheme.typography.titleMedium)
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
            detail.latestOutput?.takeIf { it.isNotBlank() }?.let {
                Text("Latest Output", style = MaterialTheme.typography.titleMedium)
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
            detail.restoreRef?.takeIf { it.isNotBlank() }?.let {
                Text("Restore ref: $it", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun TeamTab(
    state: MagicHatUiState,
    onSelectTerminalAgent: (String) -> Unit,
) {
    val detail = state.selectedDetail ?: return
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Team Structure", style = MaterialTheme.typography.titleMedium)
            if (detail.terminalsByAgent.isEmpty()) {
                Text(
                    "No terminal data yet for this session.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return@Column
            }
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                detail.terminalsByAgent.keys.sorted().forEach { agentId ->
                    val selected = state.selectedTerminalAgent == agentId
                    val agentLabel = displayAgentName(agentId)
                    OutlinedButton(
                        onClick = { onSelectTerminalAgent(agentId) },
                        enabled = !selected && state.isLoading.not(),
                    ) {
                        Text(if (selected) "$agentLabel selected" else agentLabel)
                    }
                }
            }
            state.selectedTerminalAgent?.let { agentId ->
                detail.terminalsByAgent[agentId]?.let { terminal ->
                    Text("Terminal: ${displayAgentName(agentId)}", style = MaterialTheme.typography.titleSmall)
                    Text(
                        terminal,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.medium)
                            .padding(12.dp)
                            .heightIn(min = 180.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun StreamTab(events: List<InstanceEvent>) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Output Stream", style = MaterialTheme.typography.titleMedium)
            Text(
                events.joinToString("\n") { formatEventLine(it) },
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.medium)
                    .padding(12.dp)
                    .heightIn(min = 180.dp),
            )
        }
    }
}

@Composable
private fun ChatEntryCard(entry: Map<String, Any?>) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val speaker = listOf("sender", "role", "agent_id")
                .firstNotNullOfOrNull { key -> entry[key]?.toString()?.takeIf { it.isNotBlank() } }
                ?: "message"
            Text(displayAgentName(speaker), style = MaterialTheme.typography.titleSmall)
            Text(
                listOf("text", "message", "content")
                    .firstNotNullOfOrNull { key -> entry[key]?.toString()?.takeIf { it.isNotBlank() } }
                    ?: entry.toString(),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun EmptyDetailState(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

private fun formatEventLine(event: InstanceEvent): String {
    return listOfNotNull(
        event.updatedAt,
        event.type,
        event.health,
        event.message,
        event.outputChunk,
    ).joinToString(" | ")
}

private fun displayAgentName(value: String): String {
    return when (value.lowercase()) {
        "erasmus" -> "Erasmus"
        "fenrus" -> "Fenrus"
        else -> value
    }
}
