package com.magichat.mobile.state

import com.magichat.mobile.model.BeaconHost
import com.magichat.mobile.model.FollowUpRequest
import com.magichat.mobile.model.InstanceDetail
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.InstanceWire
import com.magichat.mobile.model.LaunchInstanceRequest
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.PairRequest
import com.magichat.mobile.model.ProgressSnapshot
import com.magichat.mobile.model.PromptRequest
import com.magichat.mobile.model.SubmissionReceipt
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.network.MagicHatApiFactory
import com.magichat.mobile.network.SseEventStreamClient
import com.magichat.mobile.storage.PairingSnapshot
import com.magichat.mobile.storage.PairingStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import java.io.IOException
import java.net.URI
import java.time.Instant

interface MagicHatRepositoryContract {
    val pairingState: Flow<PairingSnapshot>

    suspend fun discoverHosts(baseUrl: String): List<BeaconHost>
    suspend fun pairHost(baseUrl: String, hostId: String, pairingCode: String, deviceName: String): PairedHostRecord
    suspend fun setActiveHost(hostId: String)
    suspend fun removeHost(hostId: String)

    suspend fun listInstances(): List<TeamAppInstance>
    suspend fun getInstanceDetail(instanceId: String): InstanceDetail
    suspend fun launchInstance(title: String?): InstanceDetail
    suspend fun closeInstance(instanceId: String)
    suspend fun sendPrompt(instanceId: String, prompt: String): SubmissionReceipt
    suspend fun sendFollowUp(instanceId: String, followUp: String): SubmissionReceipt
    suspend fun restoreSession(restoreStatePath: String): InstanceDetail

    fun observeInstanceEvents(
        instanceId: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    )

    fun stopInstanceEvents()
}

