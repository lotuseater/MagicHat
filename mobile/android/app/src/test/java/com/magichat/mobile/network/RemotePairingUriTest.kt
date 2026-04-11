package com.magichat.mobile.network

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

class RemotePairingUriTest {
    @Test
    fun parsesV2PairUri() {
        val exp = Instant.now().plus(5, ChronoUnit.MINUTES).toString()
        val uri = "magichat://pair?v=2&relay=https%3A%2F%2Frelay.example&host_id=host_1&host_name=Office%20PC&bootstrap_token=bt_123&host_fingerprint=sha256%3Atest&exp=$exp"

        val parsed = RemotePairingUri.parse(uri)

        assertThat(parsed.relayUrl).isEqualTo("https://relay.example/")
        assertThat(parsed.hostId).isEqualTo("host_1")
        assertThat(parsed.hostName).isEqualTo("Office PC")
        assertThat(parsed.bootstrapToken).isEqualTo("bt_123")
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsExpiredPairUri() {
        val exp = Instant.now().minus(1, ChronoUnit.MINUTES).toString()
        val uri = "magichat://pair?v=2&relay=https%3A%2F%2Frelay.example&host_id=host_1&host_name=Office%20PC&bootstrap_token=bt_123&host_fingerprint=sha256%3Atest&exp=$exp"

        RemotePairingUri.parse(uri)
    }
}
