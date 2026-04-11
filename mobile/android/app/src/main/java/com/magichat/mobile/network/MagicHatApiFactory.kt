package com.magichat.mobile.network

import okhttp3.OkHttpClient
import okhttp3.CertificatePinner
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

class MagicHatApiFactory {
    fun create(baseUrl: String, tokenProvider: () -> String?): MagicHatApiService {
        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
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
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .apply {
                maybeApplyCertificatePins(this, baseUrl, certificatePinsetVersion)
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
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
        certificatePinsetVersion: String?,
    ) {
        val normalized = normalizeBaseUrl(baseUrl)
        if (!normalized.startsWith("https://")) {
            return
        }

        val pins: List<String> = when (certificatePinsetVersion) {
            "dev-insecure", null -> emptyList()
            else -> emptyList()
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
