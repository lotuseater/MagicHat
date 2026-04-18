package com.magichat.mobile.network

import com.google.common.truth.Truth.assertThat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test

class TokenRefreshInterceptorTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun clientWith(refresher: SessionRefresher): OkHttpClient {
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor { "stale-token" })
            .addInterceptor(TokenRefreshInterceptor(refresher))
            .build()
    }

    @Test
    fun `401 triggers refresh and replays request with new bearer`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("unauthorized"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("ok"))

        var refreshCalls = 0
        val client = clientWith { previous ->
            refreshCalls += 1
            assertThat(previous).isEqualTo("stale-token")
            "fresh-token"
        }

        val request = Request.Builder().url(server.url("/v1/something")).build()
        val response = client.newCall(request).execute()
        assertThat(response.code).isEqualTo(200)
        assertThat(refreshCalls).isEqualTo(1)

        val first = server.takeRequest()
        val second = server.takeRequest()
        assertThat(first.getHeader("Authorization")).isEqualTo("Bearer stale-token")
        assertThat(second.getHeader("Authorization")).isEqualTo("Bearer fresh-token")
    }

    @Test
    fun `401 with null refresh result is surfaced unchanged`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("unauthorized"))

        val client = clientWith { null }

        val request = Request.Builder().url(server.url("/v1/something")).build()
        val response = client.newCall(request).execute()
        assertThat(response.code).isEqualTo(401)
    }

    @Test
    fun `does not retry a second time to avoid infinite loops`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))

        var refreshCalls = 0
        val client = clientWith { _ ->
            refreshCalls += 1
            "fresh-token"
        }

        val request = Request.Builder().url(server.url("/v1/something")).build()
        val response = client.newCall(request).execute()
        assertThat(response.code).isEqualTo(401)
        // One refresh attempt, one retry — no infinite recursion.
        assertThat(refreshCalls).isEqualTo(1)
        assertThat(server.requestCount).isEqualTo(2)
    }

    @Test
    fun `2xx passes through without calling the refresher`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("ok"))

        var refreshCalls = 0
        val client = clientWith { _ ->
            refreshCalls += 1
            "never"
        }

        val request = Request.Builder().url(server.url("/v1/something")).build()
        val response = client.newCall(request).execute()
        assertThat(response.code).isEqualTo(200)
        assertThat(refreshCalls).isEqualTo(0)
    }
}
