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
        val instanceId: String,
        val token: String,
    )

    private var active: StreamConfig? = null
    private var eventSource: EventSource? = null
    private var reconnectJob: Job? = null
    private var onEvent: ((InstanceEvent) -> Unit)? = null
    private var onState: ((String) -> Unit)? = null
    private var closedByClient = false

    fun start(
        baseUrl: String,
        instanceId: String,
        token: String,
        onEvent: (InstanceEvent) -> Unit,
        onState: (String) -> Unit,
    ) {
        stop()
        closedByClient = false
        this.active = StreamConfig(baseUrl, instanceId, token)
        this.onEvent = onEvent
        this.onState = onState
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
                "${config.baseUrl.trimEnd('/')}/v1/instances/${config.instanceId}/updates",
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
                    val parsed = adapter.fromJson(data)
                    if (parsed != null) {
                        onEvent?.invoke(parsed)
                        return
                    }

                    onEvent?.invoke(
                        InstanceEvent(
                            type = type ?: "message",
                            instanceId = config.instanceId,
                            message = data,
                        ),
                    )
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
