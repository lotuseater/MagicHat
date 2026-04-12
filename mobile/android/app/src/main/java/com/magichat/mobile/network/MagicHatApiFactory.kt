package com.magichat.mobile.network

import okhttp3.OkHttpClient
import okhttp3.CertificatePinner
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

class MagicHatApiFactory {
    fun create(baseUrl: String, tokenProvider: () -> String?): MagicHatApiService {
        val normalizedBaseUrl = normalizeBaseUrl(baseUrl)
        return Retrofit.Builder()
            .baseUrl(normalizedBaseUrl)
            .addConverterFactory(MoshiConverterFactory.create(MoshiFactory.instance))
            .client(buildClient(tokenProvider))
            .build()
            .create(MagicHatApiService::class.java)
    }

    fun createRelay(
        baseUrl: String,
        tokenProvider: () -> String?,
        certificatePinsetVersion: String? = null,
    ): MagicHatRelayApiService {
        val normalizedBaseUrl = RelayTrustPolicy.validateRelayBaseUrl(baseUrl)
        val pins = RelayTrustPolicy.pinsForVersion(certificatePinsetVersion)
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .apply {
                maybeApplyCertificatePins(this, normalizedBaseUrl, pins)
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(normalizedBaseUrl)
            .addConverterFactory(MoshiConverterFactory.create(MoshiFactory.instance))
            .client(client)
            .build()
            .create(MagicHatRelayApiService::class.java)
    }

    fun createRawClient(token: String?): OkHttpClient {
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor { token })
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }

    private fun buildClient(tokenProvider: () -> String?): OkHttpClient {
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private fun maybeApplyCertificatePins(
        builder: OkHttpClient.Builder,
        baseUrl: String,
        pins: List<String>,
    ) {
        val normalized = normalizeBaseUrl(baseUrl)
        if (!normalized.startsWith("https://")) {
            return
        }
        if (pins.isEmpty()) {
            return
        }

        val host = java.net.URI(normalized).host ?: return
        val certificatePinner = CertificatePinner.Builder().apply {
            pins.forEach { add(host, it) }
        }.build()
        builder.certificatePinner(certificatePinner)
    }

    private fun normalizeBaseUrl(baseUrl: String): String {
        return if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"
    }
}
