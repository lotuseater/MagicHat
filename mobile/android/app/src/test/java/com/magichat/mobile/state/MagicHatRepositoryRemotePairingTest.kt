package com.magichat.mobile.state

import com.google.common.truth.Truth.assertThat
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.network.MagicHatApiFactory
import com.magichat.mobile.security.DeviceIdentity
import com.magichat.mobile.security.DeviceKeyStoreContract
import com.magichat.mobile.storage.PairingSnapshot
import com.magichat.mobile.storage.PairingStoreContract
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.Signature
import java.time.Instant
import java.util.Base64
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Test

class MagicHatRepositoryRemotePairingTest {
    private val server = MockWebServer()

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun pairRemoteRetriesTransientClaimStatusFailure() = runBlocking {
        var claimStatusCalls = 0
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return when {
                    request.method == "POST" && request.path == "/v2/mobile/pair/bootstrap/claim" -> {
                        MockResponse()
                            .setResponseCode(202)
                            .setBody(
                                """
                                {
                                  "claim_id": "claim_123",
                                  "status": "pending_approval",
                                  "host_id": "host_123",
                                  "host_name": "Dev Box"
                                }
                                """.trimIndent(),
                            )
                    }

                    request.method == "GET" && request.path == "/v2/mobile/pair/bootstrap/claims/claim_123" -> {
                        claimStatusCalls += 1
                        if (claimStatusCalls == 1) {
                            MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)
                        } else {
                            MockResponse()
                                .setResponseCode(200)
                                .setBody(
                                    """
                                    {
                                      "claim_id": "claim_123",
                                      "status": "approved",
                                      "challenge": "challenge_123",
                                      "host_id": "host_123",
                                      "host_name": "Dev Box"
                                    }
                                    """.trimIndent(),
                                )
                        }
                    }

                    request.method == "POST" && request.path == "/v2/mobile/pair/device/register" -> {
                        MockResponse()
                            .setResponseCode(201)
                            .setBody(
                                """
                                {
                                  "host_id": "host_123",
                                  "host_name": "Dev Box",
                                  "device_id": "device_123",
                                  "access_token": "at_123",
                                  "access_token_expires_at": "2026-04-18T02:00:00Z",
                                  "refresh_token": "rt_123",
                                  "refresh_token_expires_at": "2026-05-18T02:00:00Z",
                                  "certificate_pinset_version": "dev-insecure"
                                }
                                """.trimIndent(),
                            )
                    }

                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        val store = InMemoryPairingStore()
        val repository = MagicHatRepository(
            pairingStore = store,
            deviceKeyStore = InMemoryDeviceKeyStore(),
            apiFactory = MagicHatApiFactory(),
        )

        val paired = repository.pairRemote(
            pairUri = pairUri(server.url("/").toString()),
            deviceName = "MagicHat Android",
        )

        assertThat(claimStatusCalls).isEqualTo(2)
        assertThat(paired.hostId).isEqualTo("host_123")
        assertThat(paired.displayName).isEqualTo("Dev Box")
        assertThat(store.readSnapshot().activeHostId).isEqualTo("host_123")
    }

    @Test
    fun pairRemoteShowsHelpfulMessageForUsedBootstrapToken() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return if (request.method == "POST" && request.path == "/v2/mobile/pair/bootstrap/claim") {
                    MockResponse()
                        .setResponseCode(409)
                        .setBody("""{"error":"bootstrap_token_used"}""")
                } else {
                    MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        val repository = MagicHatRepository(
            pairingStore = InMemoryPairingStore(),
            deviceKeyStore = InMemoryDeviceKeyStore(),
            apiFactory = MagicHatApiFactory(),
        )

        val error = runCatching {
            repository.pairRemote(
                pairUri = pairUri(server.url("/").toString()),
                deviceName = "MagicHat Android",
            )
        }.exceptionOrNull()

        assertThat(error).isInstanceOf(IllegalStateException::class.java)
        assertThat(error?.message).isEqualTo("This pairing QR was already used. Generate a fresh QR on the host.")
    }

    private fun pairUri(relayBaseUrl: String): String {
        val expiresAt = Instant.now().plusSeconds(600).toString()
        return buildString {
            append("magichat://pair?")
            append("v=2")
            append("&relay=")
            append(java.net.URLEncoder.encode(relayBaseUrl.trimEnd('/'), "UTF-8"))
            append("&host_id=host_123")
            append("&host_name=Dev+Box")
            append("&bootstrap_token=token_123")
            append("&host_fingerprint=sha256:test")
            append("&exp=")
            append(java.net.URLEncoder.encode(expiresAt, "UTF-8"))
        }
    }

    private class InMemoryPairingStore : PairingStoreContract {
        private val stateFlow = MutableStateFlow(PairingSnapshot(emptyList(), null))

        override val state: Flow<PairingSnapshot> = stateFlow

        override suspend fun readSnapshot(): PairingSnapshot = stateFlow.value

        override suspend fun upsert(record: PairedHostRecord) {
            val nextHosts = stateFlow.value.pairedHosts
                .filterNot { it.hostId == record.hostId }
                .plus(record)
            stateFlow.value = PairingSnapshot(
                pairedHosts = nextHosts,
                activeHostId = record.hostId,
            )
        }

        override suspend fun setActiveHost(hostId: String) {
            stateFlow.value = stateFlow.value.copy(activeHostId = hostId)
        }

        override suspend fun removeHost(hostId: String) {
            val remaining = stateFlow.value.pairedHosts.filterNot { it.hostId == hostId }
            stateFlow.value = PairingSnapshot(
                pairedHosts = remaining,
                activeHostId = if (stateFlow.value.activeHostId == hostId) remaining.firstOrNull()?.hostId else stateFlow.value.activeHostId,
            )
        }
    }

    private class InMemoryDeviceKeyStore : DeviceKeyStoreContract {
        private var keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        private var identity = DeviceIdentity(
            deviceId = "android-test",
            publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.public.encoded),
        )

        override fun getOrCreate(): DeviceIdentity = identity

        override fun sign(message: String): String {
            val signature = Signature.getInstance("Ed25519")
            signature.initSign(keyPair.private)
            signature.update(message.toByteArray(StandardCharsets.UTF_8))
            return Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign())
        }

        override fun clear() {
            keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
            identity = DeviceIdentity(
                deviceId = "android-test-${Instant.now().epochSecond}",
                publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.public.encoded),
            )
        }
    }
}
