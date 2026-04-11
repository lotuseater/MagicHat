package com.magichat.mobile.state

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.magichat.mobile.model.BeaconHost
import com.magichat.mobile.model.InstanceDetail
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.TeamAppInstance
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
    val baseUrlInput: String = "http://192.168.1.10:8787/",
    val pairCodeInput: String = "",
    val launchTitleInput: String = "",
    val restoreSessionInput: String = "",
    val promptInput: String = "",
    val followUpInput: String = "",
    val discoveredHosts: List<BeaconHost> = emptyList(),
    val pairedHosts: List<PairedHostRecord> = emptyList(),
    val activeHostId: String? = null,
    val instances: List<TeamAppInstance> = emptyList(),
    val selectedInstanceId: String? = null,
    val selectedDetail: InstanceDetail? = null,
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
                _uiState.update { state ->
                    state.copy(
                        pairedHosts = pairing.pairedHosts,
                        activeHostId = pairing.activeHostId,
                    )
                }
            }
        }
    }

    fun updateBaseUrl(value: String) {
        _uiState.update { it.copy(baseUrlInput = value) }
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

    fun navigateTo(screen: MagicHatScreen) {
        _uiState.update { it.copy(screen = screen) }
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

    fun selectPairedHost(hostId: String) {
        launchAction {
            repository.setActiveHost(hostId)
            refreshInstances()
            _uiState.update { it.copy(screen = MagicHatScreen.INSTANCES) }
        }
    }

    fun forgetHost(hostId: String) {
        launchAction {
            repository.removeHost(hostId)
            _uiState.update { it.copy(instances = emptyList(), selectedDetail = null) }
        }
    }

    fun refreshInstances() {
        launchAction {
            val instances = repository.listInstances()
            _uiState.update { it.copy(instances = instances) }
        }
    }

    fun launchInstance() {
        launchAction {
            val detail = repository.launchInstance(_uiState.value.launchTitleInput)
            val instances = repository.listInstances()
            _uiState.update {
                it.copy(
                    instances = instances,
                    selectedInstanceId = detail.instance.instanceId,
                    selectedDetail = detail,
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
            val state = _uiState.value
            val nextSelected = state.selectedInstanceId.takeUnless { it == instanceId }
            _uiState.update {
                it.copy(
                    instances = instances,
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
        }
    }

    fun restoreSession() {
        launchAction {
            val restoreStatePath = _uiState.value.restoreSessionInput
            if (restoreStatePath.isBlank()) {
                error("Restore state path is required")
            }
            val detail = repository.restoreSession(restoreStatePath)
            val instances = repository.listInstances()
            _uiState.update {
                it.copy(
                    restoreSessionInput = "",
                    instances = instances,
                    selectedInstanceId = detail.instance.instanceId,
                    selectedDetail = detail,
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
                _uiState.update { state ->
                    state.copy(streamEvents = (state.streamEvents + event).takeLast(200))
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
        fun provideFactory(context: Context): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    val store = PairingStore(context.applicationContext)
                    val repository = MagicHatRepository(store)
                    return MagicHatViewModel(repository) as T
                }
            }
        }
    }
}
