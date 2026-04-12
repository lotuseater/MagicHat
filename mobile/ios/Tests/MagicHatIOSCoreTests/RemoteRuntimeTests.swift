import Foundation
import XCTest
@testable import MagicHatIOSCore

private actor EmptyBeaconDiscovery: BeaconDiscovering {
    func discoverBeacons() async throws -> [HostBeacon] {
        []
    }
}

private actor MemoryRuntimePersistence: RuntimePersistence {
    var pairedHost: HostBeacon?
    var snapshot: SessionSnapshot?

    func loadPairedHost() async -> HostBeacon? {
        pairedHost
    }

    func savePairedHost(_ host: HostBeacon?) async throws {
        pairedHost = host
    }

    func loadSessionSnapshot() async -> SessionSnapshot? {
        snapshot
    }

    func saveSessionSnapshot(_ snapshot: SessionSnapshot?) async throws {
        self.snapshot = snapshot
    }
}

private actor TestRelayClient: RelayAPIClient {
    struct LaunchCall: Equatable {
        let hostID: String
        let title: String?
        let restoreRef: String?
    }

    var claimStatusResponses: [RemoteClaimStatus] = []
    var listedRestoreRefs: [KnownRestoreRef] = []
    var listedHosts: [RemoteHostStatus] = []
    var listedInstances: [RemoteInstanceWire] = []
    var detailByInstanceID: [String: RemoteInstanceWire] = [:]
    var nextRegistration: RemoteDeviceRegistration
    var nextRefresh: RemoteSessionRefresh
    var launches: [LaunchCall] = []
    var refreshRequests: [String] = []

    init() {
        nextRegistration = RemoteDeviceRegistration(
            hostID: "host_remote_1",
            hostName: "Office Relay Host",
            deviceID: "device_remote_1",
            accessToken: "access_initial",
            accessTokenExpiresAt: Date().addingTimeInterval(600),
            refreshToken: "refresh_initial",
            refreshTokenExpiresAt: Date().addingTimeInterval(86400),
            certificatePinsetVersion: "dev-insecure"
        )
        nextRefresh = RemoteSessionRefresh(
            accessToken: "access_refreshed",
            accessTokenExpiresAt: Date().addingTimeInterval(600),
            refreshToken: "refresh_refreshed",
            refreshTokenExpiresAt: Date().addingTimeInterval(86400)
        )
    }

    func setClaimStatusResponses(_ responses: [RemoteClaimStatus]) {
        claimStatusResponses = responses
    }

    func setListedRestoreRefs(_ restoreRefs: [KnownRestoreRef]) {
        listedRestoreRefs = restoreRefs
    }

    func setListedHosts(_ hosts: [RemoteHostStatus]) {
        listedHosts = hosts
    }

    func setListedInstances(_ instances: [RemoteInstanceWire]) {
        listedInstances = instances
    }

    func setDetailByInstanceID(_ details: [String: RemoteInstanceWire]) {
        detailByInstanceID = details
    }

    func recordedLaunches() -> [LaunchCall] {
        launches
    }

    func recordedRefreshRequests() -> [String] {
        refreshRequests
    }

    func claimBootstrap(bootstrapToken: String, deviceName: String, devicePublicKey: String, platform: String) async throws -> RemotePairClaim {
        XCTAssertEqual(bootstrapToken, "bootstrap-token-1")
        XCTAssertEqual(deviceName, "MagicHat iPhone")
        XCTAssertEqual(platform, "ios")
        XCTAssertFalse(devicePublicKey.isEmpty)
        return RemotePairClaim(
            claimID: "claim_remote_1",
            status: "pending_approval",
            hostID: "host_remote_1",
            hostName: "Office Relay Host"
        )
    }

    func fetchClaimStatus(claimID: String) async throws -> RemoteClaimStatus {
        XCTAssertEqual(claimID, "claim_remote_1")
        if claimStatusResponses.isEmpty {
            return RemoteClaimStatus(
                claimID: claimID,
                status: "approved",
                challenge: "relay-challenge-1",
                hostID: "host_remote_1",
                hostName: "Office Relay Host"
            )
        }
        return claimStatusResponses.removeFirst()
    }

    func completeRegistration(claimID: String, challenge: String, signature: String) async throws -> RemoteDeviceRegistration {
        XCTAssertEqual(claimID, "claim_remote_1")
        XCTAssertEqual(challenge, "relay-challenge-1")
        XCTAssertFalse(signature.isEmpty)
        return nextRegistration
    }

    func refreshSession(refreshToken: String) async throws -> RemoteSessionRefresh {
        refreshRequests.append(refreshToken)
        return nextRefresh
    }

    func listHosts() async throws -> [RemoteHostStatus] {
        listedHosts
    }

    func listInstances(hostID: String) async throws -> [RemoteInstanceWire] {
        XCTAssertEqual(hostID, "host_remote_1")
        return listedInstances
    }

    func getInstanceDetail(hostID: String, instanceID: String) async throws -> RemoteInstanceWire {
        XCTAssertEqual(hostID, "host_remote_1")
        guard let detail = detailByInstanceID[instanceID] else {
            throw HostAPIError.http(statusCode: 404, message: "missing detail")
        }
        return detail
    }

    func launchInstance(hostID: String, title: String?, restoreRef: String?) async throws -> RemoteInstanceWire {
        XCTAssertEqual(hostID, "host_remote_1")
        launches.append(LaunchCall(hostID: hostID, title: title, restoreRef: restoreRef))
        let instanceID = restoreRef == nil ? "instance_remote_launch" : "instance_remote_restore"
        return RemoteInstanceWire(
            id: instanceID,
            instanceID: instanceID,
            title: title ?? "Restored from \(restoreRef ?? "n/a")",
            active: true,
            health: "running",
            phase: "executing",
            sessionID: restoreRef == nil ? "session_new" : "session_restored",
            startedAt: Int64(Date().timeIntervalSince1970 * 1000),
            resultSummary: RemoteResultSummary(shortText: title ?? "Restored"),
            restoreRef: restoreRef,
            status: "running",
            snapshot: RemoteSnapshot(phase: "executing", resultSummary: RemoteResultSummary(shortText: title ?? "Restored")),
            summaryText: title ?? "Restored"
        )
    }

    func closeInstance(hostID: String, instanceID: String) async throws {
        XCTAssertEqual(hostID, "host_remote_1")
        XCTAssertFalse(instanceID.isEmpty)
    }

    func sendPrompt(hostID: String, instanceID: String, prompt: String) async throws {
        XCTAssertEqual(hostID, "host_remote_1")
        XCTAssertFalse(instanceID.isEmpty)
        XCTAssertFalse(prompt.isEmpty)
    }

    func sendFollowUp(hostID: String, instanceID: String, message: String) async throws {
        XCTAssertEqual(hostID, "host_remote_1")
        XCTAssertFalse(instanceID.isEmpty)
        XCTAssertFalse(message.isEmpty)
    }

    func listKnownRestoreRefs(hostID: String) async throws -> [KnownRestoreRef] {
        XCTAssertEqual(hostID, "host_remote_1")
        return listedRestoreRefs
    }
}

