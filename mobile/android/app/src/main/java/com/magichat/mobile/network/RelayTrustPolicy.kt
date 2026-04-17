package com.magichat.mobile.network

import com.magichat.mobile.BuildConfig
import java.net.URI

internal object RelayTrustPolicy {
    private val developmentHosts = setOf(
        "localhost",
        "127.0.0.1",
        "::1",
        "10.0.2.2",
        "10.0.3.2",
    )

    private val pinsetsByVersion: Map<String, List<String>> = buildMap {
        parsePins(BuildConfig.MAGICHAT_RELAY_PINSET_V1).takeIf { it.isNotEmpty() }?.let { pins ->
            put("v1", pins)
        }
    }

    fun validateRelayBaseUrl(baseUrl: String): String {
        val normalized = normalizeBaseUrl(baseUrl)
        val uri = runCatching { URI(normalized) }.getOrElse {
            throw IllegalArgumentException("Relay URL is missing or invalid", it)
        }
        val scheme = uri.scheme?.lowercase()
            ?: throw IllegalArgumentException("Relay URL is missing or invalid")
        val host = uri.host?.trim()?.trim('[', ']')?.lowercase()
            ?: throw IllegalArgumentException("Relay URL is missing or invalid")

        when (scheme) {
            "https" -> return normalized
            "http" -> {
                require(isDevelopmentRelayHost(host)) {
                    "Relay URL must use HTTPS unless it targets a local development relay"
                }
                return normalized
            }
            else -> throw IllegalArgumentException("Relay URL must use HTTP or HTTPS")
        }
    }

    fun pinsForVersion(certificatePinsetVersion: String?): List<String> {
        val normalized = certificatePinsetVersion?.trim().orEmpty()
        return when {
            normalized.isEmpty() || normalized == "dev-insecure" -> emptyList()
            else -> pinsetsByVersion[normalized]
                ?: throw IllegalArgumentException("Unknown relay certificate pinset version: $normalized")
        }
    }

    private fun isDevelopmentRelayHost(host: String): Boolean {
        val normalized = host.trim().trim('[', ']').lowercase()
        return normalized in developmentHosts ||
            normalized.startsWith("127.") ||
            isPrivateIpv4Host(normalized)
    }

    private fun isPrivateIpv4Host(host: String): Boolean {
        val octets = host.split('.')
        if (octets.size != 4) {
            return false
        }
        val numbers = octets.map { it.toIntOrNull() ?: return false }
        if (numbers.any { it !in 0..255 }) {
            return false
        }

        return when {
            numbers[0] == 10 -> true
            numbers[0] == 172 && numbers[1] in 16..31 -> true
            numbers[0] == 192 && numbers[1] == 168 -> true
            else -> false
        }
    }

    private fun parsePins(rawPins: String): List<String> {
        return rawPins
            .split(',', ';', '\n', '\r')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    private fun normalizeBaseUrl(baseUrl: String): String {
        val trimmed = baseUrl.trim()
        return if (trimmed.endsWith('/')) trimmed else "$trimmed/"
    }
}
