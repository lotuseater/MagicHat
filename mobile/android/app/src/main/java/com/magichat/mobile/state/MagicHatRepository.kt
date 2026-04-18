package com.magichat.mobile.state

import com.magichat.mobile.model.BeaconHost
import com.magichat.mobile.model.CliInstanceWire
import com.magichat.mobile.model.CliLaunchRequest
import com.magichat.mobile.model.CliPreset
import com.magichat.mobile.model.CliPromptRequest
import com.magichat.mobile.model.FenrusLauncherOption
import com.magichat.mobile.model.FollowUpRequest
import com.magichat.mobile.model.HostConnectionMode
import com.magichat.mobile.model.InstanceDetail
import com.magichat.mobile.model.InstanceEvent
import com.magichat.mobile.model.InstanceWire
import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.LauncherPresetOption
import com.magichat.mobile.model.LaunchInstanceRequest
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.model.PairRequest
import com.magichat.mobile.model.ProgressSnapshot
import com.magichat.mobile.model.PromptRequest
import com.magichat.mobile.model.RemoteDeviceRegisterRequest
import com.magichat.mobile.model.RemotePairClaimRequest
import com.magichat.mobile.model.RemoteSessionRefreshRequest
import com.magichat.mobile.model.SubmissionReceipt
import com.magichat.mobile.model.TeamAppInstance
import com.magichat.mobile.model.TeamModeOption
import com.magichat.mobile.model.TrustRequest
import com.magichat.mobile.network.MagicHatApiFactory
import com.magichat.mobile.network.MoshiFactory
import com.magichat.mobile.network.RemotePairingUri
import com.magichat.mobile.network.SseEventStreamClient
import com.magichat.mobile.security.DeviceKeyStoreContract
import com.magichat.mobile.storage.PairingSnapshot
import com.magichat.mobile.storage.PairingStoreContract
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import java.io.IOException
import java.net.URI
import java.time.Instant
import retrofit2.HttpException

interface MagicHatRepositoryContract {
    val pairingState: Flow<PairingSnapshot>

    suspend fun discoverHosts(baseUrl: String): List<BeaconHost>
    suspend fun pairHost(baseUrl: String, hostId: String, pairingCode: String, deviceName: String): PairedHostRecord
    suspend fun pairRemote(pairUri: String, deviceName: String): PairedHostRecord
    suspend fun activeHost(): PairedHostRecord?
    suspend fun setActiveHost(hostId: String)
    suspend fun removeHost(hostId: String)
    suspend fun refreshActiveHost(): PairedHostRecord?

    suspend fun listInstances(): List<TeamAppInstance>
    suspend fun listKnownRestoreRefs(): List<KnownRestoreRef>
    suspend fun getInstanceDetail(instanceId: String): InstanceDetail
    suspend fun launchInstance(
        title: String?,
        teamMode: TeamModeOption,
        launcherPreset: LauncherPresetOption,
        fenrusLauncher: FenrusLauncherOption,
    ): InstanceDetail
    suspend fun closeInstance(instanceId: String)
    suspend fun sendPrompt(instanceId: String, prompt: String): SubmissionReceipt
    suspend fun sendFollowUp(instanceId: String, followUp: String): SubmissionReceipt
    suspend fun answerTrustPrompt(instanceId: String, approved: Boolean): SubmissionReceipt
    suspend fun restoreSession(restoreSelector: String): InstanceDetail

    suspend fun listCliPresets(): List<CliPreset>
    suspend fun listCliInstances(): List<CliInstanceWire>
    suspend fun getCliInstance(instanceId: String): CliInstanceWire
    suspend fun launchCliInstance(
        preset: String,
        title: String?,
        initialPrompt: String?,
    ): CliInstanceWire
    suspend fun closeCliInstance(instanceId: String)
    suspend fun sendCliPrompt(instanceId: String, prompt: String)

    fun observeInstanceEvents(
        instanceId: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    )

    fun stopInstanceEvents()
}

