import Foundation

internal struct PairingURIComponents: Sendable {
    let host: String
    let port: Int
    let useTLS: Bool
    let pairingKey: String?
    let displayName: String?
    let preferredProjectPath: String?

    static func parse(_ rawValue: String) throws -> PairingURIComponents {
        guard let url = URL(string: rawValue),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme,
              scheme.lowercased() == "magichat",
              let host = components.host,
              !host.isEmpty
        else {
            throw RuntimeClientError.invalidPairingURI(rawValue)
        }

        var queryItems: [String: String] = [:]
        for item in components.queryItems ?? [] {
            queryItems[item.name.lowercased()] = item.value
        }

        let port = components.port ?? 19750
        let pairingKey = queryItems["psk"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let tlsFlag = queryItems["tls"]?.lowercased()
        let useTLS = tlsFlag == "1" || tlsFlag == "true" || tlsFlag == "yes"
        let displayName = queryItems["name"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let preferredProjectPath = queryItems["project_path"]?.trimmingCharacters(in: .whitespacesAndNewlines)

        return PairingURIComponents(
            host: host,
            port: port,
            useTLS: useTLS,
            pairingKey: pairingKey?.isEmpty == true ? nil : pairingKey,
            displayName: displayName?.isEmpty == true ? nil : displayName,
            preferredProjectPath: preferredProjectPath?.isEmpty == true ? nil : preferredProjectPath
        )
    }
}

internal struct RemotePairingURIComponents: Sendable {
    let relayURL: String
    let hostID: String
    let hostName: String
    let bootstrapToken: String
    let hostFingerprint: String
    let expiresAt: Date

    static func parse(_ rawValue: String) throws -> RemotePairingURIComponents {
        guard let url = URL(string: rawValue),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme,
              scheme.lowercased() == "magichat",
              let host = components.host,
              host.lowercased() == "pair"
        else {
            throw HostAPIError.invalidPairingURI(rawValue)
        }

        var queryItems: [String: String] = [:]
        for item in components.queryItems ?? [] {
            queryItems[item.name.lowercased()] = item.value
        }

        guard queryItems["v"] == "2" else {
            throw HostAPIError.invalidPairingURI(rawValue)
        }

        let relayURL = queryItems["relay"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hostID = queryItems["host_id"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hostName = queryItems["host_name"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let bootstrapToken = queryItems["bootstrap_token"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hostFingerprint = queryItems["host_fingerprint"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let expiresAtValue = queryItems["exp"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard relayURL.hasPrefix("http://") || relayURL.hasPrefix("https://"),
              hostID.isEmpty == false,
              hostName.isEmpty == false,
              bootstrapToken.isEmpty == false,
              hostFingerprint.isEmpty == false,
              let expiresAt = ISO8601DateFormatter().date(from: expiresAtValue),
              expiresAt > Date()
        else {
            throw HostAPIError.invalidPairingURI(rawValue)
        }

        return RemotePairingURIComponents(
            relayURL: relayURL.hasSuffix("/") ? relayURL : "\(relayURL)/",
            hostID: hostID,
            hostName: hostName,
            bootstrapToken: bootstrapToken,
            hostFingerprint: hostFingerprint,
            expiresAt: expiresAt
        )
    }
}
