import Foundation
import XCTest
@testable import MagicHatIOSCore

@MainActor
final class FeatureStoreHostManagementTests: XCTestCase {
    func testBootstrapLoadsPairedHostsAndActiveHost() async {
        let runtime = FakeFeatureRuntime(
            hosts: [
                Self.host(hostID: "lan-1", name: "Desk PC", mode: .lanDirect, presence: "online"),
                Self.host(hostID: "remote-1", name: "Office Relay", mode: .remoteRelay, presence: "offline"),
            ],
            activeHostID: "remote-1",
            instancesByHost: [:]
        )
        let store = FeatureStore(runtime: runtime)

        await store.bootstrap()

        XCTAssertEqual(store.pairedHosts.map(\.hostID), ["lan-1", "remote-1"])
        XCTAssertEqual(store.pairedHost?.hostID, "remote-1")
        XCTAssertEqual(store.activeHostPresence, "offline")
        XCTAssertEqual(store.pairingState, .paired)
    }

    func testSelectPairedHostReloadsInstancesForNewHost() async {
        let runtime = FakeFeatureRuntime(
            hosts: [
                Self.host(hostID: "lan-1", name: "Desk PC", mode: .lanDirect, presence: "online"),
                Self.host(hostID: "remote-1", name: "Office Relay", mode: .remoteRelay, presence: "online"),
            ],
            activeHostID: "lan-1",
            instancesByHost: [
                "lan-1": [
                    Self.instance(id: "lan-instance", title: "LAN Task", sessionID: "lan-session"),
                ],
                "remote-1": [
                    Self.instance(id: "remote-instance", title: "Remote Task", sessionID: "remote-session"),
                ],
            ]
        )
        let store = FeatureStore(runtime: runtime)

        await store.bootstrap()
        await store.selectPairedHost("remote-1")

        XCTAssertEqual(store.pairedHost?.hostID, "remote-1")
        XCTAssertEqual(store.instances.map(\.id), ["remote-instance"])
        XCTAssertEqual(store.activeInstanceID, "remote-instance")
    }

    func testForgetActiveHostFallsBackAndClearsStaleSelection() async {
        let runtime = FakeFeatureRuntime(
            hosts: [
                Self.host(hostID: "lan-1", name: "Desk PC", mode: .lanDirect, presence: "online"),
                Self.host(hostID: "remote-1", name: "Office Relay", mode: .remoteRelay, presence: "online"),
            ],
            activeHostID: "lan-1",
            instancesByHost: [
                "lan-1": [
                    Self.instance(id: "lan-instance", title: "LAN Task", sessionID: "lan-session"),
                ],
                "remote-1": [],
            ]
        )
        let store = FeatureStore(runtime: runtime)

        await store.bootstrap()
        await store.forgetPairedHost("lan-1")

        XCTAssertEqual(store.pairedHosts.map(\.hostID), ["remote-1"])
        XCTAssertEqual(store.pairedHost?.hostID, "remote-1")
        XCTAssertTrue(store.instances.isEmpty)
        XCTAssertNil(store.activeInstanceID)
        XCTAssertNil(store.statusSnapshot)
        XCTAssertTrue(store.streamEvents.isEmpty)
    }

    func testRefreshCurrentHostStatusUpdatesPresence() async {
        let runtime = FakeFeatureRuntime(
            hosts: [
                Self.host(hostID: "remote-1", name: "Office Relay", mode: .remoteRelay, presence: "offline"),
            ],
            activeHostID: "remote-1",
            instancesByHost: [:]
        )
        runtime.refreshedPresence = "online"
        let store = FeatureStore(runtime: runtime)

        await store.bootstrap()
        await store.refreshCurrentHostStatus()

        XCTAssertEqual(store.pairedHost?.lastKnownHostPresence, "online")
        XCTAssertEqual(store.activeHostPresence, "online")
    }

    private static func host(
        hostID: String,
        name: String,
        mode: HostConnectionMode,
        presence: String
    ) -> HostBeacon {
        HostBeacon(
            hostID: hostID,
            displayName: name,
            baseURL: mode == .remoteRelay ? "https://relay.example.test" : "http://127.0.0.1:18787/",
            apiVersion: mode == .remoteRelay ? "v2" : "v1",
            capabilities: ["instances", "restore"],
            lastSeenAt: Date(),
            connectionMode: mode,
            sessionToken: "token-\(hostID)",
            refreshToken: mode == .remoteRelay ? "refresh-\(hostID)" : nil,
            accessTokenExpiresAt: Date().addingTimeInterval(3600),
            refreshTokenExpiresAt: mode == .remoteRelay ? Date().addingTimeInterval(86400) : nil,
            deviceID: mode == .remoteRelay ? "device-\(hostID)" : nil,
            certificatePinsetVersion: mode == .remoteRelay ? "dev-insecure" : nil,
            lastKnownHostPresence: presence
        )
    }

    private static func instance(id: String, title: String, sessionID: String) -> TeamAppInstance {
        TeamAppInstance(
            id: id,
            title: title,
            state: .running,
            createdAt: Date(),
            updatedAt: Date(),
            activeSessionID: sessionID,
            lastResultPreview: title,
            restoreRef: "restore-\(id)"
        )
    }
}

@MainActor
private final class FakeFeatureRuntime: TeamAppRuntimeProviding {
    private var hosts: [HostBeacon]
    private var activeHostID: String?
    private let instancesByHost: [String: [TeamAppInstance]]
    var refreshedPresence: String?

    init(
        hosts: [HostBeacon],
        activeHostID: String?,
        instancesByHost: [String: [TeamAppInstance]]
    ) {
        self.hosts = hosts
        self.activeHostID = activeHostID
        self.instancesByHost = instancesByHost
    }

