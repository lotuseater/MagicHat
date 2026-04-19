import Foundation

public actor PreviewRuntimeClient: TeamAppRuntimeProviding {
    public enum Scenario: String, Sendable {
        case launch
        case connected
        case trustPrompt
        case errorBanner
    }

    private let scenario: Scenario
    private let demoHost = HostBeacon(
        hostID: "pc-main",
        displayName: "Office PC",
        baseURL: "http://127.0.0.1:8765",
        apiVersion: "v1",
        capabilities: ["instances", "prompt", "follow-up", "restore"],
        lastSeenAt: Date(),
        connectionMode: .lanDirect
    )
    private let demoRelayHost = HostBeacon(
        hostID: "relay-main",
        displayName: "Remote Mac Mini",
        baseURL: "https://relay.example.test",
        apiVersion: "v2",
        capabilities: ["instances", "prompt", "follow-up", "restore", "remote_pairing"],
        lastSeenAt: Date(),
        connectionMode: .remoteRelay,
        sessionToken: "preview-access-token",
        refreshToken: "preview-refresh-token",
        accessTokenExpiresAt: Date().addingTimeInterval(3600),
        refreshTokenExpiresAt: Date().addingTimeInterval(86400),
        deviceID: "preview-device-id",
        certificatePinsetVersion: "dev-insecure",
        lastKnownHostPresence: "online"
    )

    private var pairedHostsList: [HostBeacon]
    private var pairedHost: HostBeacon?
    private var activeInstanceID: String?
    private var activeSessionID: String?
    private var streamTask: Task<Void, Never>?

    private var instances: [TeamAppInstance]

    public init(scenario: Scenario = .connected) {
        self.scenario = scenario
        self.instances = [
        TeamAppInstance(
            id: "inst-1",
            title: "Refactor Build Pipeline",
            state: .running,
            createdAt: Date().addingTimeInterval(-400),
            updatedAt: Date(),
            activeSessionID: "sess-1",
            lastResultPreview: "Collecting impacted files",
            restoreRef: "restore_alpha"
        ),
        TeamAppInstance(
            id: "inst-2",
            title: "Bugfix Session",
            state: .idle,
            createdAt: Date().addingTimeInterval(-800),
            updatedAt: Date(),
            activeSessionID: nil,
            lastResultPreview: "Waiting for prompt",
            restoreRef: nil
        )
        ]

        switch scenario {
        case .launch:
            pairedHostsList = []
            pairedHost = nil
            activeInstanceID = nil
            activeSessionID = nil
            instances = []
        case .connected, .trustPrompt, .errorBanner:
            pairedHostsList = [demoHost, demoRelayHost]
            pairedHost = demoHost
            activeInstanceID = instances.first?.id
            activeSessionID = instances.first?.activeSessionID
        }
    }

    public func pairToFirstAvailableHost(pairingCode: String?) async throws -> HostBeacon {
        _ = pairingCode
        pairedHost = demoHost
        upsertHost(demoHost)
        return demoHost
    }

    public func pair(to host: HostBeacon, pairingCode: String?) async throws {
        _ = pairingCode
        pairedHost = host
        upsertHost(host)
    }

    public func registerPairingURI(_ rawURI: String, deviceName: String) async throws -> HostBeacon {
        _ = rawURI
        _ = deviceName
        pairedHost = demoRelayHost
        upsertHost(demoRelayHost)
        return demoRelayHost
    }

    public func pairedHosts() async -> [HostBeacon] {
        pairedHostsList
    }

    public func currentHost() async -> HostBeacon? {
        pairedHost
    }

    public func refreshCurrentHostStatus() async throws -> HostBeacon? {
        guard let pairedHost else { return nil }
        return pairedHost
    }

    public func selectHost(id: String) async throws {
        guard let nextHost = pairedHostsList.first(where: { $0.hostID == id }) else {
            throw HostAPIError.noPairedHost
        }
        pairedHost = nextHost
        activeInstanceID = nil
        activeSessionID = nil
    }

    public func removeHost(id: String) async throws {
        pairedHostsList.removeAll { $0.hostID == id }
        if pairedHost?.hostID == id {
            pairedHost = pairedHostsList.first
            activeInstanceID = nil
            activeSessionID = nil
        }
    }

    public func listInstances() async throws -> [TeamAppInstance] {
        try throwIfPreviewErrorNeeded()
        instances
    }

    public func listKnownRestoreRefs() async throws -> [KnownRestoreRef] {
        try throwIfPreviewErrorNeeded()
        instances.compactMap { instance in
            guard let restoreRef = instance.restoreRef else {
                return nil
            }
            return KnownRestoreRef(
                restoreRef: restoreRef,
                title: instance.title,
                sessionID: instance.activeSessionID,
                observedAt: Date()
            )
        }
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
            lastResultPreview: initialPrompt.map { "Prompt queued: \($0.prefix(60))" } ?? "Booting remote task",
            restoreRef: "restore_\(Int.random(in: 100...999))"
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
        try throwIfPreviewErrorNeeded()
        let current = instances.first(where: { $0.id == instanceID })
        return TeamAppStatus(
            instanceID: instanceID,
            state: current?.state ?? .unknown,
            progressPercent: current?.state == .completed ? 100 : 64,
            healthMessage: statusHealthMessage(for: current),
            latestResult: statusLatestResult(for: current),
            activeSessionID: current?.activeSessionID,
            trustStatus: scenario == .trustPrompt ? "prompt_required" : nil,
            pendingTrustProject: scenario == .trustPrompt ? "MagicHat/mobile/ios" : nil,
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
                lastResultPreview: "Prompt queued: \(text.prefix(80))",
                restoreRef: current.restoreRef
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
                lastResultPreview: "Follow-up queued: \(text.prefix(80))",
                restoreRef: current.restoreRef
            )
        }

        activeInstanceID = instanceID
        activeSessionID = instances.first(where: { $0.id == instanceID })?.activeSessionID
        return PromptAck(requestID: UUID().uuidString, acceptedAt: Date())
    }

    public func answerTrustPrompt(_ approved: Bool, for instanceID: String) async throws {
        guard approved else {
            return
        }
        try updateInstance(instanceID: instanceID) { current in
            TeamAppInstance(
                id: current.id,
                title: current.title,
                state: .running,
                createdAt: current.createdAt,
                updatedAt: Date(),
                activeSessionID: current.activeSessionID,
                lastResultPreview: "Project trust approved from mobile",
                restoreRef: current.restoreRef
            )
        }
    }

    public func observeInstanceEvents(
        for instanceID: String,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async {
        streamTask?.cancel()
        onState("connected")
        streamTask = Task {
            onEvent(
                TeamAppInstanceEvent(
                    streamID: UUID().uuidString,
                    type: "message",
                    instanceID: instanceID,
                    message: "Preview stream connected",
                    outputChunk: nil,
                    health: "running",
                    updatedAt: ISO8601DateFormatter().string(from: Date())
                )
            )
        }
    }

    public func stopObservingInstanceEvents() async {
        streamTask?.cancel()
        streamTask = nil
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
            lastResultPreview: "Session resumed from rebuild interruption",
            restoreRef: "restore_\(sessionID.lowercased())"
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
            activeRestoreRef: instances.first(where: { $0.id == activeInstanceID })?.restoreRef,
            updatedAt: Date()
        )
    }

    private func statusHealthMessage(for current: TeamAppInstance?) -> String {
        guard current != nil else {
            return "Missing instance"
        }

        switch scenario {
        case .trustPrompt:
            return "Waiting for project trust approval on the host"
        default:
            return "Host healthy"
        }
    }

    private func statusLatestResult(for current: TeamAppInstance?) -> String? {
        switch scenario {
        case .trustPrompt:
            return "Wizard is paused until the trust prompt is approved from mobile."
        default:
            return current?.lastResultPreview
        }
    }

    private func updateInstance(instanceID: String, transform: (TeamAppInstance) -> TeamAppInstance) throws {
        guard let index = instances.firstIndex(where: { $0.id == instanceID }) else {
            throw HostAPIError.http(statusCode: 404, message: "Instance not found")
        }

        instances[index] = transform(instances[index])
    }

    private func upsertHost(_ host: HostBeacon) {
        pairedHostsList.removeAll { $0.hostID == host.hostID }
        pairedHostsList.append(host)
    }

    private func throwIfPreviewErrorNeeded() throws {
        guard scenario == .errorBanner else {
            return
        }

        throw HostAPIError.http(
            statusCode: 503,
            message: "Preview simulator intentionally failed the host sync so the visual harness can capture the error banner state."
        )
    }
}
