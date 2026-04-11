import Foundation

public actor PreviewRuntimeClient: TeamAppRuntimeProviding {
    private let demoHost = HostBeacon(
        hostID: "pc-main",
        displayName: "Office PC",
        baseURL: "http://127.0.0.1:8765",
        apiVersion: "v1",
        capabilities: ["instances", "prompt", "follow-up", "restore"],
        lastSeenAt: Date()
    )

    private var pairedHost: HostBeacon?
    private var activeInstanceID: String?
    private var activeSessionID: String?

    private var instances: [TeamAppInstance] = [
        TeamAppInstance(
            id: "inst-1",
            title: "Refactor Build Pipeline",
            state: .running,
            createdAt: Date().addingTimeInterval(-400),
            updatedAt: Date(),
            activeSessionID: "sess-1",
            lastResultPreview: "Collecting impacted files"
        ),
        TeamAppInstance(
            id: "inst-2",
            title: "Bugfix Session",
            state: .idle,
            createdAt: Date().addingTimeInterval(-800),
            updatedAt: Date(),
            activeSessionID: nil,
            lastResultPreview: "Waiting for prompt"
        )
    ]

    public init() {
        activeInstanceID = instances.first?.id
        activeSessionID = instances.first?.activeSessionID
    }

    public func pairToFirstAvailableHost() async throws -> HostBeacon {
        pairedHost = demoHost
        return demoHost
    }

    public func pair(to host: HostBeacon) async throws {
        pairedHost = host
    }

    public func currentHost() async -> HostBeacon? {
        pairedHost
    }

    public func listInstances() async throws -> [TeamAppInstance] {
        instances
    }

    public func switchToInstance(id: String) async throws -> TeamAppInstance {
        guard let instance = instances.first(where: { $0.id == id }) else {
            throw HostAPIError.http(statusCode: 404, message: "Instance not found")
        }

        activeInstanceID = instance.id
        activeSessionID = instance.activeSessionID
        return instance
    }

    public func launchInstance(initialPrompt: String?) async throws -> TeamAppInstance {
        let now = Date()
        let session = "sess-\(Int.random(in: 100...999))"
        let created = TeamAppInstance(
            id: "inst-\(Int.random(in: 100...999))",
            title: "New Team App Task",
            state: .running,
            createdAt: now,
            updatedAt: now,
            activeSessionID: session,
            lastResultPreview: initialPrompt.map { "Prompt queued: \($0.prefix(60))" } ?? "Booting remote task"
        )

        instances.append(created)
        activeInstanceID = created.id
        activeSessionID = session
        return created
    }

    public func closeInstance(id: String) async throws {
        instances.removeAll(where: { $0.id == id })
        if activeInstanceID == id {
            activeInstanceID = instances.first?.id
            activeSessionID = instances.first?.activeSessionID
        }
    }

    public func fetchStatus(for instanceID: String) async throws -> TeamAppStatus {
        let current = instances.first(where: { $0.id == instanceID })
        return TeamAppStatus(
            instanceID: instanceID,
            state: current?.state ?? .unknown,
            progressPercent: current?.state == .completed ? 100 : 42,
            healthMessage: current == nil ? "Missing instance" : "Host healthy",
            latestResult: current?.lastResultPreview,
            activeSessionID: current?.activeSessionID,
            updatedAt: Date()
        )
    }

    public func sendPrompt(_ text: String, to instanceID: String) async throws -> PromptAck {
        try updateInstance(instanceID: instanceID) { current in
            TeamAppInstance(
                id: current.id,
                title: current.title,
                state: .running,
                createdAt: current.createdAt,
                updatedAt: Date(),
                activeSessionID: current.activeSessionID ?? "sess-\(Int.random(in: 100...999))",
                lastResultPreview: "Prompt queued: \(text.prefix(80))"
            )
        }

        activeInstanceID = instanceID
        activeSessionID = instances.first(where: { $0.id == instanceID })?.activeSessionID
        return PromptAck(requestID: UUID().uuidString, acceptedAt: Date())
    }

    public func sendFollowUp(_ text: String, threadID: String?, to instanceID: String) async throws -> PromptAck {
        try updateInstance(instanceID: instanceID) { current in
            TeamAppInstance(
                id: current.id,
                title: current.title,
                state: .running,
                createdAt: current.createdAt,
                updatedAt: Date(),
                activeSessionID: threadID ?? current.activeSessionID,
                lastResultPreview: "Follow-up queued: \(text.prefix(80))"
            )
        }

        activeInstanceID = instanceID
        activeSessionID = instances.first(where: { $0.id == instanceID })?.activeSessionID
        return PromptAck(requestID: UUID().uuidString, acceptedAt: Date())
    }

    public func restoreSession(_ sessionID: String) async throws -> SessionRestoreResult {
        let now = Date()
        let restored = TeamAppInstance(
            id: "inst-restored-\(Int.random(in: 100...999))",
            title: "Restored Session \(sessionID)",
            state: .running,
            createdAt: now,
            updatedAt: now,
            activeSessionID: sessionID,
            lastResultPreview: "Session resumed from rebuild interruption"
        )

        instances.append(restored)
        activeInstanceID = restored.id
        activeSessionID = sessionID

        let status = TeamAppStatus(
            instanceID: restored.id,
            state: .running,
            progressPercent: 50,
            healthMessage: "Recovered after host restart",
            latestResult: restored.lastResultPreview,
            activeSessionID: sessionID,
            updatedAt: now
        )

        return SessionRestoreResult(sessionID: sessionID, instance: restored, status: status)
    }

    public func restoreLastSession() async throws -> SessionSnapshot? {
        guard let pairedHost else { return nil }

        return SessionSnapshot(
            host: pairedHost,
            activeInstanceID: activeInstanceID,
            activeSessionID: activeSessionID,
            updatedAt: Date()
        )
    }

    private func updateInstance(instanceID: String, transform: (TeamAppInstance) -> TeamAppInstance) throws {
        guard let index = instances.firstIndex(where: { $0.id == instanceID }) else {
            throw HostAPIError.http(statusCode: 404, message: "Instance not found")
        }

        instances[index] = transform(instances[index])
    }
}
