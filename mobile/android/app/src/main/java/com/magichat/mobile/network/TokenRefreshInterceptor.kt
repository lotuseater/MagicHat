package com.magichat.mobile.network

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Invoked when the relay responds 401 on a protected endpoint. Returns the
 * freshly-refreshed access token, or null if refresh failed / isn't possible
 * for this host (e.g., LAN-paired records have no refresh_token).
 *
 * The contract is: the implementation must persist the new tokens before
 * returning so concurrent callers see the rotated token. Returning the same
 * token the interceptor already used signals "give up — show the 401".
 */
fun interface SessionRefresher {
    suspend fun refreshAccessToken(previousToken: String?): String?
}

/**
 * Adds transparent session refresh on 401 responses. The interceptor first
 * tags the request with a custom header so we can tell retried requests
 * apart from fresh ones and avoid infinite 401 loops.
 */
class TokenRefreshInterceptor(
    private val refresher: SessionRefresher,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        if (original.header(RETRY_HEADER) != null) {
            return chain.proceed(original)
        }

        val response = chain.proceed(original)
        if (response.code != 401) {
            return response
        }

        val previousAuth = original.header("Authorization")
        val previousToken = previousAuth?.removePrefix("Bearer ")?.trim().orEmpty()

        val newToken = runBlocking { refresher.refreshAccessToken(previousToken) }
        if (newToken.isNullOrBlank() || newToken == previousToken) {
            return response
        }

        response.close()

        val retried = original.newBuilder()
            .removeHeader("Authorization")
            .header("Authorization", "Bearer $newToken")
            .header(RETRY_HEADER, "1")
            .build()
        return chain.proceed(retried)
    }

    companion object {
        private const val RETRY_HEADER = "X-MagicHat-Retry-After-Refresh"
    }
}
