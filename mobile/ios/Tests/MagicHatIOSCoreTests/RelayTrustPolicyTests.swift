import Foundation
import XCTest
@testable import MagicHatIOSCore

final class RelayTrustPolicyTests: XCTestCase {
    func testAllowsHttpsRelayURL() throws {
        let url = try RelayTrustPolicy.validateRelayURL("https://relay.example")

        XCTAssertEqual(url.absoluteString, "https://relay.example/")
    }

    func testAllowsLocalDevelopmentHttpRelayURL() throws {
        let url = try RelayTrustPolicy.validateRelayURL("http://127.0.0.1:18795")

        XCTAssertEqual(url.absoluteString, "http://127.0.0.1:18795/")
    }

    func testRejectsInsecureNonLocalRelayURL() {
        XCTAssertThrowsError(try RelayTrustPolicy.validateRelayURL("http://relay.example")) { error in
            guard case HostAPIError.insecureRelayURL(let rawValue) = error else {
                return XCTFail("Expected insecure relay URL error, got \(error)")
            }
            XCTAssertEqual(rawValue, "http://relay.example")
        }
    }

    func testRejectsUnknownRelayPinsetVersion() {
        XCTAssertThrowsError(try RelayTrustPolicy.pins(for: "prod-2026-01")) { error in
            guard case HostAPIError.unsupportedRelayPinsetVersion(let version) = error else {
                return XCTFail("Expected unsupported pinset error, got \(error)")
            }
            XCTAssertEqual(version, "prod-2026-01")
        }
    }

    func testRemotePairingUriRejectsInsecureNonLocalRelay() {
        XCTAssertThrowsError(
            try RemotePairingURIComponents.parse(
                "magichat://pair?v=2&relay=http%3A%2F%2Frelay.example&host_id=host_remote_1&host_name=Office%20Relay%20Host&bootstrap_token=bootstrap-token-1&host_fingerprint=sha256%3Aabc123&exp=2099-01-01T00:00:00Z"
            )
        ) { error in
            guard case HostAPIError.invalidPairingURI = error else {
                return XCTFail("Expected invalid pairing URI, got \(error)")
            }
        }
    }

    func testRelayClientRejectsUnknownPinsetVersion() {
        XCTAssertThrowsError(
            try URLSessionRelayAPIClient(
                baseURL: URL(string: "https://relay.example")!,
                accessToken: nil,
                certificatePinsetVersion: "prod-2026-01"
            )
        ) { error in
            guard case HostAPIError.unsupportedRelayPinsetVersion(let version) = error else {
                return XCTFail("Expected unsupported pinset error, got \(error)")
            }
            XCTAssertEqual(version, "prod-2026-01")
        }
    }
}
