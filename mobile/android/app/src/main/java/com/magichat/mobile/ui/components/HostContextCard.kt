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

            Text(host.displayName, style = MaterialTheme.typography.titleSmall)
            Text(
                "${modeLabel(host.mode)}${presenceLabel(presence)}",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(endpointLabel(host), style = MaterialTheme.typography.bodySmall)
            host.deviceId?.takeIf { it.isNotBlank() }?.let {
                Text("Device: $it", style = MaterialTheme.typography.bodySmall)
            }
            activeInstanceId?.takeIf { it.isNotBlank() }?.let {
                Text("Active instance: $it", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun modeLabel(mode: String): String {
    return when (mode.lowercase()) {
        "remote_relay" -> "Remote relay"
        else -> "LAN direct"
    }
}

private fun presenceLabel(presence: String?): String {
    val normalized = presence?.takeIf { it.isNotBlank() } ?: return ""
    return " • ${normalized.replace('_', ' ')}"
}

private fun endpointLabel(host: PairedHostRecord): String {
    return if (host.mode.lowercase() == "remote_relay") {
        "Relay: ${host.relayUrl ?: host.baseUrl}"
    } else {
        "Endpoint: ${host.baseUrl}"
    }
}
