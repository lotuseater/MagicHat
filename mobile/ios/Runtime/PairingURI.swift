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
