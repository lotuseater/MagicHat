package com.magichat.mobile.network

import okhttp3.Interceptor
import okhttp3.Response

class AuthInterceptor(
    private val tokenProvider: () -> String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val isPairCall = request.url.encodedPath.endsWith("/pair")
        val token = tokenProvider()

        if (isPairCall || token.isNullOrBlank()) {
            return chain.proceed(request)
        }

        val authed = request.newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(authed)
    }
}
