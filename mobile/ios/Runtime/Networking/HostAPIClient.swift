import Foundation

public enum HostAPIError: Error, LocalizedError {
    case invalidBaseURL(String)
    case invalidPairingURI(String)
    case insecureRelayURL(String)
    case unsupportedRelayPinsetVersion(String)
    case noPairedHost
    case beaconDiscoveryFailed
    case transport(Error)
    case invalidResponse
    case http(statusCode: Int, message: String)
    case decoding(Error)
    case encoding(Error)
    case pairingTimedOut
    case pairingRejected
    case missingPairingCode

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let raw):
            return "Invalid base URL: \(raw)"
        case .invalidPairingURI(let raw):
            return "Invalid pairing URI: \(raw)"
        case .insecureRelayURL(let raw):
            return "Relay URL must use HTTPS unless it targets a local development relay: \(raw)"
        case .unsupportedRelayPinsetVersion(let version):
            return "Unsupported relay certificate pinset version: \(version)"
        case .noPairedHost:
            return "No paired host available"
        case .beaconDiscoveryFailed:
            return "Beacon discovery did not return any reachable Team App hosts"
        case .transport(let error):
            return "Network transport error: \(error.localizedDescription)"
        case .invalidResponse:
            return "Host returned a non-HTTP response"
        case .http(let statusCode, let message):
            return "Host returned HTTP \(statusCode): \(message)"
        case .decoding(let error):
            return "Failed to decode host response: \(error.localizedDescription)"
        case .encoding(let error):
            return "Failed to encode host request: \(error.localizedDescription)"
        case .pairingTimedOut:
            return "Timed out waiting for host approval"
        case .pairingRejected:
            return "Pairing was rejected on the host"
        case .missingPairingCode:
            return "A pairing code is required to authorize a LAN host"
        }
    }
}

public struct HostPairingSession: Codable, Hashable, Sendable {
    public let sessionToken: String
    public let expiresAt: Date
    public let hostID: String
    public let hostName: String

    private enum CodingKeys: String, CodingKey {
        case sessionToken = "session_token"
        case expiresAt = "expires_at"
        case hostID = "host_id"
        case hostName = "host_name"
    }
}

public struct HostIdentity: Codable, Hashable, Sendable {
    public let hostID: String
    public let hostName: String
    public let lanAddress: String?
    public let apiVersion: String?
    public let scope: String?

    private enum CodingKeys: String, CodingKey {
        case hostID = "host_id"
        case hostName = "host_name"
        case lanAddress = "lan_address"
        case apiVersion = "api_version"
        case scope
    }
}

public protocol HostAPIClient: Sendable {
    func fetchBeacon() async throws -> HostBeacon
    func fetchHealth() async throws -> HostHealth
    func beginPairing(pairingCode: String, deviceName: String, deviceID: String?) async throws -> HostPairingSession
    func fetchHostInfo() async throws -> HostIdentity

    func listInstances() async throws -> [TeamAppInstance]
    func switchInstance(id: String) async throws -> TeamAppInstance
    func launchInstance(request: LaunchInstanceRequest) async throws -> TeamAppInstance
    func closeInstance(id: String) async throws

    func fetchStatus(instanceID: String) async throws -> TeamAppStatus
    func sendPrompt(_ submission: PromptSubmission, instanceID: String) async throws -> PromptAck
    func sendFollowUp(_ submission: FollowUpSubmission, instanceID: String) async throws -> PromptAck
    func answerTrustPrompt(_ approved: Bool, instanceID: String) async throws
    func listKnownRestoreRefs() async throws -> [KnownRestoreRef]

    func restoreSession(id: String) async throws -> SessionRestoreResult
}

public struct URLSessionHostAPIClient: HostAPIClient {
    private enum Route {
        static let health = "/healthz"
        static let pairingSession = "/v1/pairing/session"
        static let host = "/v1/host"
        static let instances = "/v1/instances"
        static let restoreRefs = "/v1/restore-refs"

        static func instance(_ id: String) -> String {
            "/v1/instances/\(id)"
        }

        static func prompt(_ id: String) -> String {
            "/v1/instances/\(id)/prompt"
        }

        static func followUp(_ id: String) -> String {
            "/v1/instances/\(id)/follow-up"
        }

        static func trust(_ id: String) -> String {
            "/v1/instances/\(id)/trust"
        }
    }

    private struct PairingRequest: Encodable {
        let pairingCode: String
        let deviceName: String
        let deviceID: String?

        private enum CodingKeys: String, CodingKey {
            case pairingCode = "pairing_code"
            case deviceName = "device_name"
            case deviceID = "device_id"
        }
    }

    private struct InstancesResponse: Decodable {
        let instances: [HostInstanceWire]
    }

    private struct RestoreRefsResponse: Decodable {
        let restoreRefs: [KnownRestoreRef]

        private enum CodingKeys: String, CodingKey {
            case restoreRefs = "restore_refs"
        }
    }

