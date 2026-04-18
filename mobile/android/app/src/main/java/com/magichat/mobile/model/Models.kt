package com.magichat.mobile.model

import com.squareup.moshi.Json

enum class TeamModeOption(val wireValue: String, val label: String) {
    APP_DEFAULT("", "App default"),
    SIMPLE("simple", "Simple"),
    FULL("full", "Full");
}

enum class LauncherPresetOption(val wireValue: String, val label: String) {
    APP_DEFAULT("", "App default"),
    CLAUDE_CODE("claude-code", "Claude Code"),
    CODEX("codex", "Codex"),
    CLAUDE_LEGACY("claude-legacy", "Claude Legacy"),
    CUSTOM_LEGACY("custom-legacy", "Custom Legacy"),
    GEMINI("gemini", "Gemini");
}

enum class FenrusLauncherOption(val wireValue: String, val label: String) {
    APP_DEFAULT("", "App default"),
    DEFAULT("default", "Default"),
    CLAUDE_CODE("claude-code", "Claude Code"),
    CODEX("codex", "Codex"),
    CLAUDE_LEGACY("claude-legacy", "Claude Legacy"),
    CUSTOM_LEGACY("custom-legacy", "Custom Legacy"),
    GEMINI("gemini", "Gemini");
}

enum class HostConnectionMode {
    LAN_DIRECT,
    REMOTE_RELAY;

    companion object {
        fun fromWire(value: String?): HostConnectionMode {
            return when (value?.lowercase()) {
                "remote_relay" -> REMOTE_RELAY
                else -> LAN_DIRECT
            }
        }
    }
}

enum class InstanceHealthState {
    IDLE,
    RUNNING,
    BLOCKED,
    FAILED,
    FINISHED;

    companion object {
        fun fromWire(value: String?): InstanceHealthState {
            return when (value?.lowercase()) {
                "running", "planning", "executing", "reviewing" -> RUNNING
                "blocked", "needs_attention" -> BLOCKED
                "failed", "error" -> FAILED
                "finished", "complete" -> FINISHED
                else -> IDLE
            }
        }
    }
}

data class BeaconHost(
    @Json(name = "host_id") val hostId: String,
    @Json(name = "display_name") val displayName: String,
    val address: String,
    @Json(name = "last_seen_at") val lastSeenAt: String? = null,
)

data class PairedHostRecord(
    @Json(name = "host_id") val hostId: String,
    @Json(name = "display_name") val displayName: String,
    @Json(name = "base_url") val baseUrl: String,
    @Json(name = "session_token") val sessionToken: String,
    @Json(name = "paired_at") val pairedAt: String,
    val mode: String = HostConnectionMode.LAN_DIRECT.name.lowercase(),
    @Json(name = "relay_url") val relayUrl: String? = null,
    @Json(name = "device_id") val deviceId: String? = null,
    @Json(name = "refresh_token") val refreshToken: String? = null,
    @Json(name = "access_token_expires_at") val accessTokenExpiresAt: String? = null,
    @Json(name = "refresh_token_expires_at") val refreshTokenExpiresAt: String? = null,
    @Json(name = "certificate_pinset_version") val certificatePinsetVersion: String? = null,
    @Json(name = "last_known_host_presence") val lastKnownHostPresence: String? = null,
)

fun PairedHostRecord.effectivePresence(presenceOverride: String? = null): String? {
    return presenceOverride?.takeIf { it.isNotBlank() } ?: lastKnownHostPresence?.takeIf { it.isNotBlank() }
}

fun PairedHostRecord.connectionModeLabel(): String {
    return when (HostConnectionMode.fromWire(mode)) {
        HostConnectionMode.REMOTE_RELAY -> "Remote relay"
        HostConnectionMode.LAN_DIRECT -> "LAN direct"
    }
}

fun PairedHostRecord.presenceLabel(presenceOverride: String? = null): String? {
    return effectivePresence(presenceOverride)?.replace('_', ' ')
}

fun PairedHostRecord.canRunCommands(presenceOverride: String? = null): Boolean {
    return when (effectivePresence(presenceOverride)?.lowercase()) {
        "offline", "unreachable", "disconnected" -> false
        else -> true
    }
}

fun PairedHostRecord.endpointLabel(): String {
    return if (HostConnectionMode.fromWire(mode) == HostConnectionMode.REMOTE_RELAY) {
        "Relay: ${relayUrl ?: baseUrl}"
    } else {
        "Endpoint: $baseUrl"
    }
}