class MagicHatRepository(
    private val pairingStore: PairingStoreContract,
    private val deviceKeyStore: DeviceKeyStoreContract,
    private val apiFactory: MagicHatApiFactory = MagicHatApiFactory(),
    private val sseEventStreamClient: SseEventStreamClient = SseEventStreamClient(apiFactory),
) : MagicHatRepositoryContract {

    private data class ApiErrorResponse(
        val error: String? = null,
        val detail: String? = null,
    )

    private data class ActiveContext(
        val record: PairedHostRecord,
    )

    private val apiErrorAdapter = MoshiFactory.instance.adapter(ApiErrorResponse::class.java)

    override val pairingState: Flow<PairingSnapshot> = pairingStore.state

    override suspend fun discoverHosts(baseUrl: String): List<BeaconHost> {
        val normalizedBaseUrl = normalizeBaseUrl(baseUrl)
        val api = apiFactory.create(normalizedBaseUrl) { null }
        withTransportRetry {
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
        val result = withTransportRetry {
            api.pairHost(
                PairRequest(
                    pairingCode = pairingCode,
                    deviceName = deviceName,
                    deviceId = hostId,
                ),
            )
        }

        val authedApi = apiFactory.create(normalizedBaseUrl) { result.sessionToken }
        val hostInfo = withTransportRetry {
            authedApi.getHostInfo()
        }

        val record = PairedHostRecord(
            hostId = hostInfo.hostId,
            displayName = hostInfo.hostName,
            baseUrl = normalizedBaseUrl,
            sessionToken = result.sessionToken,
            pairedAt = Instant.now().toString(),
            mode = HostConnectionMode.LAN_DIRECT.name.lowercase(),
        )
        pairingStore.upsert(record)
        return record
    }

    override suspend fun pairRemote(pairUri: String, deviceName: String): PairedHostRecord {
        try {
            val parsed = RemotePairingUri.parse(pairUri)
            val identity = deviceKeyStore.getOrCreate()
            val relayApi = apiFactory.createRelay(parsed.relayUrl, { null })

            val claim = withTransportRetry {
                relayApi.claimBootstrap(
                    RemotePairClaimRequest(
                        bootstrapToken = parsed.bootstrapToken,
                        deviceName = deviceName,
                        platform = "android",
                        devicePublicKey = identity.publicKeyBase64,
                    ),
                )
            }

            var approvedChallenge: String? = null
            for (attempt in 0 until 60) {
                val status = withTransportRetry {
                    relayApi.getClaimStatus(claim.claimId)
                }
                when (status.status.lowercase()) {
                    "approved" -> {
                        approvedChallenge = status.challenge
                        break
                    }
                    "rejected" -> error("Pairing was rejected on the host")
                    "completed" -> error("Pairing claim is no longer available")
                }
                delay(1_000)
            }

            val challenge = approvedChallenge ?: error("Timed out waiting for host approval")
            val registration = withTransportRetry {
                relayApi.completeRegistration(
                    RemoteDeviceRegisterRequest(
                        claimId = claim.claimId,
                        challenge = challenge,
                        signature = deviceKeyStore.sign(challenge),
                    ),
                )
            }
            val remoteDisplayName = registration.hostName
                ?.takeUnless { it.isBlank() }
                ?: claim.hostName
                    .takeUnless { it.isBlank() }
                ?: parsed.hostName

            val record = PairedHostRecord(
                hostId = registration.hostId,
                displayName = remoteDisplayName,
                baseUrl = parsed.relayUrl,
                sessionToken = registration.accessToken,
                pairedAt = Instant.now().toString(),
                mode = HostConnectionMode.REMOTE_RELAY.name.lowercase(),
                relayUrl = parsed.relayUrl,
                deviceId = registration.deviceId,
                refreshToken = registration.refreshToken,
                accessTokenExpiresAt = registration.accessTokenExpiresAt,
                refreshTokenExpiresAt = registration.refreshTokenExpiresAt,
                certificatePinsetVersion = registration.certificatePinsetVersion,
                lastKnownHostPresence = "unknown",
            )
            pairingStore.upsert(record)
            return record
        } catch (throwable: Throwable) {
            throw toUserFacingRemotePairError(throwable)
        }
    }

    override suspend fun activeHost(): PairedHostRecord? {
        val snapshot = pairingStore.readSnapshot()
        val activeHostId = snapshot.activeHostId ?: return null
        return snapshot.pairedHosts.firstOrNull { it.hostId == activeHostId }
    }

    override suspend fun setActiveHost(hostId: String) {
        pairingStore.setActiveHost(hostId)
    }

    override suspend fun removeHost(hostId: String) {
        pairingStore.removeHost(hostId)
    }

    override suspend fun refreshActiveHost(): PairedHostRecord? {
        val context = requireActiveContext()
        val record = context.record
        val updated = if (isRemote(record)) {
            refreshRemotePresence(record)
        } else {
            refreshLanPresence(record)
        }
        pairingStore.upsert(updated)
        return updated
    }

    override suspend fun listInstances(): List<TeamAppInstance> {
        val context = requireActiveContext()
        return if (isRemote(context.record)) {
            val api = relayApiFor(context.record)
            val hostState = withTransportRetry { api.listHosts() }.hosts.firstOrNull { it.hostId == context.record.hostId }
            if (hostState != null) {
                pairingStore.upsert(
                    context.record.copy(
                        lastKnownHostPresence = hostState.status,
                    ),
                )
            }
            withTransportRetry {
                api.listInstances(context.record.hostId).instances.map(::toInstanceSummary)
            }
        } else {
            val api = lanApiFor(context.record)
            withTransportRetry {
                api.listInstances().instances.map(::toInstanceSummary)
            }
        }
    }

    override suspend fun listKnownRestoreRefs(): List<KnownRestoreRef> {
        val context = requireActiveContext()
        return if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).listRestoreRefs(context.record.hostId).restoreRefs
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).listRestoreRefs().restoreRefs
            }
        }
    }

    override suspend fun getInstanceDetail(instanceId: String): InstanceDetail {
        val context = requireActiveContext()
        val wire = if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).getInstanceDetail(context.record.hostId, instanceId)
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).getInstanceDetail(instanceId)
            }
        }
        return toInstanceDetail(wire)
    }

    override suspend fun launchInstance(
        title: String?,
        teamMode: TeamModeOption,
        launcherPreset: LauncherPresetOption,
        fenrusLauncher: FenrusLauncherOption,
    ): InstanceDetail {
        val context = requireActiveContext()
        val request = LaunchInstanceRequest(
            title = title.takeUnless { it.isNullOrBlank() },
            teamMode = teamMode.wireValue.takeUnless { it.isBlank() },
            launcherPreset = launcherPreset.wireValue.takeUnless { it.isBlank() },
            fenrusLauncher = fenrusLauncher.wireValue.takeUnless { it.isBlank() },
        )
        val launched = if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).launchInstance(
                    context.record.hostId,
                    request,
                )
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).launchInstance(
                    request,
                )
            }
        }
        return getInstanceDetail(instanceKey(launched))
    }

    override suspend fun closeInstance(instanceId: String) {
        val context = requireActiveContext()
        if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).closeInstance(context.record.hostId, instanceId)
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).closeInstance(instanceId)
            }
        }
    }

    override suspend fun sendPrompt(instanceId: String, prompt: String): SubmissionReceipt {
        val context = requireActiveContext()
        return if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).sendPrompt(
                    context.record.hostId,
                    instanceId,
                    PromptRequest(prompt = prompt),
                )
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).sendPrompt(instanceId, PromptRequest(prompt = prompt))
            }
        }
    }

    override suspend fun sendFollowUp(instanceId: String, followUp: String): SubmissionReceipt {
        val context = requireActiveContext()
        return if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).sendFollowUp(
                    context.record.hostId,
                    instanceId,
                    FollowUpRequest(message = followUp),
                )
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).sendFollowUp(instanceId, FollowUpRequest(message = followUp))
            }
        }
    }

    override suspend fun answerTrustPrompt(instanceId: String, approved: Boolean): SubmissionReceipt {
        val context = requireActiveContext()
        return if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).answerTrustPrompt(
                    context.record.hostId,
                    instanceId,
                    TrustRequest(approved = approved),
                )
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).answerTrustPrompt(
                    instanceId,
                    TrustRequest(approved = approved),
                )
            }
        }
    }

    override suspend fun restoreSession(restoreSelector: String): InstanceDetail {
        val context = requireActiveContext()
        val launchRequest = resolveRestoreLaunchRequest(
            selector = restoreSelector,
            knownRestoreRefs = listKnownRestoreRefs(),
            allowRawPathFallback = !isRemote(context.record),
        )
        val launched = if (isRemote(context.record)) {
            withTransportRetry {
                relayApiFor(context.record).launchInstance(
                    context.record.hostId,
                    launchRequest,
                )
            }
        } else {
            withTransportRetry {
                lanApiFor(context.record).launchInstance(
                    launchRequest,
                )
            }
        }
        return getInstanceDetail(instanceKey(launched))
    }

    override suspend fun listCliPresets(): List<CliPreset> {
        val context = requireActiveContext()
        requireLanForCli(context.record)
        return withTransportRetry {
            lanApiFor(context.record).listCliPresets().presets
        }
    }

    override suspend fun listCliInstances(): List<CliInstanceWire> {
        val context = requireActiveContext()
        requireLanForCli(context.record)
        return withTransportRetry {
            lanApiFor(context.record).listCliInstances().instances
        }
    }

    override suspend fun getCliInstance(instanceId: String): CliInstanceWire {
        val context = requireActiveContext()
        requireLanForCli(context.record)
        return withTransportRetry {
            lanApiFor(context.record).getCliInstance(instanceId)
        }
    }

    override suspend fun launchCliInstance(
        preset: String,
        title: String?,
        initialPrompt: String?,
    ): CliInstanceWire {
        val context = requireActiveContext()
        requireLanForCli(context.record)
        val request = CliLaunchRequest(
            preset = preset,
            title = title?.trim().takeUnless { it.isNullOrBlank() },
            initialPrompt = initialPrompt?.trim().takeUnless { it.isNullOrBlank() },
        )
        return withTransportRetry {
            lanApiFor(context.record).launchCliInstance(request)
        }
    }

    override suspend fun closeCliInstance(instanceId: String) {
        val context = requireActiveContext()
        requireLanForCli(context.record)
        withTransportRetry {
            lanApiFor(context.record).closeCliInstance(instanceId)
        }
    }

    override suspend fun sendCliPrompt(instanceId: String, prompt: String) {
        val context = requireActiveContext()
        requireLanForCli(context.record)
        withTransportRetry {
            lanApiFor(context.record).sendCliPrompt(instanceId, CliPromptRequest(prompt = prompt))
        }
    }

    private fun requireLanForCli(record: PairedHostRecord) {
        if (isRemote(record)) {
            error("CLI instances are only available for LAN-paired hosts for now.")
        }
    }

    override fun observeInstanceEvents(
        instanceId: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        val snapshot = runCatching { kotlinx.coroutines.runBlocking { pairingStore.readSnapshot() } }.getOrNull() ?: return
        val activeHostId = snapshot.activeHostId ?: return
        val record = snapshot.pairedHosts.firstOrNull { it.hostId == activeHostId } ?: return

        val path = if (isRemote(record)) {
            "v2/mobile/hosts/${record.hostId}/instances/${instanceId}/updates"
        } else {
            "v1/instances/${instanceId}/updates"
        }

        sseEventStreamClient.start(
            baseUrl = connectionBaseUrl(record),
            streamPath = path,
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
        var record = snapshot.pairedHosts.firstOrNull { it.hostId == activeHostId }
            ?: error("Active host not found")

        if (isRemote(record)) {
            record = refreshRemoteSessionIfNeeded(record)
        }

        return ActiveContext(record = record)
    }

    private suspend fun refreshRemoteSessionIfNeeded(record: PairedHostRecord): PairedHostRecord {
        val expiresAt = record.accessTokenExpiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
        if (expiresAt == null || expiresAt.isAfter(Instant.now().plusSeconds(30))) {
            return record
        }

        val refreshToken = record.refreshToken ?: error("Remote refresh token is missing")
        val refreshed = withTransportRetry {
            apiFactory.createRelay(
                connectionBaseUrl(record),
                tokenProvider = { null },
                certificatePinsetVersion = record.certificatePinsetVersion,
            ).refreshSession(RemoteSessionRefreshRequest(refreshToken = refreshToken))
        }

        val updated = record.copy(
            sessionToken = refreshed.accessToken,
            refreshToken = refreshed.refreshToken,
            accessTokenExpiresAt = refreshed.accessTokenExpiresAt,
            refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt,
        )
        pairingStore.upsert(updated)
        return updated
    }

    private suspend fun refreshRemotePresence(record: PairedHostRecord): PairedHostRecord {
        return try {
            val hostState = withTransportRetry { relayApiFor(record).listHosts() }.hosts.firstOrNull { it.hostId == record.hostId }
            record.copy(lastKnownHostPresence = hostState?.status ?: "offline")
        } catch (_: IOException) {
            record.copy(lastKnownHostPresence = "offline")
        }
    }

    private suspend fun refreshLanPresence(record: PairedHostRecord): PairedHostRecord {
        return try {
            withTransportRetry { lanApiFor(record).getHealth() }
            record.copy(lastKnownHostPresence = "online")
        } catch (_: IOException) {
            record.copy(lastKnownHostPresence = "offline")
        }
    }

    private fun lanApiFor(record: PairedHostRecord) = apiFactory.create(connectionBaseUrl(record)) { record.sessionToken }

    private fun relayApiFor(record: PairedHostRecord) = apiFactory.createRelay(
        connectionBaseUrl(record),
        tokenProvider = { record.sessionToken },
        certificatePinsetVersion = record.certificatePinsetVersion,
    )

    private fun connectionBaseUrl(record: PairedHostRecord): String {
        return if (isRemote(record)) record.relayUrl ?: record.baseUrl else record.baseUrl
    }

    private fun isRemote(record: PairedHostRecord): Boolean {
        return HostConnectionMode.fromWire(record.mode) == HostConnectionMode.REMOTE_RELAY
    }

    private suspend fun <T> withTransportRetry(block: suspend () -> T): T {
        return try {
            block()
        } catch (io: IOException) {
            delay(800)
            block()
        } catch (http: HttpException) {
            if (http.code() in 500..599) {
                delay(500)
                block()
            } else {
                throw http
            }
        }
    }

    private fun toUserFacingRemotePairError(throwable: Throwable): Throwable {
        if (throwable !is HttpException) {
            return throwable
        }

        val payload = throwable.response()?.errorBody()?.use { body ->
            runCatching { apiErrorAdapter.fromJson(body.string()) }.getOrNull()
        }
        val code = payload?.error?.trim().orEmpty()
        val message = when (code) {
            "bootstrap_token_used" -> "This pairing QR was already used. Generate a fresh QR on the host."
            "bootstrap_token_expired" -> "This pairing QR expired. Generate a fresh QR on the host."
            "claim_rejected" -> "Pairing was rejected on the host"
            "claim_not_ready" -> "Pairing did not finish on the relay. Keep the host pairing window open and try a fresh QR."
            "claim_not_found" -> "Pairing claim is no longer available. Generate a fresh QR on the host."
            "host_offline" -> "The host is offline. Keep the pairing window open and try again."
            else -> payload?.detail?.takeIf { it.isNotBlank() }
                ?: payload?.error?.takeIf { it.isNotBlank() }?.replace('_', ' ')
                ?: throwable.message()
                ?: "HTTP ${throwable.code()}"
        }
        return IllegalStateException(message, throwable)
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
            restoreRef = instance.restoreRef?.takeIf { it.isNotBlank() },
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
            snapshot = instance.snapshot,
            chat = instance.chat ?: emptyList(),
            summaryText = instance.summaryText?.takeIf { it.isNotBlank() },
            terminalsByAgent = instance.terminalsByAgent ?: emptyMap(),
            restoreStatePath = preferredRestorePath(instance),
            restoreRef = instance.restoreRef?.takeIf { it.isNotBlank() },
            runLogPath = preferredRunLogPath(instance),
            trustStatus = instance.snapshot?.trustStatus?.takeIf { it.isNotBlank() },
            pendingTrustProject = instance.snapshot?.pendingTrustProject?.takeIf { it.isNotBlank() },
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
