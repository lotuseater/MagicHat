package com.magichat.mobile.storage

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.magichat.mobile.model.PairedHostRecord
import com.magichat.mobile.network.MoshiFactory
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Types
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.pairingDataStore by preferencesDataStore(name = "magichat_pairing")

data class PairingSnapshot(
    val pairedHosts: List<PairedHostRecord>,
    val activeHostId: String?,
)

interface PairingStoreContract {
    val state: Flow<PairingSnapshot>

    suspend fun readSnapshot(): PairingSnapshot
    suspend fun upsert(record: PairedHostRecord)
    suspend fun setActiveHost(hostId: String)
    suspend fun removeHost(hostId: String)
}

class PairingStore(
    private val context: Context,
) : PairingStoreContract {
    private val hostListAdapter: JsonAdapter<List<PairedHostRecord>> =
        MoshiFactory.instance.adapter(
            Types.newParameterizedType(List::class.java, PairedHostRecord::class.java),
        )

    override val state: Flow<PairingSnapshot> = context.pairingDataStore.data.map { prefs ->
        decodeSnapshot(prefs)
    }

    override suspend fun readSnapshot(): PairingSnapshot = state.first()

    override suspend fun upsert(record: PairedHostRecord) {
        context.pairingDataStore.edit { prefs ->
            val snapshot = decodeSnapshot(prefs)
            val nextHosts = snapshot.pairedHosts
                .filterNot { it.hostId == record.hostId }
                .plus(record)
                .sortedBy { it.displayName.lowercase() }
            prefs[PAIRED_HOSTS_JSON] = hostListAdapter.toJson(nextHosts)
            prefs[ACTIVE_HOST_ID] = record.hostId
        }
    }

    override suspend fun setActiveHost(hostId: String) {
        context.pairingDataStore.edit { prefs ->
            prefs[ACTIVE_HOST_ID] = hostId
        }
    }

    override suspend fun removeHost(hostId: String) {
        context.pairingDataStore.edit { prefs ->
            val snapshot = decodeSnapshot(prefs)
            val nextHosts = snapshot.pairedHosts.filterNot { it.hostId == hostId }
            prefs[PAIRED_HOSTS_JSON] = hostListAdapter.toJson(nextHosts)
            if (snapshot.activeHostId == hostId) {
                if (nextHosts.isNotEmpty()) {
                    prefs[ACTIVE_HOST_ID] = nextHosts.first().hostId
                } else {
                    prefs.remove(ACTIVE_HOST_ID)
                }
            }
        }
    }

    private fun decodeSnapshot(prefs: Preferences): PairingSnapshot {
        val hostsJson = prefs[PAIRED_HOSTS_JSON] ?: "[]"
        val hosts = runCatching { hostListAdapter.fromJson(hostsJson).orEmpty() }.getOrDefault(emptyList())
        val activeHostId = prefs[ACTIVE_HOST_ID]
            ?.takeIf { active -> hosts.any { it.hostId == active } }

        return PairingSnapshot(
            pairedHosts = hosts,
            activeHostId = activeHostId,
        )
    }

    private companion object {
        val PAIRED_HOSTS_JSON = stringPreferencesKey("paired_hosts_json")
        val ACTIVE_HOST_ID = stringPreferencesKey("active_host_id")
    }
}
