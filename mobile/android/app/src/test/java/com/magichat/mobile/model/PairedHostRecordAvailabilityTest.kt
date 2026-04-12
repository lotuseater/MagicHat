package com.magichat.mobile.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PairedHostRecordAvailabilityTest {
    @Test
    fun remoteOfflineHostCannotRunCommands() {
        val host = pairedHost(
            mode = "remote_relay",
            presence = "offline",
        )

        assertThat(host.canRunCommands()).isFalse()
        assertThat(host.connectionModeLabel()).isEqualTo("Remote relay")
        assertThat(host.presenceLabel()).isEqualTo("offline")
        assertThat(host.endpointLabel()).isEqualTo("Relay: https://relay.example.test")
    }

    @Test
    fun localHostWithoutPresenceStillAllowsCommands() {
        val host = pairedHost(
            mode = "lan_direct",
            presence = null,
        )

        assertThat(host.canRunCommands()).isTrue()
        assertThat(host.connectionModeLabel()).isEqualTo("LAN direct")
        assertThat(host.endpointLabel()).isEqualTo("Endpoint: http://127.0.0.1:8787/")
    }

    @Test
    fun overridePresenceTakesPriority() {
        val host = pairedHost(
            mode = "remote_relay",
            presence = "online",
        )

        assertThat(host.canRunCommands("disconnected")).isFalse()
        assertThat(host.presenceLabel("needs_attention")).isEqualTo("needs attention")
    }

    private fun pairedHost(mode: String, presence: String?): PairedHostRecord {
        return PairedHostRecord(
            hostId = "host-1",
            displayName = "Office Host",
            baseUrl = "http://127.0.0.1:8787/",
            sessionToken = "token",
            pairedAt = "2026-04-13T10:00:00Z",
            mode = mode,
            relayUrl = if (mode == "remote_relay") "https://relay.example.test" else null,
            lastKnownHostPresence = presence,
        )
    }
}
