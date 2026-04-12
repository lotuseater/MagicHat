package com.magichat.mobile.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.canRunCommands
import com.magichat.mobile.model.connectionModeLabel
import com.magichat.mobile.model.endpointLabel
import com.magichat.mobile.model.presenceLabel

@Composable
fun HostContextCard(
    host: PairedHostRecord?,
    presence: String?,
    activeInstanceId: String? = null,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (host == null) {
                Text("No host selected", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Pair with or select a Team App host before launching, restoring, or sending prompts.",
                    style = MaterialTheme.typography.bodySmall,
                )
                return@Column
            }

            val canRunCommands = host.canRunCommands(presence)
            Text(host.displayName, style = MaterialTheme.typography.titleSmall)
            Text(
                buildString {
                    append(host.connectionModeLabel())
                    host.presenceLabel(presence)?.let { append(" • ").append(it) }
                },
                style = MaterialTheme.typography.bodySmall,
            )
            Text(host.endpointLabel(), style = MaterialTheme.typography.bodySmall)
            host.deviceId?.takeIf { it.isNotBlank() }?.let {
                Text("Device: $it", style = MaterialTheme.typography.bodySmall)
            }
            activeInstanceId?.takeIf { it.isNotBlank() }?.let {
                Text("Active instance: $it", style = MaterialTheme.typography.bodySmall)
            }
            if (!canRunCommands) {
                Text(
                    "This host is offline right now. You can still manage pairings, but Team App commands are paused until it reconnects.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
