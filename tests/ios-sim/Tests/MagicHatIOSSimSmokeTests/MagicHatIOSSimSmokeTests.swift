import Foundation
import XCTest
@testable import MagicHatIOSSimSmoke

final class MagicHatIOSSimSmokeTests: XCTestCase {
    private var probe: TransportProbe {
        let raw = ProcessInfo.processInfo.environment["MAGICHAT_HOST_URL"] ?? "http://127.0.0.1:18787"
        guard let url = URL(string: raw) else {
            fatalError("invalid MAGICHAT_HOST_URL")
        }
        return TransportProbe(baseURL: url)
    }

    private var pairingCode: String {
        ProcessInfo.processInfo.environment["MAGICHAT_PAIRING_CODE"] ?? "123456"
    }

    func testUnauthorizedListInstancesRejected() async throws {
        let response = try await probe.request(
            path: "/v1/instances",
            method: "GET",
            token: nil
        )
        XCTAssertEqual(response.status, 401)
    }

    func testPairThenListInstancesAuthorized() async throws {
        let pairBody = [
            "pairing_code": pairingCode,
            "device_name": "ios-sim-smoke"
        ]
        let pairData = try JSONSerialization.data(withJSONObject: pairBody)

        let pairResponse = try await probe.request(
            path: "/v1/pairing/session",
            method: "POST",
            body: pairData
        )
        XCTAssertEqual(pairResponse.status, 201)

        guard
            let pairJSON = try JSONSerialization.jsonObject(with: pairResponse.data) as? [String: Any],
            let token = pairJSON["session_token"] as? String
        else {
            XCTFail("missing session token in pair response")
            return
        }

        let listResponse = try await probe.request(
            path: "/v1/instances",
            method: "GET",
            token: token
        )
        XCTAssertEqual(listResponse.status, 200)

        let payload = try JSONSerialization.jsonObject(with: listResponse.data) as? [String: Any]
        XCTAssertNotNil(payload?["instances"])
    }

    func testPairThenListRestoreRefsAuthorized() async throws {
        let pairBody = [
            "pairing_code": pairingCode,
            "device_name": "ios-sim-smoke"
        ]
        let pairData = try JSONSerialization.data(withJSONObject: pairBody)

        let pairResponse = try await probe.request(
            path: "/v1/pairing/session",
            method: "POST",
            body: pairData
        )
        XCTAssertEqual(pairResponse.status, 201)

        guard
            let pairJSON = try JSONSerialization.jsonObject(with: pairResponse.data) as? [String: Any],
            let token = pairJSON["session_token"] as? String
        else {
            XCTFail("missing session token in pair response")
            return
        }

        let restoreResponse = try await probe.request(
            path: "/v1/restore-refs",
            method: "GET",
            token: token
        )
        XCTAssertEqual(restoreResponse.status, 200)

        let payload = try JSONSerialization.jsonObject(with: restoreResponse.data) as? [String: Any]
        let restoreRefs = payload?["restore_refs"] as? [[String: Any]]
        XCTAssertEqual(restoreRefs?.first?["session_id"] as? String, "session-initial")
        XCTAssertNotNil(restoreRefs?.first?["restore_ref"] as? String)
    }

    func testPairThenLaunchRestoreByRestoreRef() async throws {
        let pairBody = [
            "pairing_code": pairingCode,
            "device_name": "ios-sim-smoke"
        ]
        let pairData = try JSONSerialization.data(withJSONObject: pairBody)

        let pairResponse = try await probe.request(
            path: "/v1/pairing/session",
            method: "POST",
            body: pairData
        )
        XCTAssertEqual(pairResponse.status, 201)

        guard
            let pairJSON = try JSONSerialization.jsonObject(with: pairResponse.data) as? [String: Any],
            let token = pairJSON["session_token"] as? String
        else {
            XCTFail("missing session token in pair response")
            return
        }

        let restoreResponse = try await probe.request(
            path: "/v1/restore-refs",
            method: "GET",
            token: token
        )
        let restorePayload = try JSONSerialization.jsonObject(with: restoreResponse.data) as? [String: Any]
        guard let restoreRef = (restorePayload?["restore_refs"] as? [[String: Any]])?.first?["restore_ref"] as? String else {
            XCTFail("missing restore ref")
            return
        }

        let launchData = try JSONSerialization.data(withJSONObject: [
            "restore_ref": restoreRef
        ])
        let launchResponse = try await probe.request(
            path: "/v1/instances",
            method: "POST",
            token: token,
            body: launchData
        )
        XCTAssertEqual(launchResponse.status, 201)

        let launchPayload = try JSONSerialization.jsonObject(with: launchResponse.data) as? [String: Any]
        XCTAssertNotNil(launchPayload?["instance_id"] as? String)
        XCTAssertEqual(launchPayload?["phase"] as? String, "running")
    }
}
