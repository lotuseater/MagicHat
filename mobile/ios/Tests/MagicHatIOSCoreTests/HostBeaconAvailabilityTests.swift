import Foundation
import XCTest
@testable import MagicHatIOSCore

final class HostBeaconAvailabilityTests: XCTestCase {
    func testOfflineRemoteHostBlocksCommandsAndFormatsLabels() {
        let host = makeHost(mode: .remoteRelay, presence: "offline")

        XCTAssertFalse(host.canRunCommands)
        XCTAssertEqual(host.transportLabel, "Remote relay")
        XCTAssertEqual(host.endpointLabel, "Relay: https://relay.example.test")
        XCTAssertEqual(host.presenceDisplayLabel, "offline")
    }

    func testLanHostWithoutPresenceStillAllowsCommands() {
        let host = makeHost(mode: .lanDirect, presence: nil)

        XCTAssertTrue(host.canRunCommands)
        XCTAssertEqual(host.transportLabel, "LAN direct")
        XCTAssertEqual(host.endpointLabel, "Endpoint: http://127.0.0.1:18787/")
    }

    func testPresenceFormattingNormalizesUnderscores() {
        let host = makeHost(mode: .remoteRelay, presence: "needs_attention")

        XCTAssertTrue(host.canRunCommands)
        XCTAssertEqual(host.presenceDisplayLabel, "needs attention")
    }

    private func makeHost(mode: HostConnectionMode, presence: String?) -> HostBeacon {
        HostBeacon(
            hostID: "host-1",
            displayName: "Office Host",
            baseURL: mode == .remoteRelay ? "https://relay.example.test" : "http://127.0.0.1:18787/",
            apiVersion: mode == .remoteRelay ? "v2" : "v1",
            capabilities: ["instances"],
            lastSeenAt: Date(),
            connectionMode: mode,
            sessionToken: "token",
            refreshToken: mode == .remoteRelay ? "refresh" : nil,
            accessTokenExpiresAt: Date().addingTimeInterval(3600),
            refreshTokenExpiresAt: mode == .remoteRelay ? Date().addingTimeInterval(86400) : nil,
            deviceID: mode == .remoteRelay ? "device-1" : nil,
            certificatePinsetVersion: mode == .remoteRelay ? "dev-insecure" : nil,
            lastKnownHostPresence: presence
        )
    }
}
