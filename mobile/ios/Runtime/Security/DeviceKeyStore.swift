import CryptoKit
import Foundation
import Security

internal struct RemoteDeviceIdentity: Sendable {
    let deviceID: String
    let publicKeyBase64: String
}

internal actor DeviceKeyStore {
    private static let service = "com.magichat.remote"
    private static let publicAccount = "device_public_key"
    private static let privateAccount = "device_private_key"
    private static let deviceIDAccount = "device_id"
    private static let ed25519SpkiPrefix = Data([0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00])

    func getOrCreate() throws -> RemoteDeviceIdentity {
        if let publicKey = readData(account: Self.publicAccount),
           let _ = readData(account: Self.privateAccount),
           let deviceIDData = readData(account: Self.deviceIDAccount),
           let deviceID = String(data: deviceIDData, encoding: .utf8) {
            return RemoteDeviceIdentity(
                deviceID: deviceID,
                publicKeyBase64: publicKey.base64EncodedString()
            )
        }

        let privateKey = Curve25519.Signing.PrivateKey()
        let publicKey = Self.ed25519SpkiPrefix + privateKey.publicKey.rawRepresentation
        let deviceID = "ios-\(UUID().uuidString.lowercased())"

        try writeData(publicKey, account: Self.publicAccount)
        try writeData(privateKey.rawRepresentation, account: Self.privateAccount)
        try writeData(Data(deviceID.utf8), account: Self.deviceIDAccount)

        return RemoteDeviceIdentity(
            deviceID: deviceID,
            publicKeyBase64: publicKey.base64EncodedString()
        )
    }

    func sign(_ message: String) throws -> String {
        guard let privateKeyData = readData(account: Self.privateAccount) else {
            throw HostAPIError.noPairedHost
        }

        let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: privateKeyData)
        let signature = try privateKey.signature(for: Data(message.utf8))
        return base64URLEncoded(signature)
    }

    private func base64URLEncoded(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func readData(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else {
            return nil
        }
        return item as? Data
    }

    private func writeData(_ data: Data, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        if updateStatus != errSecItemNotFound {
            throw HostAPIError.transport(NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus)))
        }

        var createAttributes = query
        createAttributes[kSecValueData as String] = data
        let addStatus = SecItemAdd(createAttributes as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw HostAPIError.transport(NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus)))
        }
    }
}
