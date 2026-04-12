package com.magichat.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.state.MagicHatUiState
import com.magichat.mobile.ui.components.HostContextCard

@Composable
fun InstanceDetailScreen(
    state: MagicHatUiState,
    onPromptChanged: (String) -> Unit,
    onFollowUpChanged: (String) -> Unit,
    onSendPrompt: () -> Unit,
    onSendFollowUp: () -> Unit,
    onTrustApproved: () -> Unit,
    onTrustDenied: () -> Unit,
) {
    val detail = state.selectedDetail
    val canRunCommands = state.activeHost?.canRunCommands(state.activeHostPresence) == true
    val canSendPrompt = state.selectedInstanceId != null && state.promptInput.isNotBlank() && state.isLoading.not() && canRunCommands
    val canSendFollowUp = state.selectedInstanceId != null && state.followUpInput.isNotBlank() && state.isLoading.not() && canRunCommands

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
    ) {
        Text("Instance Detail", style = MaterialTheme.typography.titleLarge)
        Text("Stream: ${state.streamStatus}")
        HostContextCard(
            host = state.activeHost,
            presence = state.activeHostPresence,
            activeInstanceId = state.selectedInstanceId,
        )
        if (state.selectedInstanceId != null && !canRunCommands) {
            Text(
                "The active host is offline. Prompt, follow-up, and trust actions will resume once that host reconnects.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        if (detail != null) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(detail.instance.title, style = MaterialTheme.typography.titleMedium)
                    Text("ID: ${detail.instance.instanceId}")
                    Text("Health: ${detail.instance.health}")
                    Text("Status: ${detail.status}")
                    detail.trustStatus?.takeIf { it.isNotBlank() }?.let {
                        Text("Trust: $it")
                    }
                    detail.instance.sessionId?.takeIf { it.isNotBlank() }?.let {
                        Text("Session: $it")
                    }
                    detail.progress?.let { progress ->
                        Text("Progress: ${progress.completedSteps ?: 0}/${progress.totalSteps ?: 0} ${progress.stepLabel ?: ""}")
                    }
                    if (!detail.latestOutput.isNullOrBlank()) {
                        Text("Latest output:")
                        Text(detail.latestOutput)
                    }
                    detail.restoreRef?.takeIf { it.isNotBlank() }?.let {
                        Text("Restore ref: $it")
                    }
                }
            }

            if (detail.trustStatus == "prompt_required") {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Team App is waiting for project trust", style = MaterialTheme.typography.titleSmall)
                        detail.pendingTrustProject?.takeIf { it.isNotBlank() }?.let {
                            Text(it)
                        }
                        Text(
                            "Approve the project on this phone so the task can keep moving.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Button(onClick = onTrustApproved, enabled = state.isLoading.not() && canRunCommands) {
                            Text("Trust Project")
                        }
                        Button(onClick = onTrustDenied, enabled = state.isLoading.not() && canRunCommands) {
                            Text("Deny")
                        }
                    }
                }
            }
        } else {
            Text(
                "Pick an instance from the Instances screen before sending prompts or follow-ups.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        OutlinedTextField(
            value = state.promptInput,
            onValueChange = onPromptChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Initial prompt") },
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
            enabled = state.selectedInstanceId != null && state.isLoading.not() && canRunCommands,
        )
        Button(onClick = onSendFollowUp, enabled = canSendFollowUp) {
            Text("Send Follow-up")
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .padding(10.dp)
                    .heightIn(min = 120.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("Output stream", style = MaterialTheme.typography.titleSmall)
                if (state.streamEvents.isEmpty()) {
                    Text("No events yet")
                }
                state.streamEvents.forEach { event ->
                    val line = listOfNotNull(
                        event.updatedAt,
                        event.type,
                        event.health,
                        event.message,
                        event.outputChunk,
                    ).joinToString(" | ")
                    Text(line)
                }
            }
        }
    }
}
