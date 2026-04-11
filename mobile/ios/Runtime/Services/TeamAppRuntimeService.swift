import Foundation

public actor TeamAppRuntimeService: TeamAppRuntimeProviding {
    private let beaconDiscovery: BeaconDiscovering
    private let persistence: RuntimePersistence
    private let makeClient: @Sendable (URL) -> HostAPIClient

    private var bootstrapped = false
    private var host: HostBeacon?
    private var client: HostAPIClient?
    private var sessionSnapshot: SessionSnapshot?

    public init(
        beaconDiscovery: BeaconDiscovering,
        persistence: RuntimePersistence,
        makeClient: @escaping @Sendable (URL) -> HostAPIClient
    ) {
        self.beaconDiscovery = beaconDiscovery
        self.persistence = persistence
        self.makeClient = makeClient
    }

    public func pairToFirstAvailableHost() async throws -> HostBeacon {
        try await ensureBootstrapped()

        let beacons = try await beaconDiscovery.discoverBeacons()
        guard let first = beacons.first else {
            throw HostAPIError.beaconDiscoveryFailed
        }

        try await pair(to: first)
        return first
    }

    public func pair(to host: HostBeacon) async throws {
        try await ensureBootstrapped()
        guard let baseURL = host.resolvedBaseURL else {
            throw HostAPIError.invalidBaseURL(host.baseURL)
        }

        let candidateClient = makeClient(baseURL)
        _ = try await candidateClient.fetchHealth()

        self.host = host
        self.client = candidateClient

        let snapshot = SessionSnapshot(
            host: host,
            activeInstanceID: sessionSnapshot?.activeInstanceID,
            activeSessionID: sessionSnapshot?.activeSessionID,
            updatedAt: Date()
        )

        self.sessionSnapshot = snapshot
        try await persistence.savePairedHost(host)
        try await persistence.saveSessionSnapshot(snapshot)
    }

    public func currentHost() async -> HostBeacon? {
        await safeBootstrappedHost()
    }

    public func listInstances() async throws -> [TeamAppInstance] {
        let client = try await activeClientWithReconnect()
        return try await client.listInstances()
    }

    public func switchToInstance(id: String) async throws -> TeamAppInstance {
        let client = try await activeClientWithReconnect()
        let instance = try await client.switchInstance(id: id)
        try await updateSnapshot(instanceID: instance.id, sessionID: instance.activeSessionID)
        return instance
    }

    public func launchInstance(initialPrompt: String?) async throws -> TeamAppInstance {
        let client = try await activeClientWithReconnect()
        let created = try await client.launchInstance(request: LaunchInstanceRequest(initialPrompt: initialPrompt))
        try await updateSnapshot(instanceID: created.id, sessionID: created.activeSessionID)
        return created
    }

    public func closeInstance(id: String) async throws {
        let client = try await activeClientWithReconnect()
        try await client.closeInstance(id: id)

        if sessionSnapshot?.activeInstanceID == id {
            try await updateSnapshot(instanceID: nil, sessionID: nil)
        }
    }

    public func fetchStatus(for instanceID: String) async throws -> TeamAppStatus {
        let client = try await activeClientWithReconnect()
        let status = try await client.fetchStatus(instanceID: instanceID)
        try await updateSnapshot(instanceID: instanceID, sessionID: status.activeSessionID)
        return status
    }

    public func sendPrompt(_ text: String, to instanceID: String) async throws -> PromptAck {
        let client = try await activeClientWithReconnect()
        let ack = try await client.sendPrompt(PromptSubmission(text: text), instanceID: instanceID)
        try await updateSnapshot(instanceID: instanceID, sessionID: sessionSnapshot?.activeSessionID)
        return ack
    }

    public func sendFollowUp(_ text: String, threadID: String?, to instanceID: String) async throws -> PromptAck {
        let client = try await activeClientWithReconnect()
        let ack = try await client.sendFollowUp(FollowUpSubmission(text: text, threadID: threadID), instanceID: instanceID)
        try await updateSnapshot(instanceID: instanceID, sessionID: sessionSnapshot?.activeSessionID)
        return ack
    }

    public func restoreSession(_ sessionID: String) async throws -> SessionRestoreResult {
        let client = try await activeClientWithReconnect()
        let restored = try await client.restoreSession(id: sessionID)
        try await updateSnapshot(instanceID: restored.instance.id, sessionID: restored.sessionID)
        return restored
    }

    public func restoreLastSession() async throws -> SessionSnapshot? {
        try await ensureBootstrapped()
        guard let snapshot = sessionSnapshot else {
            return nil
        }

        guard let sessionID = snapshot.activeSessionID else {
            return snapshot
        }

        _ = try await restoreSession(sessionID)
        return sessionSnapshot
    }

    private func ensureBootstrapped() async throws {
        guard bootstrapped == false else {
            return
        }

        bootstrapped = true
        host = await persistence.loadPairedHost()
        sessionSnapshot = await persistence.loadSessionSnapshot()

        if let host, let baseURL = host.resolvedBaseURL {
            client = makeClient(baseURL)
        }
    }

    private func safeBootstrappedHost() async -> HostBeacon? {
        if bootstrapped == false {
            try? await ensureBootstrapped()
        }

        return host
    }

    private func activeClientWithReconnect() async throws -> HostAPIClient {
        try await ensureBootstrapped()

        if let client {
            do {
                _ = try await client.fetchHealth()
                return client
            } catch {
                self.client = nil
            }
        }

        if let host, let baseURL = host.resolvedBaseURL {
            let candidateClient = makeClient(baseURL)
            do {
                _ = try await candidateClient.fetchHealth()
                self.client = candidateClient
                return candidateClient
            } catch {
                self.client = nil
            }
        }

        let beacons = try await beaconDiscovery.discoverBeacons()
        guard let recoveredHost = beacons.first else {
            throw HostAPIError.noPairedHost
        }

        try await pair(to: recoveredHost)
        guard let client = self.client else {
            throw HostAPIError.noPairedHost
        }

        return client
    }

    private func updateSnapshot(instanceID: String?, sessionID: String?) async throws {
        guard let host else {
            return
        }

        let snapshot = SessionSnapshot(
            host: host,
            activeInstanceID: instanceID,
            activeSessionID: sessionID,
            updatedAt: Date()
        )

        self.sessionSnapshot = snapshot
        try await persistence.saveSessionSnapshot(snapshot)
    }
}
