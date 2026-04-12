package com.magichat.mobile.state

import com.google.common.truth.Truth.assertThat
import com.magichat.mobile.model.KnownRestoreRef
import org.junit.Test

class RestoreSelectorResolverTest {
    @Test
    fun resolvesKnownRestoreRefDirectly() {
        val request = resolveRestoreLaunchRequest(
            selector = "restore_alpha",
            knownRestoreRefs = listOf(
                KnownRestoreRef(
                    restoreRef = "restore_alpha",
                    title = "Restore Alpha",
                    sessionId = "session-alpha",
                ),
            ),
            allowRawPathFallback = true,
        )

        assertThat(request.restoreRef).isEqualTo("restore_alpha")
        assertThat(request.restoreStatePath).isNull()
    }

    @Test
    fun resolvesKnownSessionIdToRestoreRef() {
        val request = resolveRestoreLaunchRequest(
            selector = "session-alpha",
            knownRestoreRefs = listOf(
                KnownRestoreRef(
                    restoreRef = "restore_alpha",
                    title = "Restore Alpha",
                    sessionId = "session-alpha",
                ),
            ),
            allowRawPathFallback = true,
        )

        assertThat(request.restoreRef).isEqualTo("restore_alpha")
        assertThat(request.restoreStatePath).isNull()
    }

    @Test
    fun keepsRawPathFallbackForLanOnly() {
        val request = resolveRestoreLaunchRequest(
            selector = "C:/wizard_team_app/runs/session-alpha/session_restore.json",
            knownRestoreRefs = emptyList(),
            allowRawPathFallback = true,
        )

        assertThat(request.restoreStatePath).isEqualTo("C:/wizard_team_app/runs/session-alpha/session_restore.json")
        assertThat(request.restoreRef).isNull()
    }

    @Test
    fun prefersOpaqueRestoreRefWhenRawPathsAreNotAllowed() {
        val request = resolveRestoreLaunchRequest(
            selector = "session-alpha",
            knownRestoreRefs = emptyList(),
            allowRawPathFallback = false,
        )

        assertThat(request.restoreRef).isEqualTo("session-alpha")
        assertThat(request.restoreStatePath).isNull()
    }
}
