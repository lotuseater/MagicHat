import Foundation

public actor TeamAppRuntimeService: TeamAppRuntimeProviding {
    private let beaconDiscovery: BeaconDiscovering
    private let persistence: RuntimePersistence
    private let makeClient: @Sendable (URL) -> HostAPIClient
    private let makeRelayClient: @Sendable (URL, String?, String?) throws -> RelayAPIClient
    private let deviceKeyStore: DeviceKeyStore
    private let eventStreamClient: any InstanceEventStreaming

    private var bootstrapped = false
    private var host: HostBeacon?
    private var client: HostAPIClient?
    private var sessionSnapshot: SessionSnapshot?

    public init(
        beaconDiscovery: BeaconDiscovering,
        persistence: RuntimePersistence,
        makeClient: @escaping @Sendable (URL) -> HostAPIClient
    ) {
        self.init(
            beaconDiscovery: beaconDiscovery,
            persistence: persistence,
            deviceKeyStore: DeviceKeyStore(),
            makeClient: makeClient,
            makeRelayClient: { baseURL, accessToken, certificatePinsetVersion in
                try URLSessionRelayAPIClient(
                    baseURL: baseURL,
                    accessToken: accessToken,
                    certificatePinsetVersion: certificatePinsetVersion
                )
            },
            eventStreamClient: URLSessionInstanceEventStreamClient()
        )
    }

    init(
        beaconDiscovery: BeaconDiscovering,
        persistence: RuntimePersistence,
        deviceKeyStore: DeviceKeyStore,
        makeClient: @escaping @Sendable (URL) -> HostAPIClient,
        makeRelayClient: @escaping @Sendable (URL, String?, String?) throws -> RelayAPIClient,
        eventStreamClient: any InstanceEventStreaming
    ) {
        self.beaconDiscovery = beaconDiscovery
        self.persistence = persistence
        self.deviceKeyStore = deviceKeyStore
        self.makeClient = makeClient
        self.makeRelayClient = makeRelayClient
        self.eventStreamClient = eventStreamClient
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

        let normalizedHost = HostBeacon(
            hostID: host.hostID,
            displayName: host.displayName,
            baseURL: host.baseURL,
            apiVersion: host.apiVersion,
            capabilities: host.capabilities,
            lastSeenAt: Date(),
            connectionMode: .lanDirect
        )

        let candidateClient = makeClient(baseURL)
        _ = try await candidateClient.fetchHealth()

        self.host = normalizedHost
        self.client = candidateClient
        try await persistHost(normalizedHost)
        try await updateSnapshot(
            instanceID: sessionSnapshot?.activeInstanceID,
            sessionID: sessionSnapshot?.activeSessionID,
            restoreRef: sessionSnapshot?.activeRestoreRef
        )
    }

    public func registerPairingURI(_ rawURI: String, deviceName: String) async throws -> HostBeacon {
        try await ensureBootstrapped()

        if let remote = try? RemotePairingURIComponents.parse(rawURI) {
            return try await pairRemote(remote, deviceName: deviceName)
        }

        let parsed = try PairingURIComponents.parse(rawURI)
        let scheme = parsed.useTLS ? "https" : "http"
        let baseURL = "\(scheme)://\(parsed.host):\(parsed.port)/"
        let beacon = HostBeacon(
            hostID: "\(parsed.host):\(parsed.port)",
            displayName: parsed.displayName ?? parsed.host,
            baseURL: baseURL,
            apiVersion: "v1",
            capabilities: ["instances", "prompt", "follow-up", "restore"],
            lastSeenAt: Date(),
            connectionMode: .lanDirect
        )
        try await pair(to: beacon)
        return beacon
    }

    public func currentHost() async -> HostBeacon? {
        await safeBootstrappedHost()
    }

    public func listInstances() async throws -> [TeamAppInstance] {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            let refreshedHost = try await refreshRemotePresenceIfNeeded(currentHost, relayClient: relayClient)
            let wires = try await relayClient.listInstances(hostID: refreshedHost.hostID)
            return wires.map { $0.asTeamAppInstance() }
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            return try await client.listInstances()
        }
    }

    public func listKnownRestoreRefs() async throws -> [KnownRestoreRef] {
        let currentHost = try await currentHostRecord()
        guard currentHost.resolvedConnectionMode == .remoteRelay else {
            return []
        }

        let relayClient = try await activeRelayClient(for: currentHost)
        return try await relayClient.listKnownRestoreRefs(hostID: currentHost.hostID)
    }

    public func switchToInstance(id: String) async throws -> TeamAppInstance {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            let detail = try await relayClient.getInstanceDetail(hostID: currentHost.hostID, instanceID: id)
            let instance = detail.asTeamAppInstance()
            try await updateSnapshot(instanceID: instance.id, sessionID: instance.activeSessionID, restoreRef: instance.restoreRef)
            return instance
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            let instance = try await client.switchInstance(id: id)
            try await updateSnapshot(instanceID: instance.id, sessionID: instance.activeSessionID, restoreRef: instance.restoreRef)
            return instance
        }
    }

    public func launchInstance(initialPrompt: String?) async throws -> TeamAppInstance {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            let created = try await relayClient.launchInstance(hostID: currentHost.hostID, title: initialPrompt, restoreRef: nil)
            let detail = try await relayClient.getInstanceDetail(hostID: currentHost.hostID, instanceID: created.stableInstanceID)
            let instance = detail.asTeamAppInstance()
            try await updateSnapshot(instanceID: instance.id, sessionID: instance.activeSessionID, restoreRef: instance.restoreRef)
            return instance
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            let created = try await client.launchInstance(request: LaunchInstanceRequest(initialPrompt: initialPrompt))
            try await updateSnapshot(instanceID: created.id, sessionID: created.activeSessionID, restoreRef: created.restoreRef)
            return created
        }
    }

    public func closeInstance(id: String) async throws {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            try await relayClient.closeInstance(hostID: currentHost.hostID, instanceID: id)
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            try await client.closeInstance(id: id)
        }

        if sessionSnapshot?.activeInstanceID == id {
            try await updateSnapshot(instanceID: nil, sessionID: nil, restoreRef: nil)
        }
    }

    public func fetchStatus(for instanceID: String) async throws -> TeamAppStatus {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            let detail = try await relayClient.getInstanceDetail(hostID: currentHost.hostID, instanceID: instanceID)
            let status = detail.asStatus()
            try await updateSnapshot(instanceID: instanceID, sessionID: status.activeSessionID, restoreRef: detail.restoreRef)
            return status
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            let status = try await client.fetchStatus(instanceID: instanceID)
            try await updateSnapshot(instanceID: instanceID, sessionID: status.activeSessionID, restoreRef: sessionSnapshot?.activeRestoreRef)
            return status
        }
    }

    public func sendPrompt(_ text: String, to instanceID: String) async throws -> PromptAck {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            try await relayClient.sendPrompt(hostID: currentHost.hostID, instanceID: instanceID, prompt: text)
            try await updateSnapshot(instanceID: instanceID, sessionID: sessionSnapshot?.activeSessionID, restoreRef: sessionSnapshot?.activeRestoreRef)
            return PromptAck(requestID: "remote-\(UUID().uuidString)", acceptedAt: Date())
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            let ack = try await client.sendPrompt(PromptSubmission(text: text), instanceID: instanceID)
            try await updateSnapshot(instanceID: instanceID, sessionID: sessionSnapshot?.activeSessionID, restoreRef: sessionSnapshot?.activeRestoreRef)
            return ack
        }
    }

    public func sendFollowUp(_ text: String, threadID: String?, to instanceID: String) async throws -> PromptAck {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            _ = threadID
            try await relayClient.sendFollowUp(hostID: currentHost.hostID, instanceID: instanceID, message: text)
            try await updateSnapshot(instanceID: instanceID, sessionID: sessionSnapshot?.activeSessionID, restoreRef: sessionSnapshot?.activeRestoreRef)
            return PromptAck(requestID: "remote-\(UUID().uuidString)", acceptedAt: Date())
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            let ack = try await client.sendFollowUp(FollowUpSubmission(text: text, threadID: threadID), instanceID: instanceID)
            try await updateSnapshot(instanceID: instanceID, sessionID: sessionSnapshot?.activeSessionID, restoreRef: sessionSnapshot?.activeRestoreRef)
            return ack
        }
    }

    public func answerTrustPrompt(_ approved: Bool, for instanceID: String) async throws {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            try await relayClient.answerTrustPrompt(
                hostID: currentHost.hostID,
                instanceID: instanceID,
                approved: approved
            )
            let refreshed = try await relayClient.getInstanceDetail(hostID: currentHost.hostID, instanceID: instanceID)
            try await updateSnapshot(
                instanceID: instanceID,
                sessionID: refreshed.sessionID ?? sessionSnapshot?.activeSessionID,
                restoreRef: refreshed.restoreRef ?? sessionSnapshot?.activeRestoreRef
            )
        case .lanDirect:
            throw HostAPIError.http(
                statusCode: 501,
                message: "Trust approval is available only for relay-backed hosts in the current iOS client"
            )
        }
    }

    public func observeInstanceEvents(
        for instanceID: String,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async {
        do {
            _ = try await currentHostRecord()
            await eventStreamClient.start(
                requestProvider: { [self] in
                    let currentHost = try await currentHostRecord()
                    switch currentHost.resolvedConnectionMode {
                    case .remoteRelay:
                        guard let baseURL = currentHost.resolvedBaseURL else {
                            throw HostAPIError.invalidBaseURL(currentHost.baseURL)
                        }
                        return InstanceEventStreamRequest(
                            baseURL: baseURL,
                            streamPath: "/v2/mobile/hosts/\(currentHost.hostID)/instances/\(instanceID)/updates",
                            accessToken: currentHost.sessionToken
                        )
                    case .lanDirect:
                        guard let baseURL = currentHost.resolvedBaseURL,
                              let sessionToken = currentHost.sessionToken,
                              sessionToken.isEmpty == false
                        else {
                            throw HostAPIError.http(
                                statusCode: 501,
                                message: "Live updates are available only for relay-backed hosts in the current iOS client"
                            )
                        }
                        return InstanceEventStreamRequest(
                            baseURL: baseURL,
                            streamPath: "/v1/instances/\(instanceID)/updates",
                            accessToken: sessionToken
                        )
                    }
                },
                onEvent: onEvent,
                onState: onState
            )
        } catch {
            onState("disconnected:\(error.localizedDescription)")
        }
    }

    public func stopObservingInstanceEvents() async {
        await eventStreamClient.stop()
    }

    public func restoreSession(_ sessionID: String) async throws -> SessionRestoreResult {
        let currentHost = try await currentHostRecord()
        switch currentHost.resolvedConnectionMode {
        case .remoteRelay:
            let relayClient = try await activeRelayClient(for: currentHost)
            let created = try await relayClient.launchInstance(hostID: currentHost.hostID, title: nil, restoreRef: sessionID)
            let detail = try await relayClient.getInstanceDetail(hostID: currentHost.hostID, instanceID: created.stableInstanceID)
            let instance = detail.asTeamAppInstance()
            let status = detail.asStatus()
            let restored = SessionRestoreResult(sessionID: sessionID, instance: instance, status: status)
            try await updateSnapshot(instanceID: instance.id, sessionID: instance.activeSessionID, restoreRef: instance.restoreRef ?? sessionID)
            return restored
        case .lanDirect:
            let client = try await activeClientWithReconnect()
            let restored = try await client.restoreSession(id: sessionID)
            try await updateSnapshot(instanceID: restored.instance.id, sessionID: restored.sessionID, restoreRef: restored.instance.restoreRef)
            return restored
        }
    }

    public func restoreLastSession() async throws -> SessionSnapshot? {
        try await ensureBootstrapped()
        guard let snapshot = sessionSnapshot else {
            return nil
        }

        guard let selector = snapshot.activeRestoreRef ?? snapshot.activeSessionID else {
            return snapshot
        }

        _ = try await restoreSession(selector)
        return sessionSnapshot
    }

    private func pairRemote(_ components: RemotePairingURIComponents, deviceName: String) async throws -> HostBeacon {
        guard let relayURL = URL(string: components.relayURL) else {
            throw HostAPIError.invalidBaseURL(components.relayURL)
        }

        let identity = try await deviceKeyStore.getOrCreate()
        let relayClient = try makeRelayClient(relayURL, nil, nil)
        let claim = try await relayClient.claimBootstrap(
            bootstrapToken: components.bootstrapToken,
            deviceName: deviceName,
            devicePublicKey: identity.publicKeyBase64,
            platform: "ios"
        )

        var approvedClaim: RemoteClaimStatus?
        for _ in 0..<60 {
            let current = try await relayClient.fetchClaimStatus(claimID: claim.claimID)
            switch current.status.lowercased() {
            case "approved":
                approvedClaim = current
                break
            case "rejected":
                throw HostAPIError.pairingRejected
            case "completed":
                throw HostAPIError.http(statusCode: 409, message: "Pairing claim is no longer available")
            default:
                break
            }
            if approvedClaim != nil {
                break
            }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }

        guard let currentClaim = approvedClaim,
              let challenge = currentClaim.challenge,
              currentClaim.hostID == components.hostID
        else {
            throw HostAPIError.pairingTimedOut
        }

        let signature = try await deviceKeyStore.sign(challenge)
        let registration = try await relayClient.completeRegistration(
            claimID: claim.claimID,
            challenge: challenge,
            signature: signature
        )

        let pairedHost = HostBeacon(
            hostID: registration.hostID,
            displayName: registration.hostName,
            baseURL: components.relayURL,
            apiVersion: "v2",
            capabilities: ["instances", "prompt", "follow-up", "restore", "remote_pairing"],
            lastSeenAt: Date(),
            connectionMode: .remoteRelay,
            sessionToken: registration.accessToken,
            refreshToken: registration.refreshToken,
            accessTokenExpiresAt: registration.accessTokenExpiresAt,
            refreshTokenExpiresAt: registration.refreshTokenExpiresAt,
            deviceID: registration.deviceID,
            certificatePinsetVersion: registration.certificatePinsetVersion,
            lastKnownHostPresence: "unknown"
        )

        self.client = nil
        try await persistHost(pairedHost)
        try await updateSnapshot(
            instanceID: sessionSnapshot?.activeInstanceID,
            sessionID: sessionSnapshot?.activeSessionID,
            restoreRef: sessionSnapshot?.activeRestoreRef
        )
        return pairedHost
    }

    private func ensureBootstrapped() async throws {
        guard bootstrapped == false else {
            return
        }

        bootstrapped = true
        host = await persistence.loadPairedHost()
        sessionSnapshot = await persistence.loadSessionSnapshot()

        if let host, host.resolvedConnectionMode == .lanDirect, let baseURL = host.resolvedBaseURL {
            client = makeClient(baseURL)
        } else {
            client = nil
        }
    }

    private func safeBootstrappedHost() async -> HostBeacon? {
        if bootstrapped == false {
            try? await ensureBootstrapped()
        }

        return host
    }

    private func currentHostRecord() async throws -> HostBeacon {
        try await ensureBootstrapped()
        guard let currentHost = host else {
            throw HostAPIError.noPairedHost
        }

        if currentHost.resolvedConnectionMode == .remoteRelay {
            return try await refreshRemoteSessionIfNeeded(currentHost)
        }
        return currentHost
    }

    private func activeRelayClient(for host: HostBeacon) async throws -> RelayAPIClient {
        let refreshedHost = try await refreshRemoteSessionIfNeeded(host)
        guard let baseURL = refreshedHost.resolvedBaseURL else {
            throw HostAPIError.invalidBaseURL(refreshedHost.baseURL)
        }
        return try makeRelayClient(baseURL, refreshedHost.sessionToken, refreshedHost.certificatePinsetVersion)
    }

    private func refreshRemoteSessionIfNeeded(_ host: HostBeacon) async throws -> HostBeacon {
        guard host.resolvedConnectionMode == .remoteRelay else {
            return host
        }

        guard let expiry = host.accessTokenExpiresAt else {
            return host
        }

        if expiry > Date().addingTimeInterval(30) {
            return host
        }

        guard let refreshToken = host.refreshToken,
              let baseURL = host.resolvedBaseURL
        else {
            throw HostAPIError.noPairedHost
        }

        let relayClient = try makeRelayClient(baseURL, nil, host.certificatePinsetVersion)
        let refreshed = try await relayClient.refreshSession(refreshToken: refreshToken)
        let updatedHost = HostBeacon(
            hostID: host.hostID,
            displayName: host.displayName,
            baseURL: host.baseURL,
            apiVersion: host.apiVersion,
            capabilities: host.capabilities,
            lastSeenAt: Date(),
            connectionMode: host.connectionMode,
            sessionToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
            deviceID: host.deviceID,
            certificatePinsetVersion: host.certificatePinsetVersion,
            lastKnownHostPresence: host.lastKnownHostPresence
        )
        try await persistHost(updatedHost)
        return updatedHost
    }

    private func refreshRemotePresenceIfNeeded(_ host: HostBeacon, relayClient: RelayAPIClient) async throws -> HostBeacon {
        let hosts = try await relayClient.listHosts()
        guard let presence = hosts.first(where: { $0.hostID == host.hostID }) else {
            return host
        }

        guard presence.status != host.lastKnownHostPresence else {
            return host
        }

        let updatedHost = HostBeacon(
            hostID: host.hostID,
            displayName: host.displayName,
            baseURL: host.baseURL,
            apiVersion: host.apiVersion,
            capabilities: host.capabilities,
            lastSeenAt: presence.lastSeenAt ?? Date(),
            connectionMode: host.connectionMode,
            sessionToken: host.sessionToken,
            refreshToken: host.refreshToken,
            accessTokenExpiresAt: host.accessTokenExpiresAt,
            refreshTokenExpiresAt: host.refreshTokenExpiresAt,
            deviceID: host.deviceID,
            certificatePinsetVersion: host.certificatePinsetVersion,
            lastKnownHostPresence: presence.status
        )
        try await persistHost(updatedHost)
        return updatedHost
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

        guard let currentHost = host, currentHost.resolvedConnectionMode == .lanDirect else {
            throw HostAPIError.noPairedHost
        }

        if let baseURL = currentHost.resolvedBaseURL {
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

    private func persistHost(_ host: HostBeacon) async throws {
        self.host = host
        try await persistence.savePairedHost(host)

        if let snapshot = self.sessionSnapshot {
            let updatedSnapshot = SessionSnapshot(
                host: host,
                activeInstanceID: snapshot.activeInstanceID,
                activeSessionID: snapshot.activeSessionID,
                activeRestoreRef: snapshot.activeRestoreRef,
                updatedAt: snapshot.updatedAt
            )
            self.sessionSnapshot = updatedSnapshot
            try await persistence.saveSessionSnapshot(updatedSnapshot)
        }
    }

    private func updateSnapshot(instanceID: String?, sessionID: String?, restoreRef: String?) async throws {
        guard let host else {
            return
        }

        let snapshot = SessionSnapshot(
            host: host,
            activeInstanceID: instanceID,
            activeSessionID: sessionID,
            activeRestoreRef: restoreRef,
            updatedAt: Date()
        )

        self.sessionSnapshot = snapshot
        try await persistence.saveSessionSnapshot(snapshot)
    }
}
