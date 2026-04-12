package com.magichat.mobile.state

import com.google.common.truth.Truth.assertThat
import com.magichat.mobile.network.MagicHatApiFactory
import com.magichat.mobile.network.MoshiFactory
import com.magichat.mobile.security.DeviceIdentity
import com.magichat.mobile.security.DeviceKeyStoreContract
import com.magichat.mobile.storage.PairingSnapshot
import com.magichat.mobile.storage.PairingStoreContract
import com.squareup.moshi.Json
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.Signature
import java.time.Instant
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

class MagicHatRepositoryRemoteClientSmokeTest {
    private data class FixtureInfo(
        @Json(name = "relay_url") val relayUrl: String,
        @Json(name = "host_base_url") val hostBaseUrl: String,
    )

    private data class BootstrapResponse(
        @Json(name = "pair_uri") val pairUri: String,
    )

    private val fixtureAdapter = MoshiFactory.instance.adapter(FixtureInfo::class.java)
    private val bootstrapAdapter = MoshiFactory.instance.adapter(BootstrapResponse::class.java)
    private val okHttp = OkHttpClient()

    private var fixtureProcess: Process? = null

    @Before
    fun setUp() {
        assumeTrue(
            "Remote client smoke is enabled only via dedicated script/CI",
            System.getenv("MAGICHAT_ENABLE_REMOTE_CLIENT_SMOKE") == "true",
        )
    }

    @After
    fun tearDown() {
        fixtureProcess?.destroy()
        fixtureProcess?.waitFor(5, TimeUnit.SECONDS)
        if (fixtureProcess?.isAlive == true) {
            fixtureProcess?.destroyForcibly()
        }
        fixtureProcess = null
    }

    @Test
    fun pairAndDriveRemoteRuntimeAgainstLiveFixture() = runBlocking {
        val fixture = startFixture()
        val repository = MagicHatRepository(
            pairingStore = InMemoryPairingStore(),
            deviceKeyStore = InMemoryDeviceKeyStore(),
            apiFactory = MagicHatApiFactory(),
        )

        val pairUri = fetchPairUri(fixture.hostBaseUrl)
        val paired = repository.pairRemote(pairUri, "Android JVM Smoke")
        assertThat(paired.mode).isEqualTo("remote_relay")
        assertThat(paired.hostId).isNotEmpty()
        assertThat(paired.sessionToken).isNotEmpty()

        val instances = repository.listInstances()
        assertThat(instances).isNotEmpty()
        val instance = instances.first()
        assertThat(instance.restoreRef).isNotNull()

        val restoreRefs = repository.listKnownRestoreRefs()
        assertThat(restoreRefs).isNotEmpty()

        val detail = repository.getInstanceDetail(instance.instanceId)
        assertThat(detail.trustStatus).isEqualTo("prompt_required")
        assertThat(detail.pendingTrustProject).isEqualTo("MagicHat")

        val restored = repository.restoreSession(restoreRefs.first().restoreRef)
        assertThat(restored.instance.instanceId).isEqualTo("wizard_team_app_999_2000")

        val prompt = repository.sendPrompt(instance.instanceId, "Summarize current blockers.")
        assertThat(prompt.status).isEqualTo("ok")

        val followUp = repository.sendFollowUp(instance.instanceId, "Propose the smallest next fix.")
        assertThat(followUp.status).isEqualTo("ok")

        val trust = repository.answerTrustPrompt(instance.instanceId, approved = true)
        assertThat(trust.status).isEqualTo("ok")

        val states = mutableListOf<String>()
        val messages = mutableListOf<String>()
        val latch = CountDownLatch(1)
        repository.observeInstanceEvents(
            instanceId = instance.instanceId,
            onEvent = {
                val message = it.message ?: ""
                messages += message
                if (message.contains("worker finished")) {
                    latch.countDown()
                }
            },
            onState = { states += it },
        )
        try {
            assertThat(latch.await(10, TimeUnit.SECONDS)).isTrue()
        } finally {
            repository.stopInstanceEvents()
        }
        assertThat(states).contains("connected")
        assertThat(messages.any { it.contains("worker finished") }).isTrue()

        repository.closeInstance(instance.instanceId)
    }

    private fun startFixture(): FixtureInfo {
        val userDir = System.getProperty("user.dir") ?: error("user.dir is unavailable")
        val repoRoot = findRepoRoot(File(userDir).absoluteFile)
        val nodeBinary = System.getenv("MAGICHAT_NODE_BINARY") ?: "node"
        val script = File(repoRoot, "scripts/remote-validation/start_remote_stack_fixture.mjs")
        val process = ProcessBuilder(nodeBinary, script.absolutePath)
            .directory(repoRoot)
            .redirectErrorStream(true)
            .start()
        fixtureProcess = process

        val reader = process.inputStream.bufferedReader(StandardCharsets.UTF_8)
        while (true) {
            val line = reader.readLine() ?: error("Remote fixture exited before announcing ports")
            val parsed = runCatching { fixtureAdapter.fromJson(line) }.getOrNull()
            if (parsed != null) {
                return parsed
            }
            if (!process.isAlive) {
                error("Remote fixture failed to start: $line")
            }
        }
    }

    private fun fetchPairUri(hostBaseUrl: String): String {
        val request = Request.Builder()
            .url("${hostBaseUrl.trimEnd('/')}/admin/v2/remote/bootstrap")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()
        okHttp.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Bootstrap request failed with ${response.code}" }
            val body = response.body?.string().orEmpty()
            val parsed = bootstrapAdapter.fromJson(body) ?: error("Bootstrap response was empty")
            return parsed.pairUri
        }
    }

    private fun findRepoRoot(start: File): File {
        var current: File? = start
        while (current != null) {
            if (File(current, "scripts/remote-validation/start_remote_stack_fixture.mjs").isFile) {
                return current
            }
            current = current.parentFile
        }
        error("Could not locate MagicHat repo root from ${start.absolutePath}")
    }

    private class InMemoryPairingStore : PairingStoreContract {
        private val stateFlow = MutableStateFlow(PairingSnapshot(emptyList(), null))

        override val state: Flow<PairingSnapshot> = stateFlow

        override suspend fun readSnapshot(): PairingSnapshot = stateFlow.value

        override suspend fun upsert(record: com.magichat.mobile.model.PairedHostRecord) {
            val nextHosts = stateFlow.value.pairedHosts
                .filterNot { it.hostId == record.hostId }
                .plus(record)
                .sortedBy { it.displayName.lowercase() }
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
            deviceId = "android-jvm-smoke",
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
                deviceId = "android-jvm-smoke-${Instant.now().epochSecond}",
                publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.public.encoded),
            )
        }
    }
}
