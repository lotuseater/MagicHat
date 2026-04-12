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
import com.magichat.mobile.state.MagicHatUiState

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

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
    ) {
        Text("Instance Detail", style = MaterialTheme.typography.titleLarge)
        Text("Stream: ${state.streamStatus}")

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
                    detail.restoreStatePath?.takeIf { it.isNotBlank() }?.let {
                        Text("Restore path: $it")
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
                        Button(onClick = onTrustApproved) {
                            Text("Trust Project")
                        }
                        Button(onClick = onTrustDenied) {
                            Text("Deny")
                        }
                    }
                }
            }
        }

        OutlinedTextField(
            value = state.promptInput,
            onValueChange = onPromptChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Initial prompt") },
        )
        Button(onClick = onSendPrompt) {
            Text("Send Prompt")
        }

        OutlinedTextField(
            value = state.followUpInput,
            onValueChange = onFollowUpChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Follow-up") },
        )
        Button(onClick = onSendFollowUp) {
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
