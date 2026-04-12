package com.magichat.mobile.state

import com.magichat.mobile.model.KnownRestoreRef
import com.magichat.mobile.model.LaunchInstanceRequest

internal fun resolveRestoreLaunchRequest(
    selector: String,
    knownRestoreRefs: List<KnownRestoreRef>,
    allowRawPathFallback: Boolean,
): LaunchInstanceRequest {
    val trimmed = selector.trim()
    require(trimmed.isNotEmpty()) { "Restore selector is required" }

    val knownMatch = knownRestoreRefs.firstOrNull { ref ->
        ref.restoreRef.equals(trimmed, ignoreCase = false) ||
            ref.sessionId.equals(trimmed, ignoreCase = false)
    }
    if (knownMatch != null) {
        return LaunchInstanceRequest(restoreRef = knownMatch.restoreRef)
    }

    if (allowRawPathFallback && looksLikeRestorePath(trimmed)) {
        return LaunchInstanceRequest(restoreStatePath = trimmed)
    }

    return LaunchInstanceRequest(restoreRef = trimmed)
}

private fun looksLikeRestorePath(value: String): Boolean {
    return value.contains('/') || value.contains('\\') || value.endsWith(".json", ignoreCase = true)
}
