import Foundation

internal enum RelayTrustPolicy {
    private static let developmentHosts: Set<String> = [
        "localhost",
        "127.0.0.1",
        "::1",
        "10.0.2.2",
        "10.0.3.2",
    ]

    private static let pinsetsByVersion: [String: [String]] = [:]

    static func validateRelayURL(_ rawValue: String) throws -> URL {
        let normalized = rawValue.hasSuffix("/") ? rawValue : "\(rawValue)/"
        guard let url = URL(string: normalized),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased(),
              host.isEmpty == false
        else {
            throw HostAPIError.invalidBaseURL(rawValue)
        }

        switch scheme {
        case "https":
            return url
        case "http":
            guard isDevelopmentRelayHost(host) else {
                throw HostAPIError.insecureRelayURL(rawValue)
            }
            return url
        default:
            throw HostAPIError.invalidBaseURL(rawValue)
        }
    }

    static func validateRelayURL(_ url: URL) throws -> URL {
        try validateRelayURL(url.absoluteString)
    }

    static func pins(for version: String?) throws -> [String] {
        let normalized = version?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if normalized.isEmpty || normalized == "dev-insecure" {
            return []
        }
        guard let pins = pinsetsByVersion[normalized] else {
            throw HostAPIError.unsupportedRelayPinsetVersion(normalized)
        }
        return pins
    }

    private static func isDevelopmentRelayHost(_ host: String) -> Bool {
        developmentHosts.contains(host) || host.hasPrefix("127.")
    }
}
