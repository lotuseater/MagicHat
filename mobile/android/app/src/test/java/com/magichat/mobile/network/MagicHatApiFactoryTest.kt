package com.magichat.mobile.network

import org.junit.Assert.assertThrows
import org.junit.Test

class MagicHatApiFactoryTest {
    private val factory = MagicHatApiFactory()

    @Test
    fun relayFactoryRejectsInsecureNonLocalHttp() {
        assertThrows(IllegalArgumentException::class.java) {
            factory.createRelay("http://relay.example", tokenProvider = { null })
        }
    }

    @Test
    fun relayFactoryRejectsUnknownPinsetVersion() {
        assertThrows(IllegalArgumentException::class.java) {
            factory.createRelay(
                "https://relay.example",
                tokenProvider = { null },
                certificatePinsetVersion = "prod-2026-01",
            )
        }
    }

    @Test
    fun relayFactoryAllowsLocalDevelopmentHttp() {
        factory.createRelay("http://10.0.2.2:18795", tokenProvider = { null })
    }

    @Test
    fun relayFactoryAllowsPrivateLanHttp() {
        factory.createRelay("http://192.168.0.104:18795", tokenProvider = { null })
    }
}
