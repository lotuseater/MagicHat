package com.magichat.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
    onRefreshStatus: (() -> Unit)? = null,
    refreshEnabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (host == null) {
                Text("No host selected", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Choose a saved host or pair a new one before launching or controlling Team App.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return@Column
            }

            val canRunCommands = host.canRunCommands(presence)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(host.displayName, style = MaterialTheme.typography.titleMedium)
                    Text(
                        host.endpointLabel(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (onRefreshStatus != null) {
                    Button(
                        onClick = onRefreshStatus,
                        enabled = refreshEnabled,
                    ) {
                        Text("Check")
                    }
                }
            }

            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusChip(
                    label = host.connectionModeLabel(),
                    background = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                StatusChip(
                    label = host.presenceLabel(presence) ?: "unknown",
                    background = if (canRunCommands) Color(0xFF1E5E37) else MaterialTheme.colorScheme.errorContainer,
                    contentColor = if (canRunCommands) Color(0xFFD6F8DF) else MaterialTheme.colorScheme.onErrorContainer,
                )
                activeInstanceId?.takeIf { it.isNotBlank() }?.let {
                    StatusChip(
                        label = "Active $it",
                        background = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }

            host.deviceId?.takeIf { it.isNotBlank() }?.let {
                Text(
                    "Device: $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (!canRunCommands) {
                Text(
                    "This host is offline or unreachable. You can still browse saved hosts, but session actions stay disabled until it reconnects.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
fun StatusChip(
    label: String,
    background: Color,
    contentColor: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = contentColor,
        modifier = modifier
            .background(background, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}
