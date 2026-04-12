package com.magichat.mobile.network

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.time.Instant

data class RemotePairingUri(
    val relayUrl: String,
    val hostId: String,
    val hostName: String,
    val bootstrapToken: String,
    val hostFingerprint: String,
    val expiresAt: String,
) {
    companion object {
        fun parse(raw: String): RemotePairingUri {
            val uri = URI(raw.trim())
            require(uri.scheme.equals("magichat", ignoreCase = true)) { "Pair URI must start with magichat://" }
            require(uri.host.equals("pair", ignoreCase = true)) { "Pair URI host must be pair" }

            val query = linkedMapOf<String, String>()
            val rawQuery = uri.rawQuery ?: ""
            if (rawQuery.isNotBlank()) {
                rawQuery.split("&")
                    .filter { it.isNotBlank() }
                    .forEach { entry ->
                        val pieces = entry.split("=", limit = 2)
                        val key = URLDecoder.decode(pieces[0], StandardCharsets.UTF_8)
                        val value = URLDecoder.decode(pieces.getOrElse(1) { "" }, StandardCharsets.UTF_8)
                        query[key] = value
                    }
            }

            require(query["v"] == "2") { "Only MagicHat pair protocol v2 is supported" }
            val relay = query["relay"].orEmpty().trim()
            val hostId = query["host_id"].orEmpty().trim()
            val hostName = query["host_name"].orEmpty().trim()
            val bootstrapToken = query["bootstrap_token"].orEmpty().trim()
            val hostFingerprint = query["host_fingerprint"].orEmpty().trim()
            val expiresAt = query["exp"].orEmpty().trim()

            val normalizedRelayUrl = RelayTrustPolicy.validateRelayBaseUrl(relay)
            require(hostId.isNotBlank()) { "Host ID is missing" }
            require(hostName.isNotBlank()) { "Host name is missing" }
            require(bootstrapToken.isNotBlank()) { "Bootstrap token is missing" }
            require(hostFingerprint.isNotBlank()) { "Host fingerprint is missing" }
            require(expiresAt.isNotBlank()) { "Expiry is missing" }
            require(Instant.parse(expiresAt).isAfter(Instant.now())) { "Pair URI is expired" }

            return RemotePairingUri(
                relayUrl = normalizedRelayUrl,
                hostId = hostId,
                hostName = hostName,
                bootstrapToken = bootstrapToken,
                hostFingerprint = hostFingerprint,
                expiresAt = expiresAt,
            )
        }
    }
}
