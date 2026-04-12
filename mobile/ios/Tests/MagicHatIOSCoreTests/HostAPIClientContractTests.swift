import Foundation
import XCTest
@testable import MagicHatIOSCore

private final class MockURLProtocol: URLProtocol {
    typealias Handler = @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)

    private static let lock = NSLock()
    private static var handlers: [Handler] = []

    static func enqueue(_ handler: @escaping Handler) {
        lock.lock()
        handlers.append(handler)
        lock.unlock()
    }

    static func reset() {
        lock.lock()
        handlers.removeAll()
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.lock.lock()
        let handler = Self.handlers.isEmpty ? nil : Self.handlers.removeFirst()
        Self.lock.unlock()

        guard let handler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "MockURLProtocol", code: 1))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private func makeSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    return URLSession(configuration: configuration)
}

private func jsonData(_ object: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [])
}

private func requestBodyData(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody {
        return body
    }

    guard let stream = request.httpBodyStream else {
        throw NSError(domain: "HostAPIClientContractTests", code: 1, userInfo: nil)
    }

    stream.open()
    defer { stream.close() }

    var data = Data()
    let bufferSize = 4096
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }

    while stream.hasBytesAvailable {
        let count = stream.read(buffer, maxLength: bufferSize)
        if count < 0 {
            throw stream.streamError ?? NSError(domain: "HostAPIClientContractTests", code: 2, userInfo: nil)
        }
        if count == 0 {
            break
        }
        data.append(buffer, count: count)
    }

    return data
}

private func response(for request: URLRequest, statusCode: Int, body: Data) -> HTTPURLResponse {
    HTTPURLResponse(
        url: request.url ?? URL(string: "http://127.0.0.1:18787")!,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
    )!
}