    private struct LaunchRequestBody: Encodable {
        let title: String?
        let restoreRef: String?

        private enum CodingKeys: String, CodingKey {
            case title
            case restoreRef = "restore_ref"
        }
    }

    private struct TrustRequest: Encodable {
        let approved: Bool
    }

    private struct HostResultSummary: Decodable, Sendable {
        let shortText: String?

        private enum CodingKeys: String, CodingKey {
            case shortText = "short_text"
        }
    }

    private struct HostTaskState: Decodable, Sendable {
        let phase: String?
        let task: String?
    }

    private struct HostSnapshot: Decodable, Sendable {
        let phase: String?
        let resultSummary: HostResultSummary?
        let trustStatus: String?
        let pendingTrustProject: String?

        private enum CodingKeys: String, CodingKey {
            case phase
            case resultSummary = "result_summary"
            case trustStatus = "trust_status"
            case pendingTrustProject = "pending_trust_project"
        }
    }

    private struct HostInstanceWire: Decodable, Sendable {
        let id: String?
        let instanceID: String?
        let pid: Int?
        let phase: String?
        let sessionID: String?
        let startedAt: Int64?
        let currentTaskState: HostTaskState?
        let resultSummary: HostResultSummary?
        let summaryText: String?
        let status: String?
        let snapshot: HostSnapshot?
        let restoreRef: String?

        private enum CodingKeys: String, CodingKey {
            case id
            case instanceID = "instance_id"
            case pid
            case phase
            case sessionID = "session_id"
            case startedAt = "started_at"
            case currentTaskState = "current_task_state"
            case resultSummary = "result_summary"
            case summaryText = "summary_text"
            case status
            case snapshot
            case restoreRef = "restore_ref"
        }

        var stableInstanceID: String {
            instanceID ?? id ?? pid.map(String.init) ?? sessionID ?? "unknown-instance"
        }