data class TeamAppInstance(
    @Json(name = "instance_id") val instanceId: String,
    val title: String,
    val active: Boolean,
    val health: String,
    @Json(name = "result_preview") val resultPreview: String? = null,
    @Json(name = "session_id") val sessionId: String? = null,
    val pid: Int? = null,
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
    @Json(name = "restore_ref") val restoreRef: String? = null,
)

data class ProgressSnapshot(
    @Json(name = "step_label") val stepLabel: String? = null,
    @Json(name = "completed_steps") val completedSteps: Int? = null,
    @Json(name = "total_steps") val totalSteps: Int? = null,
    @Json(name = "updated_at") val updatedAt: String? = null,
)

data class InstanceDetail(
    val instance: TeamAppInstance,
    val progress: ProgressSnapshot? = null,
    @Json(name = "latest_output") val latestOutput: String? = null,
    val status: String = "unknown",
    val snapshot: SnapshotWire? = null,
    val chat: List<Map<String, Any?>> = emptyList(),
    @Json(name = "summary_text") val summaryText: String? = null,
    @Json(name = "terminals_by_agent") val terminalsByAgent: Map<String, String> = emptyMap(),
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
    @Json(name = "restore_ref") val restoreRef: String? = null,
    @Json(name = "run_log_path") val runLogPath: String? = null,
    @Json(name = "trust_status") val trustStatus: String? = null,
    @Json(name = "pending_trust_project") val pendingTrustProject: String? = null,
)

data class SubmissionReceipt(
    val status: String,
)

data class PairRequest(
    @Json(name = "pairing_code") val pairingCode: String,
    @Json(name = "device_name") val deviceName: String,
    @Json(name = "device_id") val deviceId: String? = null,
)

data class PairResponse(
    @Json(name = "session_token") val sessionToken: String,
    @Json(name = "expires_at") val expiresAt: String,
    @Json(name = "host_id") val hostId: String,
    @Json(name = "host_name") val hostName: String,
)

data class HostInfoResponse(
    @Json(name = "host_id") val hostId: String,
    @Json(name = "host_name") val hostName: String,
    @Json(name = "lan_address") val lanAddress: String,
    @Json(name = "api_version") val apiVersion: String,
    val scope: String? = null,
)

data class RemotePairClaimRequest(
    @Json(name = "bootstrap_token") val bootstrapToken: String,
    @Json(name = "device_name") val deviceName: String,
    val platform: String,
    @Json(name = "device_public_key") val devicePublicKey: String,
)

data class RemotePairClaimResponse(
    @Json(name = "claim_id") val claimId: String,
    val status: String,
    @Json(name = "host_id") val hostId: String,
    @Json(name = "host_name") val hostName: String,
)

data class RemoteClaimStatusResponse(
    @Json(name = "claim_id") val claimId: String,
    val status: String,
    val challenge: String? = null,
    @Json(name = "host_id") val hostId: String? = null,
    @Json(name = "host_name") val hostName: String? = null,
)

data class RemoteDeviceRegisterRequest(
    @Json(name = "claim_id") val claimId: String,
    val challenge: String,
    val signature: String,
)

data class RemoteDeviceRegisterResponse(
    @Json(name = "host_id") val hostId: String,
    @Json(name = "host_name") val hostName: String? = null,
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "access_token_expires_at") val accessTokenExpiresAt: String,
    @Json(name = "refresh_token") val refreshToken: String,
    @Json(name = "refresh_token_expires_at") val refreshTokenExpiresAt: String,
    @Json(name = "certificate_pinset_version") val certificatePinsetVersion: String? = null,
)

data class RemoteSessionRefreshRequest(
    @Json(name = "refresh_token") val refreshToken: String,
)

data class RemoteSessionRefreshResponse(
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "access_token_expires_at") val accessTokenExpiresAt: String,
    @Json(name = "refresh_token") val refreshToken: String,
    @Json(name = "refresh_token_expires_at") val refreshTokenExpiresAt: String,
)

data class RemoteHostWire(
    @Json(name = "host_id") val hostId: String,
    @Json(name = "host_name") val hostName: String,
    val status: String,
    @Json(name = "last_seen_at") val lastSeenAt: String? = null,
)

data class RemoteHostsResponse(
    val hosts: List<RemoteHostWire>,
)

data class KnownRestoreRef(
    @Json(name = "restore_ref") val restoreRef: String,
    val title: String? = null,
    @Json(name = "session_id") val sessionId: String? = null,
    @Json(name = "observed_at") val observedAt: String? = null,
)

data class RestoreRefsResponse(
    @Json(name = "restore_refs") val restoreRefs: List<KnownRestoreRef>,
)

data class HealthzResponse(
    val status: String,
    val service: String? = null,
    val ts: Long? = null,
)