final class HostAPIClientContractTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    func testFetchBeaconSynthesizesLanBeaconFromHealthEndpoint() async throws {
        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.url?.path, "/healthz")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            let body = try jsonData([
                "status": "ok",
                "service": "magichat-host",
                "ts": 1_710_000_000_000,
            ])
            return (response(for: request, statusCode: 200, body: body), body)
        }

        let client = URLSessionHostAPIClient(
            baseURL: URL(string: "http://127.0.0.1:18787/")!,
            session: makeSession()
        )

        let beacon = try await client.fetchBeacon()

        XCTAssertEqual(beacon.hostID, "127.0.0.1:18787")
        XCTAssertEqual(beacon.displayName, "127.0.0.1")
        XCTAssertEqual(beacon.resolvedConnectionMode, .lanDirect)
        XCTAssertTrue(beacon.capabilities.contains("updates"))
    }

    func testBeginPairingAndFetchHostInfoUseCurrentV1Contract() async throws {
        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/pairing/session")
            let payload = try requestBodyData(request)
            let body = try XCTUnwrap(
                JSONSerialization.jsonObject(with: payload) as? [String: Any]
            )
            XCTAssertEqual(body["pairing_code"] as? String, "123456")
            XCTAssertEqual(body["device_name"] as? String, "MagicHat iPhone")

            let responseBody = try jsonData([
                "session_token": "lan_token",
                "expires_at": "2099-01-01T00:00:00Z",
                "host_id": "host_lan_1",
                "host_name": "Office PC",
            ])
            return (response(for: request, statusCode: 201, body: responseBody), responseBody)
        }

        let pairingClient = URLSessionHostAPIClient(
            baseURL: URL(string: "http://127.0.0.1:18787/")!,
            session: makeSession()
        )
        let pairing = try await pairingClient.beginPairing(
            pairingCode: "123456",
            deviceName: "MagicHat iPhone",
            deviceID: nil
        )

        XCTAssertEqual(pairing.sessionToken, "lan_token")
        XCTAssertEqual(pairing.hostID, "host_lan_1")

        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/v1/host")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer lan_token")

            let responseBody = try jsonData([
                "host_id": "host_lan_1",
                "host_name": "Office PC",
                "lan_address": "192.168.0.5",
                "api_version": "1.0.0",
                "scope": "lan_only_v1",
            ])
            return (response(for: request, statusCode: 200, body: responseBody), responseBody)
        }

        let authedClient = URLSessionHostAPIClient(
            baseURL: URL(string: "http://127.0.0.1:18787/")!,
            accessToken: pairing.sessionToken,
            session: makeSession()
        )
        let hostInfo = try await authedClient.fetchHostInfo()

        XCTAssertEqual(hostInfo.hostID, "host_lan_1")
        XCTAssertEqual(hostInfo.hostName, "Office PC")
        XCTAssertEqual(hostInfo.lanAddress, "192.168.0.5")
    }

    func testListInstancesAndFetchStatusDecodeCurrentHostPayloads() async throws {
        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.url?.path, "/v1/instances")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer lan_token")
            let responseBody = try jsonData([
                "instances": [[
                    "id": "wizard_team_app_311_1000",
                    "instance_id": "wizard_team_app_311_1000",
                    "pid": 311,
                    "phase": "running",
                    "session_id": "session-alpha",
                    "started_at": 1_710_000_000_000 as NSNumber,
                    "current_task_state": [
                        "phase": "running",
                        "task": "Investigate MagicHat",
                    ],
                    "result_summary": [
                        "short_text": "Worker swarm active",
                    ],
                ]],
            ])
            return (response(for: request, statusCode: 200, body: responseBody), responseBody)
        }

        let client = URLSessionHostAPIClient(
            baseURL: URL(string: "http://127.0.0.1:18787/")!,
            accessToken: "lan_token",
            session: makeSession()
        )

        let instances = try await client.listInstances()
        XCTAssertEqual(instances.map(\.id), ["wizard_team_app_311_1000"])
        XCTAssertEqual(instances.first?.title, "Investigate MagicHat")
        XCTAssertEqual(instances.first?.lastResultPreview, "Worker swarm active")

        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.url?.path, "/v1/instances/wizard_team_app_311_1000")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer lan_token")
            let responseBody = try jsonData([
                "id": "wizard_team_app_311_1000",
                "instance_id": "wizard_team_app_311_1000",
                "pid": 311,
                "phase": "blocked",
                "session_id": "session-alpha",
                "started_at": 1_710_000_000_000 as NSNumber,
                "current_task_state": [
                    "phase": "blocked",
                    "task": "Investigate MagicHat",
                ],
                "result_summary": [
                    "short_text": "Waiting for trust",
                ],
                "status": "ok",
                "summary_text": "Waiting for trust",
                "snapshot": [
                    "phase": "blocked",
                    "result_summary": [
                        "short_text": "Waiting for trust",
                    ],
                    "trust_status": "prompt_required",
                    "pending_trust_project": "/Users/oleh/Documents/GitHub/MagicHat",
                ],
            ])
            return (response(for: request, statusCode: 200, body: responseBody), responseBody)
        }

        let status = try await client.fetchStatus(instanceID: "wizard_team_app_311_1000")
        XCTAssertEqual(status.instanceID, "wizard_team_app_311_1000")
        XCTAssertEqual(status.trustStatus, "prompt_required")
        XCTAssertEqual(status.pendingTrustProject, "/Users/oleh/Documents/GitHub/MagicHat")
        XCTAssertEqual(status.latestResult, "Waiting for trust")
    }

    func testRestoreSessionResolvesSessionSelectorThroughRestoreRefs() async throws {
        let client = URLSessionHostAPIClient(
            baseURL: URL(string: "http://127.0.0.1:18787/")!,
            accessToken: "lan_token",
            session: makeSession()
        )

        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.url?.path, "/v1/restore-refs")
            let responseBody = try jsonData([
                "restore_refs": [[
                    "restore_ref": "restore_alpha",
                    "session_id": "session-alpha",
                    "title": "Restore Alpha",
                    "observed_at": "2099-01-01T00:00:00Z",
                ]],
            ])
            return (response(for: request, statusCode: 200, body: responseBody), responseBody)
        }

        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.url?.path, "/v1/instances")
            let payload = try requestBodyData(request)
            let body = try XCTUnwrap(
                JSONSerialization.jsonObject(with: payload) as? [String: Any]
            )
            XCTAssertEqual(body["restore_ref"] as? String, "restore_alpha")
            XCTAssertNil(body["restore_state_path"])

            let responseBody = try jsonData([
                "id": "wizard_team_app_999_9990",
                "instance_id": "wizard_team_app_999_9990",
                "pid": 999,
                "phase": "running",
                "session_id": "session-restored",
                "started_at": 1_710_000_010_000 as NSNumber,
                "current_task_state": [
                    "phase": "running",
                    "task": "Restored Alpha",
                ],
                "result_summary": [
                    "short_text": "Restore queued",
                ],
            ])
            return (response(for: request, statusCode: 201, body: responseBody), responseBody)
        }

        MockURLProtocol.enqueue { request in
            XCTAssertEqual(request.url?.path, "/v1/instances/wizard_team_app_999_9990")
            let responseBody = try jsonData([
                "id": "wizard_team_app_999_9990",
                "instance_id": "wizard_team_app_999_9990",
                "pid": 999,
                "phase": "running",
                "session_id": "session-restored",
                "started_at": 1_710_000_010_000 as NSNumber,
                "current_task_state": [
                    "phase": "running",
                    "task": "Restored Alpha",
                ],
                "result_summary": [
                    "short_text": "Restore queued",
                ],
                "status": "ok",
                "summary_text": "Restore queued",
                "snapshot": [
                    "phase": "running",
                    "result_summary": [
                        "short_text": "Restore queued",
                    ],
                ],
            ])
            return (response(for: request, statusCode: 200, body: responseBody), responseBody)
        }

        let restored = try await client.restoreSession(id: "session-alpha")

        XCTAssertEqual(restored.sessionID, "session-alpha")
        XCTAssertEqual(restored.instance.id, "wizard_team_app_999_9990")
        XCTAssertEqual(restored.status.instanceID, "wizard_team_app_999_9990")
        XCTAssertEqual(restored.status.latestResult, "Restore queued")
    }
}