final class RemoteRuntimeTests: XCTestCase {
    func testRemotePairingPersistsRelayBackedHostAndListsRestoreRefs() async throws {
        let persistence = MemoryRuntimePersistence()
        let relay = TestRelayClient()

        await relay.setClaimStatusResponses([
            RemoteClaimStatus(
                claimID: "claim_remote_1",
                status: "approved",
                challenge: "relay-challenge-1",
                hostID: "host_remote_1",
                hostName: "Office Relay Host"
            )
        ])
        await relay.setListedHosts([
            RemoteHostStatus(
                hostID: "host_remote_1",
                hostName: "Office Relay Host",
                status: "online",
                lastSeenAt: Date()
            )
        ])
        await relay.setListedRestoreRefs([
            KnownRestoreRef(
                restoreRef: "restore_remote_alpha",
                title: "Remote Alpha",
                sessionID: "session_remote_alpha",
                observedAt: Date()
            )
        ])
        await relay.setListedInstances([
            RemoteInstanceWire(
                id: "instance_remote_alpha",
                instanceID: "instance_remote_alpha",
                title: "Remote Alpha",
                active: true,
                health: "running",
                phase: "executing",
                sessionID: "session_remote_alpha",
                startedAt: Int64(Date().timeIntervalSince1970 * 1000),
                resultSummary: RemoteResultSummary(shortText: "Remote result"),
                restoreRef: "restore_remote_alpha",
                status: "running",
                snapshot: RemoteSnapshot(phase: "executing", resultSummary: RemoteResultSummary(shortText: "Remote result")),
                summaryText: "Remote result"
            )
        ])

        let service = TeamAppRuntimeService(
            beaconDiscovery: EmptyBeaconDiscovery(),
            persistence: persistence,
            deviceKeyStore: DeviceKeyStore(service: "com.magichat.remote.tests.\(UUID().uuidString)"),
            makeClient: { _ in
                XCTFail("LAN client should not be used for remote pairing test")
                return URLSessionHostAPIClient(baseURL: URL(string: "http://127.0.0.1:1")!)
            },
            makeRelayClient: { _, _, _ in
                relay
            }
        )

        let paired = try await service.registerPairingURI(
            "magichat://pair?v=2&relay=http%3A%2F%2F127.0.0.1%3A18795&host_id=host_remote_1&host_name=Office%20Relay%20Host&bootstrap_token=bootstrap-token-1&host_fingerprint=sha256%3Aabc123&exp=2099-01-01T00:00:00Z",
            deviceName: "MagicHat iPhone"
        )

        XCTAssertEqual(paired.resolvedConnectionMode, .remoteRelay)
        XCTAssertEqual(paired.hostID, "host_remote_1")
        XCTAssertEqual(paired.sessionToken, "access_initial")

        let currentHost = await service.currentHost()
        XCTAssertEqual(currentHost?.resolvedConnectionMode, .remoteRelay)
        XCTAssertEqual(currentHost?.lastKnownHostPresence, "unknown")

        let restoreRefs = try await service.listKnownRestoreRefs()
        XCTAssertEqual(restoreRefs.map(\.restoreRef), ["restore_remote_alpha"])

        let instances = try await service.listInstances()
        XCTAssertEqual(instances.map(\.id), ["instance_remote_alpha"])
        XCTAssertEqual(instances.first?.restoreRef, "restore_remote_alpha")

        let persistedHost = await persistence.loadPairedHost()
        XCTAssertEqual(persistedHost?.resolvedConnectionMode, .remoteRelay)
        XCTAssertEqual(persistedHost?.lastKnownHostPresence, "online")
    }

