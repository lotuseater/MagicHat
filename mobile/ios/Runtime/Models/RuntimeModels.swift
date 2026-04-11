import Foundation

public struct HostBeacon: Codable, Hashable, Sendable, Identifiable {
    public var id: String { hostID }
    public let hostID: String
    public let displayName: String
    public let baseURL: String
    public let apiVersion: String
    public let capabilities: [String]
    public let lastSeenAt: Date

    public init(
        hostID: String,
        displayName: String,
        baseURL: String,
        apiVersion: String,
        capabilities: [String],
        lastSeenAt: Date
    ) {
        self.hostID = hostID
        self.displayName = displayName
        self.baseURL = baseURL
        self.apiVersion = apiVersion
        self.capabilities = capabilities
        self.lastSeenAt = lastSeenAt
    }

    public var resolvedBaseURL: URL? {
        URL(string: baseURL)
    }
}

public struct HostHealth: Codable, Hashable, Sendable {
    public let healthy: Bool
    public let hostID: String
    public let uptimeSeconds: Int
    public let timestamp: Date
}

public enum TeamAppInstanceState: String, Codable, Hashable, Sendable {
    case idle
    case running
    case queued
    case completed
    case failed
    case unknown
}

public struct TeamAppInstance: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let state: TeamAppInstanceState
    public let createdAt: Date
    public let updatedAt: Date
    public let activeSessionID: String?
    public let lastResultPreview: String?

    public init(
        id: String,
        title: String,
        state: TeamAppInstanceState,
        createdAt: Date,
        updatedAt: Date,
        activeSessionID: String?,
        lastResultPreview: String?
    ) {
        self.id = id
        self.title = title
        self.state = state
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.activeSessionID = activeSessionID
        self.lastResultPreview = lastResultPreview
    }
}

public struct TeamAppStatus: Codable, Hashable, Sendable {
    public let instanceID: String
    public let state: TeamAppInstanceState
    public let progressPercent: Double?
    public let healthMessage: String?
    public let latestResult: String?
    public let activeSessionID: String?
    public let updatedAt: Date

    public init(
        instanceID: String,
        state: TeamAppInstanceState,
        progressPercent: Double?,
        healthMessage: String?,
        latestResult: String?,
        activeSessionID: String?,
        updatedAt: Date
    ) {
        self.instanceID = instanceID
        self.state = state
        self.progressPercent = progressPercent
        self.healthMessage = healthMessage
        self.latestResult = latestResult
        self.activeSessionID = activeSessionID
        self.updatedAt = updatedAt
    }
}

public struct LaunchInstanceRequest: Codable, Hashable, Sendable {
    public let initialPrompt: String?

    public init(initialPrompt: String?) {
        self.initialPrompt = initialPrompt
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

public struct SessionSnapshot: Codable, Hashable, Sendable {
    public let host: HostBeacon
    public let activeInstanceID: String?
    public let activeSessionID: String?
    public let updatedAt: Date

    public init(
        host: HostBeacon,
        activeInstanceID: String?,
        activeSessionID: String?,
        updatedAt: Date
    ) {
        self.host = host
        self.activeInstanceID = activeInstanceID
        self.activeSessionID = activeSessionID
        self.updatedAt = updatedAt
    }
}
