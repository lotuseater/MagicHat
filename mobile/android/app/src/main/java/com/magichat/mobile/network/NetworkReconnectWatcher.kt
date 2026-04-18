package com.magichat.mobile.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/**
 * Listens for Android connectivity transitions (wifi ↔ cellular, captive
 * portal → real internet) and invokes the provided callback so the caller
 * can proactively drop + reconnect long-lived connections (SSE, WebSocket).
 *
 * OkHttp's EventSource can hang for 30+ s on IP changes because the OS-level
 * socket stays readable until a keepalive fails. Reacting to
 * ConnectivityManager lets us short-circuit that dead window.
 */
class NetworkReconnectWatcher(
    context: Context,
    private val onInternetAvailable: () -> Unit,
) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.CONNECTIVITY_SERVICE)
        as? ConnectivityManager
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        if (callback != null || manager == null) return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            private var seenNetwork: Network? = null
            override fun onAvailable(network: Network) {
                // Fire only when a usable network appears OR the active one
                // changes — both mean the previous SSE connection is likely
                // dead or on a stale IP.
                if (seenNetwork != network) {
                    seenNetwork = network
                    onInternetAvailable()
                }
            }
            override fun onLost(network: Network) {
                // Don't fire on loss; wait for the next onAvailable. Firing
                // here would bounce us while offline.
                if (seenNetwork == network) {
                    seenNetwork = null
                }
            }
        }
        try {
            manager.registerNetworkCallback(request, cb)
            callback = cb
        } catch (_: SecurityException) {
            // Missing permission or device unable to register — silently skip.
        }
    }

    fun stop() {
        val cb = callback ?: return
        callback = null
        runCatching { manager?.unregisterNetworkCallback(cb) }
    }
}