    func pairToFirstAvailableHost(pairingCode: String?) async throws -> HostBeacon {
        guard let host = hosts.first else {
            throw HostAPIError.noPairedHost
        }
        activeHostID = host.hostID
        return host
    }

    func pair(to host: HostBeacon, pairingCode: String?) async throws {
        activeHostID = host.hostID
        upsert(host)
    }

    func registerPairingURI(_ rawURI: String, deviceName: String) async throws -> HostBeacon {
        let newHost = HostBeacon(
            hostID: "uri-host",
            displayName: "URI Host",
            baseURL: "https://relay.example.test",
            apiVersion: "v2",
            capabilities: ["instances"],
            lastSeenAt: Date(),
            connectionMode: .remoteRelay,
            sessionToken: "uri-token",
            refreshToken: "uri-refresh",
            accessTokenExpiresAt: Date().addingTimeInterval(3600),
            refreshTokenExpiresAt: Date().addingTimeInterval(86400),
            deviceID: "uri-device",
            certificatePinsetVersion: "dev-insecure",
            lastKnownHostPresence: "online"
        )
        upsert(newHost)
        activeHostID = newHost.hostID
        return newHost
    }

    func pairedHosts() async -> [HostBeacon] {
        hosts
    }

    func currentHost() async -> HostBeacon? {
        hosts.first(where: { $0.hostID == activeHostID })
    }

    func refreshCurrentHostStatus() async throws -> HostBeacon? {
        guard let activeHostID, let index = hosts.firstIndex(where: { $0.hostID == activeHostID }) else {
            return nil
        }
        if let refreshedPresence {
            let current = hosts[index]
            let updated = HostBeacon(
                hostID: current.hostID,
                displayName: current.displayName,
                baseURL: current.baseURL,
                apiVersion: current.apiVersion,
                capabilities: current.capabilities,
                lastSeenAt: Date(),
                connectionMode: current.connectionMode,
                sessionToken: current.sessionToken,
                refreshToken: current.refreshToken,
                accessTokenExpiresAt: current.accessTokenExpiresAt,
                refreshTokenExpiresAt: current.refreshTokenExpiresAt,
                deviceID: current.deviceID,
                certificatePinsetVersion: current.certificatePinsetVersion,
                lastKnownHostPresence: refreshedPresence
            )
            hosts[index] = updated
        }
        return hosts[index]
    }

    func selectHost(id: String) async throws {
        guard hosts.contains(where: { $0.hostID == id }) else {
            throw HostAPIError.noPairedHost
        }
        activeHostID = id
    }

    func removeHost(id: String) async throws {
        hosts.removeAll { $0.hostID == id }
        if activeHostID == id {
            activeHostID = hosts.first?.hostID
        }
    }

    func listInstances() async throws -> [TeamAppInstance] {
        instancesByHost[activeHostID ?? ""] ?? []
    }

    func listKnownRestoreRefs() async throws -> [KnownRestoreRef] {
        (instancesByHost[activeHostID ?? ""] ?? []).compactMap { instance in
            guard let restoreRef = instance.restoreRef else { return nil }
            return KnownRestoreRef(restoreRef: restoreRef, title: instance.title, sessionID: instance.activeSessionID, observedAt: Date())
        }
    }

    func switchToInstance(id: String) async throws -> TeamAppInstance {
        guard let instance = (instancesByHost[activeHostID ?? ""] ?? []).first(where: { $0.id == id }) else {
            throw HostAPIError.noPairedHost
        }
        return instance
    }

    func launchInstance(initialPrompt: String?) async throws -> TeamAppInstance {
        TeamAppInstance(
            id: "launched",
            title: initialPrompt ?? "Launched",
            state: .running,
            createdAt: Date(),
            updatedAt: Date(),
            activeSessionID: "session-launched",
            lastResultPreview: initialPrompt,
            restoreRef: "restore-launched"
        )
    }

    func closeInstance(id: String) async throws {}

    func fetchStatus(for instanceID: String) async throws -> TeamAppStatus {
        TeamAppStatus(
            instanceID: instanceID,
            state: .running,
            progressPercent: 50,
            healthMessage: "ok",
            latestResult: "result",
            activeSessionID: "session-\(instanceID)",
            updatedAt: Date()
        )
    }

    func sendPrompt(_ text: String, to instanceID: String) async throws -> PromptAck {
        PromptAck(requestID: "prompt", acceptedAt: Date())
    }

    func sendFollowUp(_ text: String, threadID: String?, to instanceID: String) async throws -> PromptAck {
        PromptAck(requestID: "follow-up", acceptedAt: Date())
    }

    func answerTrustPrompt(_ approved: Bool, for instanceID: String) async throws {}

    func observeInstanceEvents(
        for instanceID: String,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async {
        onState("connected")
    }

    func stopObservingInstanceEvents() async {}

    func restoreSession(_ sessionID: String) async throws -> SessionRestoreResult {
        let restored = TeamAppInstance(
            id: "restored",
            title: "Restored",
            state: .running,
            createdAt: Date(),
            updatedAt: Date(),
            activeSessionID: sessionID,
            lastResultPreview: "Restored",
            restoreRef: "restore-\(sessionID)"
        )
        return SessionRestoreResult(
            sessionID: sessionID,
            instance: restored,
            status: TeamAppStatus(
                instanceID: restored.id,
                state: .running,
                progressPercent: 50,
                healthMessage: "ok",
                latestResult: "Restored",
                activeSessionID: sessionID,
                updatedAt: Date()
            )
        )
    }

    func restoreLastSession() async throws -> SessionSnapshot? {
        nil
    }

    private func upsert(_ host: HostBeacon) {
        hosts.removeAll { $0.hostID == host.hostID }
        hosts.append(host)
    }
}
