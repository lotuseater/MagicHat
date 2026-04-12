import Foundation
import XCTest
@testable import MagicHatIOSCore

private actor StaticBeaconDiscovery: BeaconDiscovering {
    let beacons: [HostBeacon]

    init(beacons: [HostBeacon]) {
        self.beacons = beacons
    }

    func discoverBeacons() async throws -> [HostBeacon] {
        beacons
    }
}

private actor MemoryLanRuntimePersistence: RuntimePersistence {
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

private actor NoopEventStreamClient: InstanceEventStreaming {
    func start(
        requestProvider: @escaping RequestProvider,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async {
        _ = requestProvider
        _ = onEvent
        _ = onState
    }

    func stop() async {}
}

private final class LanClientRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var seenAccessTokens: [String?] = []
    private(set) var pairingCodes: [String] = []

    func recordClientToken(_ token: String?) {
        lock.lock()
        seenAccessTokens.append(token)
        lock.unlock()
    }

    func recordPairingCode(_ code: String) {
        lock.lock()
        pairingCodes.append(code)
        lock.unlock()
    }
}

private struct TestLanHostClient: HostAPIClient {
    let recorder: LanClientRecorder

    init(recorder: LanClientRecorder, accessToken: String?) {
        self.recorder = recorder
        recorder.recordClientToken(accessToken)
    }

    func fetchBeacon() async throws -> HostBeacon {
        HostBeacon(
            hostID: "host_lan_1",
            displayName: "Office PC",
            baseURL: "http://127.0.0.1:18787/",
            apiVersion: "v1",
            capabilities: ["instances", "restore"],
            lastSeenAt: Date(),
            connectionMode: .lanDirect
        )
    }

    func fetchHealth() async throws -> HostHealth {
        HostHealth(status: "ok", service: "magichat-host", timestampMs: 1_710_000_000_000)
    }

    func beginPairing(pairingCode: String, deviceName: String, deviceID: String?) async throws -> HostPairingSession {
        recorder.recordPairingCode(pairingCode)
        XCTAssertEqual(deviceName, "MagicHat iPhone")
        XCTAssertNil(deviceID)
        return HostPairingSession(
            sessionToken: "lan_token",
            expiresAt: Date().addingTimeInterval(3600),
            hostID: "host_lan_1",
            hostName: "Office PC"
        )
    }

    func fetchHostInfo() async throws -> HostIdentity {
        HostIdentity(
            hostID: "host_lan_1",
            hostName: "Office PC",
            lanAddress: "192.168.0.5",
            apiVersion: "1.0.0",
            scope: "lan_only_v1"
        )
    }

    func listInstances() async throws -> [TeamAppInstance] { [] }
    func switchInstance(id: String) async throws -> TeamAppInstance { throw HostAPIError.http(statusCode: 404, message: id) }
    func launchInstance(request: LaunchInstanceRequest) async throws -> TeamAppInstance { throw HostAPIError.http(statusCode: 501, message: "unused") }
    func closeInstance(id: String) async throws {}
    func fetchStatus(instanceID: String) async throws -> TeamAppStatus { throw HostAPIError.http(statusCode: 501, message: instanceID) }
    func sendPrompt(_ submission: PromptSubmission, instanceID: String) async throws -> PromptAck { throw HostAPIError.http(statusCode: 501, message: submission.text) }
    func sendFollowUp(_ submission: FollowUpSubmission, instanceID: String) async throws -> PromptAck { throw HostAPIError.http(statusCode: 501, message: submission.text) }
    func answerTrustPrompt(_ approved: Bool, instanceID: String) async throws {}

    func listKnownRestoreRefs() async throws -> [KnownRestoreRef] {
        [
            KnownRestoreRef(
                restoreRef: "restore_alpha",
                title: "Restore Alpha",
                sessionID: "session-alpha",
                observedAt: Date()
            )
        ]
    }

    func restoreSession(id: String) async throws -> SessionRestoreResult {
        throw HostAPIError.http(statusCode: 501, message: id)
    }
}

final class LanRuntimeTests: XCTestCase {
    func testLanPairToFirstAvailableHostUsesProvidedPairingCodeAndPersistsSession() async throws {
        let persistence = MemoryLanRuntimePersistence()
        let recorder = LanClientRecorder()
        let eventStreamClient = NoopEventStreamClient()
        let discovery = StaticBeaconDiscovery(
            beacons: [
                HostBeacon(
                    hostID: "127.0.0.1:18787",
                    displayName: "127.0.0.1",
                    baseURL: "http://127.0.0.1:18787/",
                    apiVersion: "v1",
                    capabilities: ["instances", "restore"],
                    lastSeenAt: Date(),
                    connectionMode: .lanDirect
                )
            ]
        )

        let service = TeamAppRuntimeService(
            beaconDiscovery: discovery,
            persistence: persistence,
            deviceKeyStore: DeviceKeyStore(service: "com.magichat.lan.tests.\(UUID().uuidString)"),
            makeClient: { baseURL, accessToken in
                XCTAssertEqual(baseURL.absoluteString, "http://127.0.0.1:18787/")
                return TestLanHostClient(recorder: recorder, accessToken: accessToken)
            },
            makeRelayClient: { _, _, _ in
                XCTFail("Relay client should not be used for LAN pairing test")
                throw HostAPIError.noPairedHost
            },
            eventStreamClient: eventStreamClient
        )

        let paired = try await service.pairToFirstAvailableHost(pairingCode: "123456")

        XCTAssertEqual(paired.hostID, "host_lan_1")
        XCTAssertEqual(paired.displayName, "Office PC")
        XCTAssertEqual(paired.sessionToken, "lan_token")

        let persistedHost = await persistence.loadPairedHost()
        XCTAssertEqual(persistedHost?.hostID, "host_lan_1")
        XCTAssertEqual(persistedHost?.sessionToken, "lan_token")

        let knownRestoreRefs = try await service.listKnownRestoreRefs()
        XCTAssertEqual(knownRestoreRefs.map(\.restoreRef), ["restore_alpha"])
        XCTAssertEqual(recorder.pairingCodes, ["123456"])
        XCTAssertEqual(recorder.seenAccessTokens, [nil, Optional("lan_token")])
    }
}
