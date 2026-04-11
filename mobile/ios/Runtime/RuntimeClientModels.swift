import Foundation

public struct RuntimeBeaconHost: Identifiable, Equatable, Sendable, Codable {
    public let id: String
    public var displayName: String
    public var address: String
    public var lastSeenAt: Date

    public init(id: String, displayName: String, address: String, lastSeenAt: Date) {
        self.id = id
        self.displayName = displayName
        self.address = address
        self.lastSeenAt = lastSeenAt
    }
}

public struct RuntimePairedHost: Equatable, Sendable, Codable {
    public let hostID: String
    public let displayName: String
    public let pairedAt: Date

    public init(hostID: String, displayName: String, pairedAt: Date) {
        self.hostID = hostID
        self.displayName = displayName
        self.pairedAt = pairedAt
    }
}

public enum RuntimeInstanceHealthState: String, CaseIterable, Sendable, Codable {
    case idle
    case running
    case blocked
    case failed
    case finished
}

public struct RuntimeTeamAppInstance: Identifiable, Equatable, Sendable, Codable {
    public let id: String
    public var title: String
    public var active: Bool
    public var health: RuntimeInstanceHealthState
    public var resultPreview: String

    public init(id: String, title: String, active: Bool, health: RuntimeInstanceHealthState, resultPreview: String) {
        self.id = id
        self.title = title
        self.active = active
        self.health = health
        self.resultPreview = resultPreview
    }
}

public struct RuntimeProgressSnapshot: Equatable, Sendable, Codable {
    public var stepLabel: String
    public var completedSteps: Int
    public var totalSteps: Int
    public var updatedAt: Date

    public init(stepLabel: String, completedSteps: Int, totalSteps: Int, updatedAt: Date) {
        self.stepLabel = stepLabel
        self.completedSteps = completedSteps
        self.totalSteps = totalSteps
        self.updatedAt = updatedAt
    }
}

public struct RuntimeStatusSnapshot: Equatable, Sendable, Codable {
    public var health: RuntimeInstanceHealthState
    public var progress: RuntimeProgressSnapshot
    public var latestResult: String

    public init(health: RuntimeInstanceHealthState, progress: RuntimeProgressSnapshot, latestResult: String) {
        self.health = health
        self.progress = progress
        self.latestResult = latestResult
    }
}

public struct RuntimeSubmissionReceipt: Equatable, Sendable, Codable {
    public var requestID: String
    public var acceptedAt: Date

    public init(requestID: String, acceptedAt: Date) {
        self.requestID = requestID
        self.acceptedAt = acceptedAt
    }
}

public struct RuntimeLaunchRestoreSnapshot: Equatable, Sendable, Codable {
    public var hostID: String
    public var sessionID: String

    public init(hostID: String, sessionID: String) {
        self.hostID = hostID
        self.sessionID = sessionID
    }
}

public enum RuntimeClientError: Error, LocalizedError, Sendable {
    case unknownHost(String)
    case invalidPairingURI(String)
    case malformedServerMessage
    case transportUnavailable
    case requestInFlight
    case requestTimedOut(String)
    case missingRequiredField(String)
    case unauthenticated
    case server(code: Int?, message: String)
    case noProjectsFound
    case sessionNotFound(String)

    public var errorDescription: String? {
        switch self {
        case .unknownHost(let hostID):
            return "Unknown host: \(hostID)"
        case .invalidPairingURI(let value):
            return "Invalid pairing URI: \(value)"
        case .malformedServerMessage:
            return "Malformed server message"
        case .transportUnavailable:
            return "WebSocket transport is not connected"
        case .requestInFlight:
            return "A request is already in flight"
        case .requestTimedOut(let operation):
            return "Request timed out: \(operation)"
        case .missingRequiredField(let field):
            return "Missing required field: \(field)"
        case .unauthenticated:
            return "Pairing/authentication required"
        case .server(let code, let message):
            if let code {
                return "Server error \(code): \(message)"
            }
            return "Server error: \(message)"
        case .noProjectsFound:
            return "No launchable projects were returned by the host"
        case .sessionNotFound(let id):
            return "Session not found: \(id)"
        }
    }
}

internal struct StoredHostRecord: Codable, Sendable, Equatable {
    var id: String
    var displayName: String
    var address: String
    var port: Int
    var useTLS: Bool
    var pairingKey: String?
    var lastSeenAt: Date
    var pairedAt: Date?
    var preferredProjectPath: String?
    var activeInstanceID: String?

    var socketURL: URL {
        var components = URLComponents()
        components.scheme = useTLS ? "wss" : "ws"
        components.host = address
        components.port = port
        components.path = "/mhp"
        if let url = components.url {
            return url
        }

        let fallbackScheme = useTLS ? "wss" : "ws"
        let fallback = "\(fallbackScheme)://\(address):\(port)/mhp"
        return URL(string: fallback)!
    }
}

internal struct RuntimeStateStore: Codable, Sendable, Equatable {
    var hosts: [StoredHostRecord]
    var activeHostID: String?

    static let empty = RuntimeStateStore(hosts: [], activeHostID: nil)
}
