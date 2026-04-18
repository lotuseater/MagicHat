package com.magichat.mobile.state

import com.google.common.truth.Truth.assertThat
import com.magichat.mobile.model.BeaconHost
import com.magichat.mobile.model.CliPreset
import com.magichat.mobile.model.CliInstanceWire
import com.magichat.mobile.model.FenrusLauncherOption
import com.magichat.mobile.model.InstanceDetail
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.LauncherPresetOption
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.SubmissionReceipt
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.model.TeamModeOption
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
    fun selectPairedHostClearsStaleSelectedInstanceState() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            instancesResult = listOf(instance("remote-1")),
            restoreRefsResult = listOf(KnownRestoreRef(restoreRef = "restore-remote", title = "Remote Restore")),
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(
                pairedHost(hostId = "alpha", displayName = "Office Mac"),
                pairedHost(hostId = "remote", displayName = "Remote Mac"),
            ),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.updatePrompt("hello")
        viewModel.updateFollowUp("follow up")
        viewModel.updateRestoreSession("restore-alpha")
        viewModel.openInstance("instance-1")
        advanceUntilIdle()

        viewModel.selectPairedHost("remote")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(state.activeHostId).isEqualTo("remote")
        assertThat(state.selectedInstanceId).isNull()
        assertThat(state.selectedDetail).isNull()
        assertThat(state.streamEvents).isEmpty()
        assertThat(state.streamStatus).isEqualTo("idle")
        assertThat(state.promptInput).isEmpty()
        assertThat(state.followUpInput).isEmpty()
        assertThat(state.restoreSessionInput).isEmpty()
        assertThat(state.instances.map { it.instanceId }).containsExactly("remote-1")
        assertThat(repository.stopInstanceEventsCalls).isAtLeast(1)
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

    @Test
    fun forgetHostFallsBackToRemainingHostAndReloadsInstances() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            instancesResult = listOf(instance("fallback-1")),
            restoreRefsResult = listOf(KnownRestoreRef(restoreRef = "restore-fallback", title = "Fallback Restore")),
        )
        repository.removeHostSideEffect = { removed ->
            repository.pairingStateFlow.update { snapshot ->
                snapshot.copy(
                    pairedHosts = snapshot.pairedHosts.filterNot { it.hostId == removed },
                    activeHostId = "bravo",
                )
            }
        }
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(
                pairedHost(hostId = "alpha", displayName = "Office Mac"),
                pairedHost(hostId = "bravo", displayName = "Desk PC"),
            ),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.openInstance("instance-1")
        advanceUntilIdle()
        viewModel.forgetHost("alpha")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(state.activeHostId).isEqualTo("bravo")
        assertThat(state.instances.map { it.instanceId }).containsExactly("fallback-1")
        assertThat(state.knownRestoreRefs.map { it.restoreRef }).containsExactly("restore-fallback")
        assertThat(state.selectedInstanceId).isNull()
        assertThat(state.selectedDetail).isNull()
        assertThat(repository.listInstancesCalls).isEqualTo(1)
        assertThat(repository.listRestoreRefsCalls).isEqualTo(1)
    }

    @Test
    fun refreshActiveHostStatusUpdatesPresenceFromRepository() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository()
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac", presence = "offline")),
            activeHostId = "alpha",
        )
        repository.refreshActiveHostSideEffect = {
            repository.pairingStateFlow.update { snapshot ->
                snapshot.copy(
                    pairedHosts = snapshot.pairedHosts.map { host ->
                        if (host.hostId == "alpha") host.copy(lastKnownHostPresence = "online") else host
                    },
                )
            }
        }
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.refreshActiveHostStatus()
        advanceUntilIdle()

        assertThat(repository.refreshActiveHostCalls).isEqualTo(1)
        assertThat(viewModel.uiState.value.activeHostPresence).isEqualTo("online")
    }

    @Test
    fun pairRemoteFromUriPairsImmediatelyAndNavigates() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            instancesResult = listOf(instance("remote-1")),
            restoreRefsResult = listOf(KnownRestoreRef(restoreRef = "restore-remote-1", title = "Remote Restore")),
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac", mode = "remote_relay")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.pairRemoteFromUri("  magichat://pair?relay=https%3A%2F%2Frelay.example.test&claim_id=claim123  ")
        advanceUntilIdle()

        assertThat(repository.pairRemoteCalls).containsExactly(
            RemotePairInvocation(
                pairUri = "magichat://pair?relay=https%3A%2F%2Frelay.example.test&claim_id=claim123",
                deviceName = "MagicHat Android",
            ),
        )
        val state = viewModel.uiState.value
        assertThat(state.screen).isEqualTo(MagicHatScreen.INSTANCES)
        assertThat(state.remotePairUriInput).isEmpty()
        assertThat(state.instances.map { it.instanceId }).containsExactly("remote-1")
        assertThat(state.knownRestoreRefs.map { it.restoreRef }).containsExactly("restore-remote-1")
    }

    @Test
    fun launchInstancePassesStartupProfileSelectionsAndResetsControls() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            instancesResult = listOf(instance("launched-1")),
            restoreRefsResult = listOf(KnownRestoreRef(restoreRef = "restore-launched", title = "Launch Restore")),
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        repository.launchInstanceResult = InstanceDetail(instance = instance("launched-1"))
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.updateLaunchTitle("Hej")
        viewModel.updateLaunchTeamMode(TeamModeOption.FULL)
        viewModel.updateLaunchLauncherPreset(LauncherPresetOption.CODEX)
        viewModel.updateLaunchFenrusLauncher(FenrusLauncherOption.DEFAULT)
        viewModel.launchInstance()
        advanceUntilIdle()

        assertThat(repository.launchInstanceCalls).containsExactly(
            LaunchInvocation(
                title = "Hej",
                teamMode = TeamModeOption.FULL,
                launcherPreset = LauncherPresetOption.CODEX,
                fenrusLauncher = FenrusLauncherOption.DEFAULT,
            ),
        )
        val state = viewModel.uiState.value
        assertThat(state.screen).isEqualTo(MagicHatScreen.INSTANCE_DETAIL)
        assertThat(state.launchTitleInput).isEmpty()
        assertThat(state.launchTeamMode).isEqualTo(TeamModeOption.APP_DEFAULT)
        assertThat(state.launchLauncherPreset).isEqualTo(LauncherPresetOption.APP_DEFAULT)
        assertThat(state.launchFenrusLauncher).isEqualTo(FenrusLauncherOption.APP_DEFAULT)
    }

    @Test
    fun launchInstanceRequiresInitialPrompt() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository()
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.launchInstance()
        advanceUntilIdle()

        assertThat(repository.launchInstanceCalls).isEmpty()
        assertThat(viewModel.uiState.value.errorMessage).isEqualTo("Initial prompt is required to start a remote session")
    }

    @Test
    fun streamRefreshFailureDoesNotClearSelectedInstance() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository()
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.openInstance("instance-1")
        advanceUntilIdle()
        repository.detailFailure = IllegalStateException("HTTP 500 Internal Server Error")

        repository.emitObservedEvent(InstanceEvent(type = "message", message = "update"))
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(state.selectedInstanceId).isEqualTo("instance-1")
        assertThat(state.selectedDetail?.instance?.instanceId).isEqualTo("instance-1")
    }

    @Test
    fun refreshInstancesKeepsSelectedDetailWhenListTemporarilyOmitsIt() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository()
        repository.instancesResult = listOf(instance("instance-1"))
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.openInstance("instance-1")
        advanceUntilIdle()
        repository.instancesResult = emptyList()

        viewModel.refreshInstances()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(state.selectedInstanceId).isEqualTo("instance-1")
        assertThat(state.selectedDetail?.instance?.instanceId).isEqualTo("instance-1")
    }

    @Test
    fun navigateToCliLoadsPresetsAndInstances() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            cliPresetsResult = listOf(
                CliPreset(preset = "claude", label = "Claude Code", command = "claude"),
                CliPreset(preset = "codex", label = "Codex CLI", command = "codex"),
            ),
            cliInstancesResult = listOf(
                CliInstanceWire(
                    instanceId = "cli-1",
                    preset = "claude",
                    presetLabel = "Claude Code",
                    title = "Existing Claude",
                    command = "claude",
                    status = "running",
                ),
            ),
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.navigateTo(MagicHatScreen.CLI_INSTANCES)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(state.screen).isEqualTo(MagicHatScreen.CLI_INSTANCES)
        assertThat(repository.listCliPresetsCalls).isEqualTo(1)
        assertThat(repository.listCliInstancesCalls).isEqualTo(1)
        assertThat(state.cliPresets.map { it.preset }).containsExactly("claude", "codex").inOrder()
        assertThat(state.cliInstances.map { it.instanceId }).containsExactly("cli-1")
        assertThat(state.cliSelectedInstanceId).isEqualTo("cli-1")
        assertThat(state.cliSelectedPreset).isEqualTo("claude")
    }

    @Test
    fun launchCliKeepsLaunchedInstanceSelectedAcrossRefresh() = runTest(dispatcher) {
        val launched = CliInstanceWire(
            instanceId = "cli-new",
            preset = "codex",
            presetLabel = "Codex CLI",
            title = "Codex CLI",
            command = "codex",
            status = "running",
            output = "booted",
        )
        val repository = FakeMagicHatRepository(
            cliPresetsResult = listOf(
                CliPreset(preset = "claude", label = "Claude Code", command = "claude"),
                CliPreset(preset = "codex", label = "Codex CLI", command = "codex"),
            ),
            cliInstancesResult = listOf(launched),
        )
        repository.launchCliInstanceResult = launched
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac")),
            activeHostId = "alpha",
        )
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.navigateTo(MagicHatScreen.CLI_INSTANCES)
        advanceUntilIdle()
        viewModel.updateCliPreset("codex")
        viewModel.launchCliInstance()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(repository.launchCliCalls).containsExactly(
            CliLaunchInvocation(
                preset = "codex",
                title = null,
                initialPrompt = "",
            ),
        )
        assertThat(state.cliSelectedInstanceId).isEqualTo("cli-new")
        assertThat(state.cliInstances.first().instanceId).isEqualTo("cli-new")
    }

    @Test
    fun navigateToCliRefreshesHostPresenceBeforeLoading() = runTest(dispatcher) {
        val repository = FakeMagicHatRepository(
            cliPresetsResult = listOf(
                CliPreset(preset = "claude", label = "Claude Code", command = "claude"),
            ),
        )
        repository.pairingStateFlow.value = PairingSnapshot(
            pairedHosts = listOf(pairedHost(hostId = "alpha", displayName = "Office Mac", presence = "offline")),
            activeHostId = "alpha",
        )
        repository.refreshActiveHostSideEffect = {
            repository.pairingStateFlow.update { snapshot ->
                snapshot.copy(
                    pairedHosts = snapshot.pairedHosts.map { host ->
                        if (host.hostId == "alpha") host.copy(lastKnownHostPresence = "online") else host
                    },
                )
            }
        }
        val viewModel = MagicHatViewModel(repository)
        advanceUntilIdle()

        viewModel.navigateTo(MagicHatScreen.CLI_INSTANCES)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertThat(repository.refreshActiveHostCalls).isEqualTo(1)
        assertThat(state.activeHostPresence).isEqualTo("online")
        assertThat(state.cliPresets.map { it.preset }).containsExactly("claude")
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
    var instancesResult: List<TeamAppInstance> = emptyList(),
    var restoreRefsResult: List<KnownRestoreRef> = emptyList(),
    var cliPresetsResult: List<CliPreset> = emptyList(),
    var cliInstancesResult: List<com.magichat.mobile.model.CliInstanceWire> = emptyList(),
) : MagicHatRepositoryContract {
    val launchInstanceCalls = mutableListOf<LaunchInvocation>()
    val pairRemoteCalls = mutableListOf<RemotePairInvocation>()
    val pairingStateFlow = MutableStateFlow(PairingSnapshot(emptyList(), null))
    val activeHostSelections = mutableListOf<String>()
    val removedHosts = mutableListOf<String>()
    var removeHostSideEffect: (String) -> Unit = {}
    var refreshActiveHostSideEffect: () -> Unit = {}
    var listInstancesCalls = 0
    var listRestoreRefsCalls = 0
    var listCliPresetsCalls = 0
    var listCliInstancesCalls = 0
    var refreshActiveHostCalls = 0
    var stopInstanceEventsCalls = 0
    val launchCliCalls = mutableListOf<CliLaunchInvocation>()
    var launchInstanceResult: InstanceDetail = InstanceDetail(instance = instance("launched"))
    var launchCliInstanceResult: com.magichat.mobile.model.CliInstanceWire = CliInstanceWire(
        instanceId = "cli-launched",
        preset = "claude",
        presetLabel = "Claude Code",
        title = "Claude Code",
        command = "claude",
        status = "running",
    )
    var detailFailure: Throwable? = null
    private var observedOnEvent: ((InstanceEvent) -> Unit)? = null
    private var observedOnState: ((String) -> Unit)? = null

    override val pairingState: Flow<PairingSnapshot> = pairingStateFlow

    override suspend fun discoverHosts(baseUrl: String): List<BeaconHost> = emptyList()

    override suspend fun pairHost(baseUrl: String, hostId: String, pairingCode: String, deviceName: String): PairedHostRecord {
        error("Not used in this test")
    }

    override suspend fun pairRemote(pairUri: String, deviceName: String): PairedHostRecord {
        pairRemoteCalls += RemotePairInvocation(pairUri, deviceName)
        return PairedHostRecord(
            hostId = "remote-paired",
            displayName = "Remote Host",
            baseUrl = "http://127.0.0.1:18765/",
            sessionToken = "session-token",
            pairedAt = "2026-04-13T10:00:00Z",
            mode = "remote_relay",
            relayUrl = "https://relay.example.test",
            deviceId = "device-1",
            lastKnownHostPresence = "online",
        )
    }

    override suspend fun activeHost(): PairedHostRecord? {
        val snapshot = pairingStateFlow.value
        return snapshot.pairedHosts.firstOrNull { it.hostId == snapshot.activeHostId }
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

    override suspend fun refreshActiveHost(): PairedHostRecord? {
        refreshActiveHostCalls += 1
        refreshActiveHostSideEffect()
        val snapshot = pairingStateFlow.value
        return snapshot.pairedHosts.firstOrNull { it.hostId == snapshot.activeHostId }
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
        detailFailure?.let { throw it }
        return InstanceDetail(instance = instance(instanceId))
    }

    override suspend fun launchInstance(
        title: String?,
        teamMode: TeamModeOption,
        launcherPreset: LauncherPresetOption,
        fenrusLauncher: FenrusLauncherOption,
    ): InstanceDetail {
        launchInstanceCalls += LaunchInvocation(title, teamMode, launcherPreset, fenrusLauncher)
        return launchInstanceResult
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

    override suspend fun listCliPresets(): List<com.magichat.mobile.model.CliPreset> {
        listCliPresetsCalls += 1
        return cliPresetsResult
    }

    override suspend fun listCliInstances(): List<com.magichat.mobile.model.CliInstanceWire> {
        listCliInstancesCalls += 1
        return cliInstancesResult
    }

    override suspend fun getCliInstance(instanceId: String): com.magichat.mobile.model.CliInstanceWire {
        throw UnsupportedOperationException("test stub")
    }

    override suspend fun launchCliInstance(
        preset: String,
        title: String?,
        initialPrompt: String?,
    ): com.magichat.mobile.model.CliInstanceWire {
        launchCliCalls += CliLaunchInvocation(preset, title, initialPrompt ?: "")
        return launchCliInstanceResult
    }

    override suspend fun closeCliInstance(instanceId: String) = Unit

    override suspend fun sendCliPrompt(instanceId: String, prompt: String) = Unit

    override fun observeCliInstanceEvents(
        instanceId: String,
        onEvent: (com.magichat.mobile.model.CliEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        // no-op in viewmodel tests
    }

    override fun stopCliInstanceEvents() = Unit

    override fun observeInstanceEvents(
        instanceId: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        observedOnEvent = onEvent
        observedOnState = onState
        onState("connected")
    }

    override fun stopInstanceEvents() {
        stopInstanceEventsCalls += 1
    }

    fun emitObservedEvent(event: InstanceEvent) {
        observedOnEvent?.invoke(event)
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

private data class LaunchInvocation(
    val title: String?,
    val teamMode: TeamModeOption,
    val launcherPreset: LauncherPresetOption,
    val fenrusLauncher: FenrusLauncherOption,
)

private data class RemotePairInvocation(
    val pairUri: String,
    val deviceName: String,
)

private data class CliLaunchInvocation(
    val preset: String,
    val title: String?,
    val initialPrompt: String,
)
