package com.magichat.mobile.model

import com.squareup.moshi.Json

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
)

data class TeamAppInstance(
    @Json(name = "instance_id") val instanceId: String,
    val title: String,
    val active: Boolean,
    val health: String,
    @Json(name = "result_preview") val resultPreview: String? = null,
    @Json(name = "session_id") val sessionId: String? = null,
    val pid: Int? = null,
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
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
    @Json(name = "restore_state_path") val restoreStatePath: String? = null,
    @Json(name = "run_log_path") val runLogPath: String? = null,
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
    @Json(name = "startup_timeout_ms") val startupTimeoutMs: Int? = null,
)

data class PromptRequest(
    val prompt: String,
)

data class FollowUpRequest(
    val message: String,
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