    func testRemoteRestoreRefreshesExpiredTokenAndUsesRestoreRef() async throws {
        let persistence = MemoryRuntimePersistence()
        let relay = TestRelayClient()
        let now = Date()

        let expiredHost = HostBeacon(
            hostID: "host_remote_1",
            displayName: "Office Relay Host",
            baseURL: "http://127.0.0.1:18795/",
            apiVersion: "v2",
            capabilities: ["instances", "restore"],
            lastSeenAt: now,
            connectionMode: .remoteRelay,
            sessionToken: "access_expired",
            refreshToken: "refresh_expired",
            accessTokenExpiresAt: now.addingTimeInterval(-60),
            refreshTokenExpiresAt: now.addingTimeInterval(3600),
            deviceID: "device_remote_1",
            certificatePinsetVersion: "dev-insecure",
            lastKnownHostPresence: "online"
        )
        try await persistence.savePairedHost(expiredHost)
        try await persistence.saveSessionSnapshot(
            SessionSnapshot(
                host: expiredHost,
                activeInstanceID: nil,
                activeSessionID: nil,
                activeRestoreRef: nil,
                updatedAt: now
            )
        )

        await relay.setDetailByInstanceID([
            "instance_remote_restore": RemoteInstanceWire(
                id: "instance_remote_restore",
                instanceID: "instance_remote_restore",
                title: "Restored Remote Task",
                active: true,
                health: "running",
                phase: "executing",
                sessionID: "session_restored",
                startedAt: Int64(Date().timeIntervalSince1970 * 1000),
                resultSummary: RemoteResultSummary(shortText: "Restored output"),
                restoreRef: "restore_remote_alpha",
                status: "running",
                snapshot: RemoteSnapshot(phase: "executing", resultSummary: RemoteResultSummary(shortText: "Restored output")),
                summaryText: "Restored output"
            )
        ])

        let service = TeamAppRuntimeService(
            beaconDiscovery: EmptyBeaconDiscovery(),
            persistence: persistence,
            deviceKeyStore: DeviceKeyStore(service: "com.magichat.remote.tests.\(UUID().uuidString)"),
            makeClient: { _ in
                XCTFail("LAN client should not be used for remote restore test")
                return URLSessionHostAPIClient(baseURL: URL(string: "http://127.0.0.1:1")!)
            },
            makeRelayClient: { _, _, _ in
                relay
            }
        )

        let restored = try await service.restoreSession("restore_remote_alpha")

        XCTAssertEqual(restored.sessionID, "restore_remote_alpha")
        XCTAssertEqual(restored.instance.id, "instance_remote_restore")
        XCTAssertEqual(restored.instance.restoreRef, "restore_remote_alpha")

        let launches = await relay.recordedLaunches()
        XCTAssertEqual(launches, [
            TestRelayClient.LaunchCall(hostID: "host_remote_1", title: nil, restoreRef: "restore_remote_alpha")
        ])

        let refreshRequests = await relay.recordedRefreshRequests()
        XCTAssertEqual(refreshRequests, ["refresh_expired"])

        let persistedHost = await persistence.loadPairedHost()
        XCTAssertEqual(persistedHost?.sessionToken, "access_refreshed")
        XCTAssertEqual(persistedHost?.refreshToken, "refresh_refreshed")

        let snapshot = await persistence.loadSessionSnapshot()
        XCTAssertEqual(snapshot?.activeInstanceID, "instance_remote_restore")
        XCTAssertEqual(snapshot?.activeRestoreRef, "restore_remote_alpha")
    }
}
