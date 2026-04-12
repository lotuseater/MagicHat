package com.magichat.mobile.security

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

data class DeviceIdentity(
    val deviceId: String,
    val publicKeyBase64: String,
)

interface DeviceKeyStoreContract {
    fun getOrCreate(): DeviceIdentity
    fun sign(message: String): String
    fun clear()
}

class DeviceKeyStore(
    context: Context,
) : DeviceKeyStoreContract {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "magichat_remote_keys",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun getOrCreate(): DeviceIdentity {
        val existingPublic = prefs.getString(KEY_PUBLIC, null)
        val existingPrivate = prefs.getString(KEY_PRIVATE, null)
        val existingDeviceId = prefs.getString(KEY_DEVICE_ID, null)
        if (!existingPublic.isNullOrBlank() && !existingPrivate.isNullOrBlank() && !existingDeviceId.isNullOrBlank()) {
            return DeviceIdentity(
                deviceId = existingDeviceId,
                publicKeyBase64 = existingPublic,
            )
        }

        val keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val publicEncoded = encode(keyPair.public.encoded)
        val privateEncoded = encode(keyPair.private.encoded)
        val deviceId = "android-${java.util.UUID.randomUUID()}"

        prefs.edit()
            .putString(KEY_PUBLIC, publicEncoded)
            .putString(KEY_PRIVATE, privateEncoded)
            .putString(KEY_DEVICE_ID, deviceId)
            .apply()

        return DeviceIdentity(deviceId = deviceId, publicKeyBase64 = publicEncoded)
    }

    override fun sign(message: String): String {
        val privateKeyValue = prefs.getString(KEY_PRIVATE, null) ?: error("Remote device key is missing")
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(decodePrivateKey(privateKeyValue))
        signature.update(message.toByteArray(StandardCharsets.UTF_8))
        return encodeUrlSafe(signature.sign())
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    private fun decodePrivateKey(encoded: String): PrivateKey {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val spec = PKCS8EncodedKeySpec(bytes)
        return KeyFactory.getInstance("Ed25519").generatePrivate(spec)
    }

    @Suppress("unused")
    private fun decodePublicKey(encoded: String): PublicKey {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val spec = X509EncodedKeySpec(bytes)
        return KeyFactory.getInstance("Ed25519").generatePublic(spec)
    }

    private fun encode(bytes: ByteArray): String {
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun encodeUrlSafe(bytes: ByteArray): String {
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private companion object {
        const val KEY_PUBLIC = "device_public_key"
        const val KEY_PRIVATE = "device_private_key"
        const val KEY_DEVICE_ID = "device_id"
    }
}
