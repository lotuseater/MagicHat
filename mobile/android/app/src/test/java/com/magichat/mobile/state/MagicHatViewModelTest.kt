package com.magichat.mobile.state

import com.google.common.truth.Truth.assertThat
import com.magichat.mobile.model.BeaconHost
import com.magichat.mobile.model.InstanceDetail
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.SubmissionReceipt
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.storage.PairingSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MagicHatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun pairingStateUpdatesExposeActiveHostContext() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository()
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        val activeHost = pairedHost(
            hostId = "remote-alpha",
            displayName = "Office Mac",
            mode = "remote_relay",
            presence = "online",
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(
                pairedHost(hostId = "lan-bravo", displayName = "Desk PC", presence = "offline"),
                activeHost,
            ),
            activeHostId = activeHost.hostId,
        )
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(state.activeHostId).isEqualTo("remote-alpha")
        assertThat(state.activeHost?.displayName).isEqualTo("Office Mac")
        assertThat(state.activeHostPresence).isEqualTo("online")
        assertThat(state.pairedHosts).hasSize(2)
    }

    @Test
    fun selectPairedHostRefreshesInstancesAndNavigates() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            instancesResult = listOf(instance("instance-1")),
            restoreRefsResult = listOf(KnownRestoreRef(restoreRef = "restore-1", title = "Restore One")),
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = null,
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.selectPairedHost("alpha")
        advanceUntilIdle()

        assertThat(repository.activeHostSelections).containsExactly("alpha")
        assertThat(repository.listInstancesCalls).isEqualTo(1)
        assertThat(repository.listRestoreRefsCalls).isEqualTo(1)
        assertThat(viewModel.uiState.value.screen).isEqualTo(MagicHatScreen.INSTANCES)
        assertThat(viewModel.uiState.value.instances.map { it.instanceId }).containsExactly("instance-1")
        assertThat(viewModel.uiState.value.knownRestoreRefs.map { it.restoreRef }).containsExactly("restore-1")
    }

    @Test
    fun forgetHostClearsSelectedInstanceState() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository()
        repository.removeHostSideEffect = { removed ->
                repository.pairingStateFlow.update { snapshot ->
                    snapshot.copy(
                        pairedHosts = snapshot.pairedHosts.filterNot { it.hostId == removed },
                        activeHostId = null,
                    )
                }
            }
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.updatePrompt("hello")
        viewModel.updateFollowUp("follow up")
        viewModel.openInstance("instance-1")
        advanceUntilIdle()

        viewModel.forgetHost("alpha")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(repository.removedHosts).containsExactly("alpha")
        assertThat(state.activeHost).isNull()
        assertThat(state.activeHostId).isNull()
        assertThat(state.instances).isEmpty()
        assertThat(state.knownRestoreRefs).isEmpty()
        assertThat(state.selectedInstanceId).isNull()
        assertThat(state.selectedDetail).isNull()
        assertThat(state.streamEvents).isEmpty()
        assertThat(state.streamStatus).isEqualTo("idle")
    }

    private fun pairedHost(
        hostId: String,
        displayName: String,
        mode: String = "lan_direct",
        presence: String? = "online",
    ): PairedHostRecord {
        return PairedHostRecord(
            hostId = hostId,
            displayName = displayName,
            baseUrl = "http://127.0.0.1:8787/",
            sessionToken = "session-token",
            pairedAt = "2026-04-13T10:00:00Z",
            mode = mode,
            relayUrl = if (mode == "remote_relay") "https://relay.example.test" else null,
            deviceId = if (mode == "remote_relay") "device-1" else null,
            lastKnownHostPresence = presence,
        )
    }

    private fun instance(id: String): TeamAppInstance {
        return TeamAppInstance(
            instanceId = id,
            title = "MagicHat Task",
            active = true,
            health = "running",
            sessionId = "session-$id",
            restoreRef = "restore-$id",
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
private class FakeMagicHatRepository(
    private val instancesResult: List<TeamAppInstance> = emptyList(),
    private val restoreRefsResult: List<KnownRestoreRef> = emptyList(),
) : MagicHatRepositoryContract {
    val pairingStateFlow = MutableStateFlow(PairingSnapshot(emptyList(), null))
    val activeHostSelections = mutableListOf<String>()
    val removedHosts = mutableListOf<String>()
    var removeHostSideEffect: (String) -> Unit = {}
    var listInstancesCalls = 0
    var listRestoreRefsCalls = 0

    override val pairingState: Flow<PairingSnapshot> = pairingStateFlow

    override suspend fun discoverHosts(baseUrl: String): List<BeaconHost> = emptyList()

    override suspend fun pairHost(baseUrl: String, hostId: String, pairingCode: String, deviceName: String): PairedHostRecord {
        error("Not used in this test")
    }

    override suspend fun pairRemote(pairUri: String, deviceName: String): PairedHostRecord {
        error("Not used in this test")
    }

    override suspend fun setActiveHost(hostId: String) {
        activeHostSelections += hostId
        pairingStateFlow.update { snapshot ->
            val active = snapshot.pairedHosts.firstOrNull { it.hostId == hostId }
            snapshot.copy(
                activeHostId = hostId,
                pairedHosts = if (active != null) {
                    snapshot.pairedHosts.map { host ->
                        if (host.hostId == hostId) host.copy(lastKnownHostPresence = active.lastKnownHostPresence ?: "online") else host
                    }
                } else {
                    snapshot.pairedHosts
                },
            )
        }
    }

    override suspend fun removeHost(hostId: String) {
        removedHosts += hostId
        removeHostSideEffect(hostId)
    }

    override suspend fun listInstances(): List<TeamAppInstance> {
        listInstancesCalls += 1
        return instancesResult
    }

    override suspend fun listKnownRestoreRefs(): List<KnownRestoreRef> {
        listRestoreRefsCalls += 1
        return restoreRefsResult
    }

    override suspend fun getInstanceDetail(instanceId: String): InstanceDetail {
        return InstanceDetail(instance = instance(instanceId))
    }

    override suspend fun launchInstance(title: String?): InstanceDetail {
        error("Not used in this test")
    }

    override suspend fun closeInstance(instanceId: String) = Unit

    override suspend fun sendPrompt(instanceId: String, prompt: String): SubmissionReceipt {
        return SubmissionReceipt(status = "ok")
    }

    override suspend fun sendFollowUp(instanceId: String, followUp: String): SubmissionReceipt {
        return SubmissionReceipt(status = "ok")
    }

    override suspend fun answerTrustPrompt(instanceId: String, approved: Boolean): SubmissionReceipt {
        return SubmissionReceipt(status = "ok")
    }

    override suspend fun restoreSession(restoreSelector: String): InstanceDetail {
        return InstanceDetail(instance = instance("restored"))
    }

    override fun observeInstanceEvents(
        instanceId: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        onState("connected")
    }

    override fun stopInstanceEvents() = Unit

    private fun instance(id: String): TeamAppInstance {
        return TeamAppInstance(
            instanceId = id,
            title = "MagicHat Task",
            active = true,
            health = "running",
            sessionId = "session-$id",
            restoreRef = "restore-$id",
        )
    }
}
