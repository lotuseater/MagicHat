package com.magichat.mobile.network

import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

class MagicHatApiFactory {
    fun create(baseUrl: String, tokenProvider: () -> String?): MagicHatApiService {
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .addConverterFactory(MoshiConverterFactory.create(MoshiFactory.instance))
            .client(client)
            .build()
            .create(MagicHatApiService::class.java)
    }

    fun createRawClient(token: String?): OkHttpClient {
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor { token })
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }

    private fun normalizeBaseUrl(baseUrl: String): String {
        return if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"
    }
}
