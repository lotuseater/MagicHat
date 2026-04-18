package com.magichat.mobile.network

import com.magichat.mobile.model.InstanceEvent
import com.squareup.moshi.JsonAdapter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

class SseEventStreamClient(
    private val apiFactory: MagicHatApiFactory,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    private val reconnectDelayMs: Long = 1_000,
) {
    private val adapter: JsonAdapter<InstanceEvent> = MoshiFactory.instance.adapter(InstanceEvent::class.java)

    private data class StreamConfig(
        val baseUrl: String,
        val streamPath: String,
        val token: String,
    )

    private var active: StreamConfig? = null
    private var eventSource: EventSource? = null
    private var reconnectJob: Job? = null
    private var onRaw: ((String?, String) -> Unit)? = null
    private var onState: ((String) -> Unit)? = null
    private var closedByClient = false

    fun start(
        baseUrl: String,
        streamPath: String,
        token: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        startRaw(
            baseUrl = baseUrl,
            streamPath = streamPath,
            token = token,
            onState = onState,
            onRaw = { type, data ->
                val parsed = runCatching { adapter.fromJson(data) }.getOrNull()
                if (parsed != null) {
                    onEvent(parsed)
                } else {
                    onEvent(
                        InstanceEvent(
                            type = type ?: "message",
                            instanceId = null,
                            message = data,
                        ),
                    )
                }
            },
        )
    }

    fun startRaw(
        baseUrl: String,
        streamPath: String,
        token: String,
        onState: (String) -> Unit,
        onRaw: (type: String?, data: String) -> Unit,
    ) {
        stop()
        closedByClient = false
        this.active = StreamConfig(baseUrl, streamPath, token)
        this.onState = onState
        this.onRaw = onRaw
        connect()
    }

    fun stop() {
        closedByClient = true
        reconnectJob?.cancel()
        reconnectJob = null
        eventSource?.cancel()
        eventSource = null
        active = null
    }

    private fun connect() {
        val config = active ?: return
        val client = apiFactory.createRawClient(config.token)
        val request = Request.Builder()
            .url(
                "${config.baseUrl.trimEnd('/')}/${config.streamPath.trimStart('/')}",
            )
            .build()

        onState?.invoke("connecting")

        eventSource = EventSources.createFactory(client).newEventSource(
            request,
            object : EventSourceListener() {
                override fun onOpen(eventSource: EventSource, response: Response) {
                    onState?.invoke("connected")
                }

                override fun onEvent(
                    eventSource: EventSource,
                    id: String?,
                    type: String?,
                    data: String,
                ) {
                    onRaw?.invoke(type, data)
                }

                override fun onClosed(eventSource: EventSource) {
                    onState?.invoke("closed")
                    scheduleReconnect()
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    onState?.invoke("disconnected:${t?.message ?: "network"}")
                    scheduleReconnect()
                }
            },
        )
    }

    private fun scheduleReconnect() {
        if (closedByClient) {
            return
        }
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(reconnectDelayMs)
            connect()
        }
    }
}
