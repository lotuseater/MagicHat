package com.magichat.mobile.network

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test

class RelayTrustPolicyTest {
    @Test
    fun allowsHttpsRelayUrls() {
        val normalized = RelayTrustPolicy.validateRelayBaseUrl("https://relay.example")

        assertThat(normalized).isEqualTo("https://relay.example/")
    }

    @Test
    fun allowsLoopbackHttpRelayUrlsForDevelopment() {
        val loopback = RelayTrustPolicy.validateRelayBaseUrl("http://127.0.0.1:18795")
        val emulator = RelayTrustPolicy.validateRelayBaseUrl("http://10.0.2.2:18795")

        assertThat(loopback).isEqualTo("http://127.0.0.1:18795/")
        assertThat(emulator).isEqualTo("http://10.0.2.2:18795/")
    }

    @Test
    fun rejectsInsecureNonLocalRelayUrls() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            RelayTrustPolicy.validateRelayBaseUrl("http://relay.example")
        }

        assertThat(error).hasMessageThat().contains("must use HTTPS")
    }

    @Test
    fun acceptsDevInsecurePinsetVersion() {
        assertThat(RelayTrustPolicy.pinsForVersion(null)).isEmpty()
        assertThat(RelayTrustPolicy.pinsForVersion("dev-insecure")).isEmpty()
    }

    @Test
    fun rejectsUnknownPinsetVersion() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            RelayTrustPolicy.pinsForVersion("prod-2026-01")
        }

        assertThat(error).hasMessageThat().contains("Unknown relay certificate pinset version")
    }
}
