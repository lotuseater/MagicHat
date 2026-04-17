package com.magichat.mobile.state

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.magichat.mobile.model.BeaconHost
import com.magichat.mobile.model.InstanceDetail
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.security.DeviceKeyStore
import com.magichat.mobile.storage.PairingStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class MagicHatScreen {
    PAIRED_PC_SELECTION,
    INSTANCES,
    INSTANCE_DETAIL,
}

data class MagicHatUiState(
    val screen: MagicHatScreen = MagicHatScreen.PAIRED_PC_SELECTION,
    val baseUrlInput: String = "http://192.168.1.10:18765/",
    val remotePairUriInput: String = "",
    val pairCodeInput: String = "",
    val launchTitleInput: String = "",
    val restoreSessionInput: String = "",
    val promptInput: String = "",
    val followUpInput: String = "",
    val discoveredHosts: List<BeaconHost> = emptyList(),
    val pairedHosts: List<PairedHostRecord> = emptyList(),
    val activeHostId: String? = null,
    val activeHost: PairedHostRecord? = null,
    val activeHostPresence: String? = null,
    val instances: List<TeamAppInstance> = emptyList(),
    val knownRestoreRefs: List<KnownRestoreRef> = emptyList(),
    val selectedInstanceId: String? = null,
    val selectedDetail: InstanceDetail? = null,
    val selectedTerminalAgent: String? = null,
    val streamEvents: List<InstanceEvent> = emptyList(),
    val streamStatus: String = "idle",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

class MagicHatViewModel(
    private val repository: MagicHatRepositoryContract,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MagicHatUiState())
    val uiState: StateFlow<MagicHatUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.pairingState.collect { pairing ->
                val activeRecord = pairing.pairedHosts.firstOrNull { it.hostId == pairing.activeHostId }
                _uiState.update { state ->
                    state.copy(
                        pairedHosts = pairing.pairedHosts,
                        activeHostId = pairing.activeHostId,
                        activeHost = activeRecord,
                        activeHostPresence = activeRecord?.lastKnownHostPresence,
                    )
                }
            }
        }
    }

    fun updateBaseUrl(value: String) {
        _uiState.update { it.copy(baseUrlInput = value) }
    }

    fun updateRemotePairUri(value: String) {
        _uiState.update { it.copy(remotePairUriInput = value) }
    }

    fun importRemotePairUri(value: String) {
        val normalized = value.trim()
        if (normalized.isBlank()) {
            return
        }
        _uiState.update {
            it.copy(
                screen = MagicHatScreen.PAIRED_PC_SELECTION,
                remotePairUriInput = normalized,
                errorMessage = null,
            )
        }
    }

    fun updatePairCode(value: String) {
        _uiState.update { it.copy(pairCodeInput = value) }
    }

    fun updateLaunchTitle(value: String) {
        _uiState.update { it.copy(launchTitleInput = value) }
    }

    fun updatePrompt(value: String) {
        _uiState.update { it.copy(promptInput = value) }
    }

    fun updateFollowUp(value: String) {
        _uiState.update { it.copy(followUpInput = value) }
    }

    fun updateRestoreSession(value: String) {
        _uiState.update { it.copy(restoreSessionInput = value) }
    }

    fun selectTerminalAgent(agentId: String) {
        _uiState.update { state ->
            if (state.selectedDetail?.terminalsByAgent?.containsKey(agentId) == true) {
                state.copy(selectedTerminalAgent = agentId)
            } else {
                state
            }
        }
    }

    fun navigateTo(screen: MagicHatScreen) {
        _uiState.update { it.copy(screen = screen) }
        when (screen) {
            MagicHatScreen.INSTANCES -> {
                viewModelScope.launch {
                    runCatching { loadCurrentHostData() }
                }
            }

            MagicHatScreen.INSTANCE_DETAIL -> {
                val instanceId = _uiState.value.selectedInstanceId ?: return
                viewModelScope.launch {
                    runCatching { refreshSelectedInstanceDetail(instanceId, refreshCollections = false) }
                }
            }

            MagicHatScreen.PAIRED_PC_SELECTION -> Unit
        }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun discoverHosts() {
        launchAction {
            val state = _uiState.value
            val hosts = repository.discoverHosts(state.baseUrlInput)
            _uiState.update { it.copy(discoveredHosts = hosts) }
        }
    }

    fun pair(hostId: String) {
        launchAction {
            val state = _uiState.value
            if (state.pairCodeInput.isBlank()) {
                error("Pairing code is required")
            }
            repository.pairHost(
                baseUrl = state.baseUrlInput,
                hostId = hostId,
                pairingCode = state.pairCodeInput,
                deviceName = "MagicHat Android",
            )
            refreshInstances()
            _uiState.update { it.copy(screen = MagicHatScreen.INSTANCES) }
        }
    }

    fun pairRemote() {
        launchAction {
            val state = _uiState.value
            val pairUri = state.remotePairUriInput.trim()
            if (pairUri.isBlank()) {
                error("Remote pair URI is required")
            }
            repository.pairRemote(
                pairUri = pairUri,
                deviceName = "MagicHat Android",
            )
            refreshInstances()
            _uiState.update {
                it.copy(
                    screen = MagicHatScreen.INSTANCES,
                    remotePairUriInput = "",
                )
            }
        }
    }

    fun selectPairedHost(hostId: String) {
        launchAction {
            resetInstanceContext()
            repository.setActiveHost(hostId)
            loadCurrentHostData()
            _uiState.update { it.copy(screen = MagicHatScreen.INSTANCES) }
        }
    }

    fun forgetHost(hostId: String) {
        launchAction {
            repository.removeHost(hostId)
            resetInstanceContext()
            if (repository.activeHost() != null) {
                loadCurrentHostData()
            }
        }
    }

    fun refreshInstances() {
        launchAction {
            loadCurrentHostData()
        }
    }

    fun refreshActiveHostStatus() {
        launchAction {
            repository.refreshActiveHost()
        }
    }

    fun launchInstance() {
        launchAction {
            val detail = repository.launchInstance(_uiState.value.launchTitleInput)
            val instances = repository.listInstances()
            val restoreRefs = repository.listKnownRestoreRefs()
            _uiState.update {
                it.copy(
                    instances = instances,
                    knownRestoreRefs = restoreRefs,
                    selectedInstanceId = detail.instance.instanceId,
                    selectedDetail = detail,
                    selectedTerminalAgent = preferredTerminalAgent(detail, it.selectedTerminalAgent),
                    screen = MagicHatScreen.INSTANCE_DETAIL,
                    launchTitleInput = "",
                )
            }
            subscribeToInstance(detail.instance.instanceId)
        }
    }

    fun openInstance(instanceId: String) {
        launchAction {
            val detail = repository.getInstanceDetail(instanceId)
            _uiState.update {
                it.copy(
                    selectedInstanceId = instanceId,
                    selectedDetail = detail,
                    selectedTerminalAgent = preferredTerminalAgent(detail, it.selectedTerminalAgent),
                    screen = MagicHatScreen.INSTANCE_DETAIL,
                )
            }
            subscribeToInstance(instanceId)
        }
    }

    fun closeInstance(instanceId: String) {
        launchAction {
            repository.closeInstance(instanceId)
            val instances = repository.listInstances()
            val restoreRefs = repository.listKnownRestoreRefs()
            val state = _uiState.value
            val nextSelected = state.selectedInstanceId.takeUnless { it == instanceId }
            _uiState.update {
                it.copy(
                    instances = instances,
                    knownRestoreRefs = restoreRefs,
                    selectedInstanceId = nextSelected,
                    selectedDetail = if (nextSelected == null) null else it.selectedDetail,
                )
            }
            if (nextSelected == null) {
                repository.stopInstanceEvents()
            }
        }
    }

    fun sendPrompt() {
        launchAction {
            val instanceId = _uiState.value.selectedInstanceId ?: error("Select instance first")
            val prompt = _uiState.value.promptInput
            if (prompt.isBlank()) {
                error("Prompt is empty")
            }
            repository.sendPrompt(instanceId, prompt)
            _uiState.update { it.copy(promptInput = "") }
            refreshSelectedInstanceDetail(instanceId, refreshCollections = true)
        }
    }

    fun sendFollowUp() {
        launchAction {
            val instanceId = _uiState.value.selectedInstanceId ?: error("Select instance first")
            val followUp = _uiState.value.followUpInput
            if (followUp.isBlank()) {
                error("Follow-up is empty")
            }
            repository.sendFollowUp(instanceId, followUp)
            _uiState.update { it.copy(followUpInput = "") }
            refreshSelectedInstanceDetail(instanceId, refreshCollections = true)
        }
    }

    fun answerTrustPrompt(approved: Boolean) {
        launchAction {
            val instanceId = _uiState.value.selectedInstanceId ?: error("Select instance first")
            repository.answerTrustPrompt(instanceId, approved)
            refreshSelectedInstanceDetail(instanceId, refreshCollections = true)
        }
    }

    fun pickRestoreRef(restoreRef: String) {
        _uiState.update { it.copy(restoreSessionInput = restoreRef) }
    }

    fun restoreSession() {
        launchAction {
            val restoreSelector = _uiState.value.restoreSessionInput
            if (restoreSelector.isBlank()) {
                error("Restore ref or session is required")
            }
            val detail = repository.restoreSession(restoreSelector)
            val instances = repository.listInstances()
            val restoreRefs = repository.listKnownRestoreRefs()
            _uiState.update {
                it.copy(
                    restoreSessionInput = "",
                    instances = instances,
                    knownRestoreRefs = restoreRefs,
                    selectedInstanceId = detail.instance.instanceId,
                    selectedDetail = detail,
                    selectedTerminalAgent = preferredTerminalAgent(detail, it.selectedTerminalAgent),
                    screen = MagicHatScreen.INSTANCE_DETAIL,
                )
            }
            subscribeToInstance(detail.instance.instanceId)
        }
    }

    private fun subscribeToInstance(instanceId: String) {
        _uiState.update { it.copy(streamEvents = emptyList(), streamStatus = "connecting") }
        repository.observeInstanceEvents(
            instanceId = instanceId,
            onEvent = { event ->
                if (event.type == "heartbeat" || event.type == "beacon_heartbeat") {
                    return@observeInstanceEvents
                }
                _uiState.update { state ->
                    state.copy(streamEvents = (state.streamEvents + event).takeLast(200))
                }
                viewModelScope.launch {
                    refreshSelectedInstanceDetail(instanceId, refreshCollections = false)
                }
            },
            onState = { streamState ->
                _uiState.update { it.copy(streamStatus = streamState) }
            },
        )
    }

    override fun onCleared() {
        repository.stopInstanceEvents()
        super.onCleared()
    }

    private suspend fun loadCurrentHostData() {
        if (repository.activeHost() == null) {
            resetInstanceContext()
            return
        }

        val instances = repository.listInstances()
        val restoreRefs = repository.listKnownRestoreRefs()
        reconcileInstanceContext(instances, restoreRefs)
    }

    private suspend fun refreshSelectedInstanceDetail(
        instanceId: String,
        refreshCollections: Boolean,
    ) {
        val detail = repository.getInstanceDetail(instanceId)
        val instances = if (refreshCollections) repository.listInstances() else _uiState.value.instances
        val restoreRefs = if (refreshCollections) repository.listKnownRestoreRefs() else _uiState.value.knownRestoreRefs
        _uiState.update { state ->
            state.copy(
                selectedDetail = detail,
                selectedTerminalAgent = preferredTerminalAgent(detail, state.selectedTerminalAgent),
                instances = instances,
                knownRestoreRefs = restoreRefs,
            )
        }
    }

    private fun reconcileInstanceContext(
        instances: List<TeamAppInstance>,
        restoreRefs: List<KnownRestoreRef>,
    ) {
        val selectedInstanceId = _uiState.value.selectedInstanceId
        val selectionStillExists = selectedInstanceId != null && instances.any { it.instanceId == selectedInstanceId }
        if (!selectionStillExists) {
            repository.stopInstanceEvents()
        }
        _uiState.update { state ->
            state.copy(
                instances = instances,
                knownRestoreRefs = restoreRefs,
                selectedInstanceId = if (selectionStillExists) state.selectedInstanceId else null,
                selectedDetail = if (selectionStillExists) state.selectedDetail else null,
                selectedTerminalAgent = if (selectionStillExists) state.selectedTerminalAgent else null,
                streamEvents = if (selectionStillExists) state.streamEvents else emptyList(),
                streamStatus = if (selectionStillExists) state.streamStatus else "idle",
                promptInput = if (selectionStillExists) state.promptInput else "",
                followUpInput = if (selectionStillExists) state.followUpInput else "",
                restoreSessionInput = if (selectionStillExists) state.restoreSessionInput else "",
            )
        }
    }

    private fun resetInstanceContext() {
        repository.stopInstanceEvents()
        _uiState.update {
            it.copy(
                instances = emptyList(),
                knownRestoreRefs = emptyList(),
                selectedInstanceId = null,
                selectedDetail = null,
                selectedTerminalAgent = null,
                streamEvents = emptyList(),
                streamStatus = "idle",
                promptInput = "",
                followUpInput = "",
                restoreSessionInput = "",
            )
        }
    }

    private fun launchAction(block: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            runCatching {
                block()
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(errorMessage = throwable.message ?: "Unknown error")
                }
            }
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    companion object {
        private fun preferredTerminalAgent(detail: InstanceDetail, current: String?): String? {
            if (current != null && detail.terminalsByAgent.containsKey(current)) {
                return current
            }
            return detail.terminalsByAgent.keys.sorted().firstOrNull()
        }

        fun provideFactory(context: Context): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    val appContext = context.applicationContext
                    val store = PairingStore(appContext)
                    val repository = MagicHatRepository(
                        pairingStore = store,
                        deviceKeyStore = DeviceKeyStore(appContext),
                    )
                    return MagicHatViewModel(repository) as T
                }
            }
        }
    }
}
