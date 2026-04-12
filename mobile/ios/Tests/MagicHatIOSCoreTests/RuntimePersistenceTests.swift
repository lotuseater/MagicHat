import Foundation
import XCTest
@testable import MagicHatIOSCore

final class RuntimePersistenceTests: XCTestCase {
    func testFilePersistenceStoresPairedHostsStateAndActiveHostCompatibility() async throws {
        let tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let persistence = FileRuntimePersistence(baseDirectory: tempDirectory)
        let hosts = [
            makeHost(hostID: "lan-1", name: "Desk PC", mode: .lanDirect),
            makeHost(hostID: "remote-1", name: "Office Relay", mode: .remoteRelay),
        ]

        try await persistence.savePairedHostsState(
            PairedHostsState(hosts: hosts, activeHostID: "remote-1")
        )

        let loadedState = await persistence.loadPairedHostsState()
        let compatibilityHost = await persistence.loadPairedHost()

        XCTAssertEqual(loadedState?.hosts.map(\.hostID), ["lan-1", "remote-1"])
        XCTAssertEqual(loadedState?.activeHostID, "remote-1")
        XCTAssertEqual(compatibilityHost?.hostID, "remote-1")

        try? FileManager.default.removeItem(at: tempDirectory)
    }

    private func makeHost(hostID: String, name: String, mode: HostConnectionMode) -> HostBeacon {
        HostBeacon(
            hostID: hostID,
            displayName: name,
            baseURL: mode == .remoteRelay ? "https://relay.example.test" : "http://127.0.0.1:18787/",
            apiVersion: mode == .remoteRelay ? "v2" : "v1",
            capabilities: ["instances"],
            lastSeenAt: Date(),
            connectionMode: mode,
            sessionToken: "token-\(hostID)",
            refreshToken: mode == .remoteRelay ? "refresh-\(hostID)" : nil,
            accessTokenExpiresAt: Date().addingTimeInterval(3600),
            refreshTokenExpiresAt: mode == .remoteRelay ? Date().addingTimeInterval(86400) : nil,
            deviceID: mode == .remoteRelay ? "device-\(hostID)" : nil,
            certificatePinsetVersion: mode == .remoteRelay ? "dev-insecure" : nil,
            lastKnownHostPresence: "online"
        )
    }
}