        func asTeamAppInstance(now: Date = Date()) -> TeamAppInstance {
            let createdAt = startedAt.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000.0) } ?? now
            let preview = summaryText ?? snapshot?.resultSummary?.shortText ?? resultSummary?.shortText
            let title = currentTaskState?.task ?? preview ?? stableInstanceID
            let state = TeamAppInstanceState.fromRemoteValue(snapshot?.phase ?? currentTaskState?.phase ?? phase)
            return TeamAppInstance(
                id: stableInstanceID,
                title: title,
                state: state,
                createdAt: createdAt,
                updatedAt: now,
                activeSessionID: sessionID,
                lastResultPreview: preview,
                restoreRef: restoreRef
            )
        }

        func asStatus(now: Date = Date()) -> TeamAppStatus {
            TeamAppStatus(
                instanceID: stableInstanceID,
                state: TeamAppInstanceState.fromRemoteValue(snapshot?.phase ?? currentTaskState?.phase ?? phase),
                progressPercent: nil,
                healthMessage: status ?? snapshot?.phase ?? currentTaskState?.phase ?? phase,
                latestResult: summaryText ?? snapshot?.resultSummary?.shortText ?? resultSummary?.shortText,
                activeSessionID: sessionID,
                trustStatus: snapshot?.trustStatus,
                pendingTrustProject: snapshot?.pendingTrustProject,
                updatedAt: now
            )
        }
    }

    private let baseURL: URL
    private let accessToken: String?
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL, accessToken: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.session = session

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    public func fetchBeacon() async throws -> HostBeacon {
        _ = try await fetchHealth()
        return HostBeacon(
            hostID: synthesizedHostID(),
            displayName: synthesizedHostName(),
            baseURL: baseURL.absoluteString,
            apiVersion: "v1",
            capabilities: ["instances", "prompt", "follow-up", "restore", "trust", "updates"],
            lastSeenAt: Date(),
            connectionMode: .lanDirect,
            sessionToken: accessToken
        )
    }

    public func fetchHealth() async throws -> HostHealth {
        try await request(path: Route.health, method: "GET", body: Optional<String>.none, decodeAs: HostHealth.self)
    }

    public func beginPairing(pairingCode: String, deviceName: String, deviceID: String?) async throws -> HostPairingSession {
        try await request(
            path: Route.pairingSession,
            method: "POST",
            body: PairingRequest(
                pairingCode: pairingCode,
                deviceName: deviceName,
                deviceID: deviceID
            ),
            decodeAs: HostPairingSession.self
        )
    }

    public func fetchHostInfo() async throws -> HostIdentity {
        try await request(path: Route.host, method: "GET", body: Optional<String>.none, decodeAs: HostIdentity.self)
    }

    public func listInstances() async throws -> [TeamAppInstance] {
        let wrapped: InstancesResponse = try await request(
            path: Route.instances,
            method: "GET",
            body: Optional<String>.none,
            decodeAs: InstancesResponse.self
        )
        return wrapped.instances.map { $0.asTeamAppInstance() }
    }

    public func switchInstance(id: String) async throws -> TeamAppInstance {
        let detail: HostInstanceWire = try await request(
            path: Route.instance(id),
            method: "GET",
            body: Optional<String>.none,
            decodeAs: HostInstanceWire.self
        )
        return detail.asTeamAppInstance()
    }

    public func launchInstance(request launchRequest: LaunchInstanceRequest) async throws -> TeamAppInstance {
        let requestBody = LaunchRequestBody(
            title: launchRequest.title ?? launchRequest.initialPrompt,
            restoreRef: launchRequest.restoreRef
        )
        let created: HostInstanceWire = try await request(
            path: Route.instances,
            method: "POST",
            body: requestBody,
            decodeAs: HostInstanceWire.self
        )
        return created.asTeamAppInstance()
    }

    public func closeInstance(id: String) async throws {
        _ = try await request(path: Route.instance(id), method: "DELETE", body: Optional<String>.none, decodeAs: EmptyResponse.self)
    }

    public func fetchStatus(instanceID: String) async throws -> TeamAppStatus {
        let detail: HostInstanceWire = try await request(
            path: Route.instance(instanceID),
            method: "GET",
            body: Optional<String>.none,
            decodeAs: HostInstanceWire.self
        )
        return detail.asStatus()
    }

    public func sendPrompt(_ submission: PromptSubmission, instanceID: String) async throws -> PromptAck {
        _ = try await request(path: Route.prompt(instanceID), method: "POST", body: ["prompt": submission.text], decodeAs: EmptyResponse.self)
        return PromptAck(requestID: "lan-\(UUID().uuidString)", acceptedAt: Date())
    }

    public func sendFollowUp(_ submission: FollowUpSubmission, instanceID: String) async throws -> PromptAck {
        _ = try await request(path: Route.followUp(instanceID), method: "POST", body: ["message": submission.text], decodeAs: EmptyResponse.self)
        return PromptAck(requestID: "lan-\(UUID().uuidString)", acceptedAt: Date())
    }

    public func answerTrustPrompt(_ approved: Bool, instanceID: String) async throws {
        _ = try await request(
            path: Route.trust(instanceID),
            method: "POST",
            body: TrustRequest(approved: approved),
            decodeAs: EmptyResponse.self
        )
    }

    public func listKnownRestoreRefs() async throws -> [KnownRestoreRef] {
        let response: RestoreRefsResponse = try await request(
            path: Route.restoreRefs,
            method: "GET",
            body: Optional<String>.none,
            decodeAs: RestoreRefsResponse.self
        )
        return response.restoreRefs
    }

    public func restoreSession(id: String) async throws -> SessionRestoreResult {
        let knownRestoreRefs = try await listKnownRestoreRefs()
        let resolvedRestoreRef =
            knownRestoreRefs.first(where: { $0.restoreRef == id || $0.sessionID == id })?.restoreRef ?? id
        let instance = try await launchInstance(
            request: LaunchInstanceRequest(initialPrompt: nil, restoreRef: resolvedRestoreRef)
        )
        let status = try await fetchStatus(instanceID: instance.id)
        return SessionRestoreResult(sessionID: id, instance: instance, status: status)
    }

    private func request<Body: Encodable, Output: Decodable>(
        path: String,
        method: String,
        body: Body?,
        decodeAs: Output.Type
    ) async throws -> Output {
        let request = try buildRequest(path: path, method: method, body: body)

        let dataAndResponse: (Data, URLResponse)
        do {
            dataAndResponse = try await session.data(for: request)
        } catch {
            throw HostAPIError.transport(error)
        }

        guard let response = dataAndResponse.1 as? HTTPURLResponse else {
            throw HostAPIError.invalidResponse
        }

        guard (200...299).contains(response.statusCode) else {
            let message = String(data: dataAndResponse.0, encoding: .utf8) ?? "<no body>"
            throw HostAPIError.http(statusCode: response.statusCode, message: message)
        }

        if Output.self == EmptyResponse.self {
            return EmptyResponse() as! Output
        }

        do {
            return try decoder.decode(Output.self, from: dataAndResponse.0)
        } catch {
            throw HostAPIError.decoding(error)
        }
    }

    private func buildRequest<Body: Encodable>(path: String, method: String, body: Body?) throws -> URLRequest {
        guard let endpoint = URL(string: path, relativeTo: baseURL) else {
            throw HostAPIError.invalidBaseURL(baseURL.absoluteString)
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let accessToken, accessToken.isEmpty == false {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            do {
                request.httpBody = try encoder.encode(body)
            } catch {
                throw HostAPIError.encoding(error)
            }
        }

        return request
    }

    private func synthesizedHostID() -> String {
        if let host = baseURL.host {
            if let port = baseURL.port {
                return "\(host):\(port)"
            }
            return host
        }
        return baseURL.absoluteString
    }

    private func synthesizedHostName() -> String {
        baseURL.host ?? baseURL.absoluteString
    }
}

private struct EmptyResponse: Codable {}
