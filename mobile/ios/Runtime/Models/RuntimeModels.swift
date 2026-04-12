import Foundation

public enum HostConnectionMode: String, Codable, Hashable, Sendable {
    case lanDirect = "lan_direct"
    case remoteRelay = "remote_relay"
}

public struct HostBeacon: Codable, Hashable, Sendable, Identifiable {
    public var id: String { hostID }
    public let hostID: String
    public let displayName: String
    public let baseURL: String
    public let apiVersion: String
    public let capabilities: [String]
    public let lastSeenAt: Date
    public let connectionMode: HostConnectionMode?
    public let sessionToken: String?
    public let refreshToken: String?
    public let accessTokenExpiresAt: Date?
    public let refreshTokenExpiresAt: Date?
    public let deviceID: String?
    public let certificatePinsetVersion: String?
    public let lastKnownHostPresence: String?

    public init(
        hostID: String,
        displayName: String,
        baseURL: String,
        apiVersion: String,
        capabilities: [String],
        lastSeenAt: Date,
        connectionMode: HostConnectionMode? = nil,
        sessionToken: String? = nil,
        refreshToken: String? = nil,
        accessTokenExpiresAt: Date? = nil,
        refreshTokenExpiresAt: Date? = nil,
        deviceID: String? = nil,
        certificatePinsetVersion: String? = nil,
        lastKnownHostPresence: String? = nil
    ) {
        self.hostID = hostID
        self.displayName = displayName
        self.baseURL = baseURL
        self.apiVersion = apiVersion
        self.capabilities = capabilities
        self.lastSeenAt = lastSeenAt
        self.connectionMode = connectionMode
        self.sessionToken = sessionToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
        self.deviceID = deviceID
        self.certificatePinsetVersion = certificatePinsetVersion
        self.lastKnownHostPresence = lastKnownHostPresence
    }

    public var resolvedBaseURL: URL? {
        URL(string: baseURL)
    }

    public var resolvedConnectionMode: HostConnectionMode {
        connectionMode ?? .lanDirect
    }
}

public struct HostHealth: Codable, Hashable, Sendable {
    public let status: String
    public let service: String?
    public let timestampMs: Int64?

    private enum CodingKeys: String, CodingKey {
        case status
        case service
        case timestampMs = "ts"
    }

    public var healthy: Bool {
        status.lowercased() == "ok"
    }
}

public enum TeamAppInstanceState: String, Codable, Hashable, Sendable {
    case idle
    case running
    case queued
    case completed
    case failed
    case unknown

    static func fromRemoteValue(_ rawValue: String?) -> TeamAppInstanceState {
        switch rawValue?.lowercased() {
        case "idle":
            return .idle
        case "running", "planning", "executing", "reviewing":
            return .running
        case "queued":
            return .queued
        case "completed", "finished", "complete":
            return .completed
        case "failed", "error", "blocked", "needs_attention":
            return .failed
        default:
            return .unknown
        }
    }
}

public struct TeamAppInstance: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let state: TeamAppInstanceState
    public let createdAt: Date
    public let updatedAt: Date
    public let activeSessionID: String?
    public let lastResultPreview: String?
    public let restoreRef: String?

    public init(
        id: String,
        title: String,
        state: TeamAppInstanceState,
        createdAt: Date,
        updatedAt: Date,
        activeSessionID: String?,
        lastResultPreview: String?,
        restoreRef: String? = nil
    ) {
        self.id = id
        self.title = title
        self.state = state
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.activeSessionID = activeSessionID
        self.lastResultPreview = lastResultPreview
        self.restoreRef = restoreRef
    }
}

public struct TeamAppStatus: Codable, Hashable, Sendable {
    public let instanceID: String
    public let state: TeamAppInstanceState
    public let progressPercent: Double?
    public let healthMessage: String?
    public let latestResult: String?
    public let activeSessionID: String?
    public let trustStatus: String?
    public let pendingTrustProject: String?
    public let updatedAt: Date

    public init(
        instanceID: String,
        state: TeamAppInstanceState,
        progressPercent: Double?,
        healthMessage: String?,
        latestResult: String?,
        activeSessionID: String?,
        trustStatus: String? = nil,
        pendingTrustProject: String? = nil,
        updatedAt: Date
    ) {
        self.instanceID = instanceID
        self.state = state
        self.progressPercent = progressPercent
        self.healthMessage = healthMessage
        self.latestResult = latestResult
        self.activeSessionID = activeSessionID
        self.trustStatus = trustStatus
        self.pendingTrustProject = pendingTrustProject
        self.updatedAt = updatedAt
    }
}

public struct TeamAppInstanceEvent: Codable, Hashable, Sendable, Identifiable {
    public var id: String {
        streamID ?? [instanceID, type, updatedAt, message, outputChunk]
            .compactMap { $0 }
            .joined(separator: "|")
    }

    public let streamID: String?
    public let type: String
    public let instanceID: String?
    public let message: String?
    public let outputChunk: String?
    public let health: String?
    public let updatedAt: String?

    public init(
        streamID: String? = nil,
        type: String,
        instanceID: String?,
        message: String?,
        outputChunk: String?,
        health: String?,
        updatedAt: String?
    ) {
        self.streamID = streamID
        self.type = type
        self.instanceID = instanceID
        self.message = message
        self.outputChunk = outputChunk
        self.health = health
        self.updatedAt = updatedAt
    }
}

public struct LaunchInstanceRequest: Codable, Hashable, Sendable {
    public let initialPrompt: String?
    public let title: String?
    public let restoreRef: String?

    public init(initialPrompt: String?, title: String? = nil, restoreRef: String? = nil) {
        self.initialPrompt = initialPrompt
        self.title = title
        self.restoreRef = restoreRef
    }
}

public struct PromptSubmission: Codable, Hashable, Sendable {
    public let text: String

    public init(text: String) {
        self.text = text
    }
}

public struct FollowUpSubmission: Codable, Hashable, Sendable {
    public let text: String
    public let threadID: String?

    public init(text: String, threadID: String?) {
        self.text = text
        self.threadID = threadID
    }
}

public struct PromptAck: Codable, Hashable, Sendable {
    public let requestID: String
    public let acceptedAt: Date
}

public struct SessionRestoreResult: Codable, Hashable, Sendable {
    public let sessionID: String
    public let instance: TeamAppInstance
    public let status: TeamAppStatus
}

public struct KnownRestoreRef: Codable, Hashable, Sendable, Identifiable {
    public var id: String { restoreRef }
    public let restoreRef: String
    public let title: String?
    public let sessionID: String?
    public let observedAt: Date?

    public init(restoreRef: String, title: String?, sessionID: String?, observedAt: Date?) {
        self.restoreRef = restoreRef
        self.title = title
        self.sessionID = sessionID
        self.observedAt = observedAt
    }

    private enum CodingKeys: String, CodingKey {
        case restoreRef = "restore_ref"
        case title
        case sessionID = "session_id"
        case observedAt = "observed_at"
    }
}

public struct SessionSnapshot: Codable, Hashable, Sendable {
    public let host: HostBeacon
    public let activeInstanceID: String?
    public let activeSessionID: String?
    public let activeRestoreRef: String?
    public let updatedAt: Date

    public init(
        host: HostBeacon,
        activeInstanceID: String?,
        activeSessionID: String?,
        activeRestoreRef: String? = nil,
        updatedAt: Date
    ) {
        self.host = host
        self.activeInstanceID = activeInstanceID
        self.activeSessionID = activeSessionID
        self.activeRestoreRef = activeRestoreRef
        self.updatedAt = updatedAt
    }
}