data class ResultSummaryWire(
    @Json(name = "short_text") val shortText: String? = null,
    val source: String? = null,
    val truncated: Boolean? = null,
)

data class TaskStateWire(
    val phase: String? = null,
    val task: String? = null,
    @Json(name = "workers_done") val workersDone: Int? = null,
    @Json(name = "pending_resumes") val pendingResumes: Int? = null,
    @Json(name = "review_round") val reviewRound: Int? = null,
    @Json(name = "oversight_round") val oversightRound: Int? = null,
)

data class RestoreRefsWire(
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
    @Json(name = "run_log_path") val runLogPath: String? = null,
)

data class SnapshotWire(
    val phase: String? = null,
    @Json(name = "task_state") val taskState: TaskStateWire? = null,
    @Json(name = "result_summary") val resultSummary: ResultSummaryWire? = null,
    @Json(name = "restore_refs") val restoreRefs: RestoreRefsWire? = null,
    @Json(name = "trust_status") val trustStatus: String? = null,
    @Json(name = "pending_trust_project") val pendingTrustProject: String? = null,
)

data class InstanceWire(
    @Json(name = "instance_id") val instanceId: String? = null,
    val pid: Int,
    val hwnd: Long? = null,
    @Json(name = "session_id") val sessionId: String? = null,
    val phase: String? = null,
    @Json(name = "current_task_state") val currentTaskState: TaskStateWire? = null,
    @Json(name = "artifact_dir") val artifactDir: String? = null,
    @Json(name = "cmd_path") val cmdPath: String? = null,
    @Json(name = "resp_path") val respPath: String? = null,
    @Json(name = "events_path") val eventsPath: String? = null,
    @Json(name = "run_artifact_dir") val runArtifactDir: String? = null,
    @Json(name = "run_log_path") val runLogPath: String? = null,
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
    @Json(name = "restore_ref") val restoreRef: String? = null,
    @Json(name = "started_at") val startedAt: Long? = null,
    @Json(name = "result_summary") val resultSummary: ResultSummaryWire? = null,
    val status: String? = null,
    val snapshot: SnapshotWire? = null,
    val chat: List<Map<String, Any?>>? = null,
    @Json(name = "summary_text") val summaryText: String? = null,
    @Json(name = "terminals_by_agent") val terminalsByAgent: Map<String, String>? = null,
)

data class LaunchInstanceRequest(
    val title: String? = null,
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
    @Json(name = "restore_ref") val restoreRef: String? = null,
    @Json(name = "startup_timeout_ms") val startupTimeoutMs: Int? = null,
    @Json(name = "team_mode") val teamMode: String? = null,
    @Json(name = "launcher_preset") val launcherPreset: String? = null,
    @Json(name = "fenrus_launcher") val fenrusLauncher: String? = null,
)

data class PromptRequest(
    val prompt: String,
)

data class FollowUpRequest(
    val message: String,
)

data class TrustRequest(
    val approved: Boolean,
)

data class InstanceEvent(
    val type: String,
    @Json(name = "instance_id") val instanceId: String? = null,
    val message: String? = null,
    @Json(name = "output_chunk") val outputChunk: String? = null,
    val health: String? = null,
    @Json(name = "updated_at") val updatedAt: String? = null,
)

data class InstancesResponse(val instances: List<InstanceWire>)

data class CliPreset(
    val preset: String,
    val label: String,
    val command: String,
    @Json(name = "default_args") val defaultArgs: List<String> = emptyList(),
)

data class CliPresetsResponse(
    val presets: List<CliPreset>,
)

data class CliInstanceWire(
    @Json(name = "instance_id") val instanceId: String,
    val preset: String,
    @Json(name = "preset_label") val presetLabel: String,
    val title: String,
    val command: String,
    val args: List<String> = emptyList(),
    val pid: Int? = null,
    @Json(name = "started_at") val startedAt: Long? = null,
    @Json(name = "ended_at") val endedAt: Long? = null,
    @Json(name = "exit_code") val exitCode: Int? = null,
    @Json(name = "exit_signal") val exitSignal: String? = null,
    val status: String,
    val output: String = "",
    @Json(name = "event_count") val eventCount: Int = 0,
)

data class CliInstancesResponse(
    val instances: List<CliInstanceWire>,
)

data class CliLaunchRequest(
    val preset: String,
    val title: String? = null,
    @Json(name = "initial_prompt") val initialPrompt: String? = null,
    @Json(name = "extra_args") val extraArgs: List<String>? = null,
)

data class CliPromptRequest(
    val prompt: String,
)