class MagicHatRepository(
    private val pairingStore: PairingStore,
    private val apiFactory: MagicHatApiFactory = MagicHatApiFactory(),
    private val sseEventStreamClient: SseEventStreamClient = SseEventStreamClient(apiFactory),
) : MagicHatRepositoryContract {

    private data class ActiveContext(
        val baseUrl: String,
        val token: String,
    )

    override val pairingState: Flow<PairingSnapshot> = pairingStore.state

    override suspend fun discoverHosts(baseUrl: String): List<BeaconHost> {
        val normalizedBaseUrl = normalizeBaseUrl(baseUrl)
        val api = apiFactory.create(normalizedBaseUrl) { null }
        withLanRetry {
            api.getHealth()
        }

        val parsed = runCatching { URI(normalizedBaseUrl) }.getOrNull()
        val hostLabel = parsed?.host?.takeIf { it.isNotBlank() } ?: normalizedBaseUrl.removeSuffix("/")
        return listOf(
            BeaconHost(
                hostId = hostLabel,
                displayName = "Team App Host",
                address = normalizedBaseUrl.removeSuffix("/"),
                lastSeenAt = Instant.now().toString(),
            ),
        )
    }

    override suspend fun pairHost(
        baseUrl: String,
        hostId: String,
        pairingCode: String,
        deviceName: String,
    ): PairedHostRecord {
        val normalizedBaseUrl = normalizeBaseUrl(baseUrl)
        val api = apiFactory.create(normalizedBaseUrl) { null }
        val result = withLanRetry {
            api.pairHost(
                PairRequest(
                    pairingCode = pairingCode,
                    deviceName = deviceName,
                    deviceId = hostId,
                ),
            )
        }

        val authedApi = apiFactory.create(normalizedBaseUrl) { result.sessionToken }
        val hostInfo = withLanRetry {
            authedApi.getHostInfo()
        }

        val record = PairedHostRecord(
            hostId = hostInfo.hostId,
            displayName = hostInfo.hostName,
            baseUrl = normalizedBaseUrl,
            sessionToken = result.sessionToken,
            pairedAt = Instant.now().toString(),
        )
        pairingStore.upsert(record)
        return record
    }

    override suspend fun setActiveHost(hostId: String) {
        pairingStore.setActiveHost(hostId)
    }

    override suspend fun removeHost(hostId: String) {
        pairingStore.removeHost(hostId)
    }

    override suspend fun listInstances(): List<TeamAppInstance> {
        val context = requireActiveContext()
        val api = apiFor(context)
        return withLanRetry {
            api.listInstances().instances.map(::toInstanceSummary)
        }
    }

    override suspend fun getInstanceDetail(instanceId: String): InstanceDetail {
        val context = requireActiveContext()
        val api = apiFor(context)
        return withLanRetry {
            toInstanceDetail(api.getInstanceDetail(instanceId))
        }
    }

    override suspend fun launchInstance(title: String?): InstanceDetail {
        val context = requireActiveContext()
        val api = apiFor(context)
        val launched = withLanRetry {
            api.launchInstance(
                LaunchInstanceRequest(
                    title = title.takeUnless { it.isNullOrBlank() },
                ),
            )
        }
        return getInstanceDetail(instanceKey(launched))
    }

    override suspend fun closeInstance(instanceId: String) {
        val context = requireActiveContext()
        val api = apiFor(context)
        withLanRetry {
            api.closeInstance(instanceId)
        }
    }

    override suspend fun sendPrompt(instanceId: String, prompt: String): SubmissionReceipt {
        val context = requireActiveContext()
        val api = apiFor(context)
        return withLanRetry {
            api.sendPrompt(instanceId, PromptRequest(prompt = prompt))
        }
    }

    override suspend fun sendFollowUp(instanceId: String, followUp: String): SubmissionReceipt {
        val context = requireActiveContext()
        val api = apiFor(context)
        return withLanRetry {
            api.sendFollowUp(instanceId, FollowUpRequest(message = followUp))
        }
    }

    override suspend fun restoreSession(restoreStatePath: String): InstanceDetail {
        val context = requireActiveContext()
        val api = apiFor(context)
        val launched = withLanRetry {
            api.launchInstance(
                LaunchInstanceRequest(
                    restoreStatePath = restoreStatePath,
                ),
            )
        }
        return getInstanceDetail(instanceKey(launched))
    }

    override fun observeInstanceEvents(
        instanceId: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        val snapshot = runCatching { kotlinx.coroutines.runBlocking { pairingStore.readSnapshot() } }.getOrNull() ?: return
        val activeHostId = snapshot.activeHostId ?: return
        val record = snapshot.pairedHosts.firstOrNull { it.hostId == activeHostId } ?: return

        sseEventStreamClient.start(
            baseUrl = record.baseUrl,
            instanceId = instanceId,
            token = record.sessionToken,
            onEvent = onEvent,
            onState = onState,
        )
    }

    override fun stopInstanceEvents() {
        sseEventStreamClient.stop()
    }

    private suspend fun requireActiveContext(): ActiveContext {
        val snapshot = pairingStore.readSnapshot()
        val activeHostId = snapshot.activeHostId
            ?: error("No paired host selected")
        val record = snapshot.pairedHosts.firstOrNull { it.hostId == activeHostId }
            ?: error("Active host not found")

        return ActiveContext(
            baseUrl = record.baseUrl,
            token = record.sessionToken,
        )
    }

    private fun apiFor(context: ActiveContext) = apiFactory.create(context.baseUrl) { context.token }

    private suspend fun <T> withLanRetry(block: suspend () -> T): T {
        return try {
            block()
        } catch (io: IOException) {
            delay(800)
            block()
        }
    }

    private fun normalizeBaseUrl(baseUrl: String): String {
        return if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"
    }

    private fun instanceKey(instance: InstanceWire): String {
        return instance.instanceId?.takeIf { it.isNotBlank() } ?: instance.pid.toString()
    }

    private fun toInstanceSummary(instance: InstanceWire): TeamAppInstance {
        val health = normalizedPhase(instance)
        val title = preferredTitle(instance)
        return TeamAppInstance(
            instanceId = instanceKey(instance),
            title = title,
            active = health.lowercase() !in setOf("complete", "finished", "closed"),
            health = health,
            resultPreview = preferredSummary(instance),
            sessionId = instance.sessionId,
            pid = instance.pid,
            restoreStatePath = preferredRestorePath(instance),
        )
    }

    private fun toInstanceDetail(instance: InstanceWire): InstanceDetail {
        val taskState = instance.snapshot?.taskState ?: instance.currentTaskState
        val completed = taskState?.workersDone
        val total = when {
            completed == null -> null
            completed < 3 -> 3
            else -> completed
        }
        return InstanceDetail(
            instance = toInstanceSummary(instance),
            progress = ProgressSnapshot(
                stepLabel = taskState?.phase ?: normalizedPhase(instance),
                completedSteps = completed,
                totalSteps = total,
                updatedAt = null,
            ),
            latestOutput = preferredSummary(instance),
            status = instance.status ?: "ok",
            restoreStatePath = preferredRestorePath(instance),
            runLogPath = preferredRunLogPath(instance),
        )
    }

    private fun preferredTitle(instance: InstanceWire): String {
        val taskState = instance.snapshot?.taskState ?: instance.currentTaskState
        return taskState?.task?.takeIf { it.isNotBlank() }
            ?: instance.sessionId?.takeIf { it.isNotBlank() }
            ?: "Team App ${instance.pid}"
    }

    private fun preferredSummary(instance: InstanceWire): String? {
        return instance.summaryText?.takeIf { it.isNotBlank() }
            ?: instance.snapshot?.resultSummary?.shortText?.takeIf { it.isNotBlank() }
            ?: instance.resultSummary?.shortText?.takeIf { it.isNotBlank() }
    }

    private fun preferredRestorePath(instance: InstanceWire): String? {
        return instance.restoreStatePath?.takeIf { it.isNotBlank() }
            ?: instance.snapshot?.restoreRefs?.restoreStatePath?.takeIf { it.isNotBlank() }
    }

    private fun preferredRunLogPath(instance: InstanceWire): String? {
        return instance.runLogPath?.takeIf { it.isNotBlank() }
            ?: instance.snapshot?.restoreRefs?.runLogPath?.takeIf { it.isNotBlank() }
    }

    private fun normalizedPhase(instance: InstanceWire): String {
        return instance.phase?.takeIf { it.isNotBlank() }
            ?: instance.snapshot?.phase?.takeIf { it.isNotBlank() }
            ?: instance.snapshot?.taskState?.phase?.takeIf { it.isNotBlank() }
            ?: instance.currentTaskState?.phase?.takeIf { it.isNotBlank() }
            ?: "running"
    }
}
