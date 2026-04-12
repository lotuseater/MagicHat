import Foundation

internal struct RemotePairClaim: Decodable, Sendable {
    let claimID: String
    let status: String
    let hostID: String
    let hostName: String

    private enum CodingKeys: String, CodingKey {
        case claimID = "claim_id"
        case status
        case hostID = "host_id"
        case hostName = "host_name"
    }
}

internal struct RemoteClaimStatus: Decodable, Sendable {
    let claimID: String
    let status: String
    let challenge: String?
    let hostID: String?
    let hostName: String?

    private enum CodingKeys: String, CodingKey {
        case claimID = "claim_id"
        case status
        case challenge
        case hostID = "host_id"
        case hostName = "host_name"
    }
}

internal struct RemoteDeviceRegistration: Decodable, Sendable {
    let hostID: String
    let hostName: String
    let deviceID: String
    let accessToken: String
    let accessTokenExpiresAt: Date
    let refreshToken: String
    let refreshTokenExpiresAt: Date
    let certificatePinsetVersion: String?

    private enum CodingKeys: String, CodingKey {
        case hostID = "host_id"
        case hostName = "host_name"
        case deviceID = "device_id"
        case accessToken = "access_token"
        case accessTokenExpiresAt = "access_token_expires_at"
        case refreshToken = "refresh_token"
        case refreshTokenExpiresAt = "refresh_token_expires_at"
        case certificatePinsetVersion = "certificate_pinset_version"
    }
}

internal struct RemoteSessionRefresh: Decodable, Sendable {
    let accessToken: String
    let accessTokenExpiresAt: Date
    let refreshToken: String
    let refreshTokenExpiresAt: Date

    private enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case accessTokenExpiresAt = "access_token_expires_at"
        case refreshToken = "refresh_token"
        case refreshTokenExpiresAt = "refresh_token_expires_at"
    }
}

internal struct RemoteHostStatus: Decodable, Sendable {
    let hostID: String
    let hostName: String
    let status: String
    let lastSeenAt: Date?

    private enum CodingKeys: String, CodingKey {
        case hostID = "host_id"
        case hostName = "host_name"
        case status
        case lastSeenAt = "last_seen_at"
    }
}

internal struct RemoteResultSummary: Decodable, Sendable {
    let shortText: String?

    private enum CodingKeys: String, CodingKey {
        case shortText = "short_text"
    }
}

internal struct RemoteSnapshot: Decodable, Sendable {
    let phase: String?
    let resultSummary: RemoteResultSummary?
    let trustStatus: String?
    let pendingTrustProject: String?

    init(
        phase: String?,
        resultSummary: RemoteResultSummary?,
        trustStatus: String? = nil,
        pendingTrustProject: String? = nil
    ) {
        self.phase = phase
        self.resultSummary = resultSummary
        self.trustStatus = trustStatus
        self.pendingTrustProject = pendingTrustProject
    }

    private enum CodingKeys: String, CodingKey {
        case phase
        case resultSummary = "result_summary"
        case trustStatus = "trust_status"
        case pendingTrustProject = "pending_trust_project"
    }
}

internal struct RemoteInstanceWire: Decodable, Sendable {
    let id: String?
    let instanceID: String?
    let title: String?
    let active: Bool?
    let health: String?
    let phase: String?
    let sessionID: String?
    let startedAt: Int64?
    let resultSummary: RemoteResultSummary?
    let restoreRef: String?
    let status: String?
    let snapshot: RemoteSnapshot?
    let summaryText: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case instanceID = "instance_id"
        case title
        case active
        case health
        case phase
        case sessionID = "session_id"
        case startedAt = "started_at"
        case resultSummary = "result_summary"
        case restoreRef = "restore_ref"
        case status
        case snapshot
        case summaryText = "summary_text"
    }

    var stableInstanceID: String {
        instanceID ?? id ?? sessionID ?? "unknown-instance"
    }

    func asTeamAppInstance(now: Date = Date()) -> TeamAppInstance {
        let createdAt = startedAt.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000.0) } ?? now
        let preview = summaryText ?? snapshot?.resultSummary?.shortText ?? resultSummary?.shortText
        return TeamAppInstance(
            id: stableInstanceID,
            title: title ?? preview ?? stableInstanceID,
            state: TeamAppInstanceState.fromRemoteValue(health ?? phase ?? snapshot?.phase),
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
            state: TeamAppInstanceState.fromRemoteValue(health ?? phase ?? snapshot?.phase),
            progressPercent: nil,
            healthMessage: status ?? health ?? phase ?? snapshot?.phase,
            latestResult: summaryText ?? snapshot?.resultSummary?.shortText ?? resultSummary?.shortText,
            activeSessionID: sessionID,
            trustStatus: snapshot?.trustStatus,
            pendingTrustProject: snapshot?.pendingTrustProject,
            updatedAt: now
        )
    }
}

internal protocol RelayAPIClient: Sendable {
    func claimBootstrap(bootstrapToken: String, deviceName: String, devicePublicKey: String, platform: String) async throws -> RemotePairClaim
    func fetchClaimStatus(claimID: String) async throws -> RemoteClaimStatus
    func completeRegistration(claimID: String, challenge: String, signature: String) async throws -> RemoteDeviceRegistration
    func refreshSession(refreshToken: String) async throws -> RemoteSessionRefresh
    func listHosts() async throws -> [RemoteHostStatus]
    func listInstances(hostID: String) async throws -> [RemoteInstanceWire]
    func getInstanceDetail(hostID: String, instanceID: String) async throws -> RemoteInstanceWire
    func launchInstance(hostID: String, title: String?, restoreRef: String?) async throws -> RemoteInstanceWire
    func closeInstance(hostID: String, instanceID: String) async throws
    func sendPrompt(hostID: String, instanceID: String, prompt: String) async throws
    func sendFollowUp(hostID: String, instanceID: String, message: String) async throws
    func answerTrustPrompt(hostID: String, instanceID: String, approved: Bool) async throws
    func listKnownRestoreRefs(hostID: String) async throws -> [KnownRestoreRef]
}

internal struct URLSessionRelayAPIClient: RelayAPIClient {
    private struct EmptyResponse: Decodable {}
    private struct HostsResponse: Decodable { let hosts: [RemoteHostStatus] }
    private struct InstancesResponse: Decodable { let instances: [RemoteInstanceWire] }
    private struct RestoreRefsResponse: Decodable {
        let restoreRefs: [KnownRestoreRef]

        private enum CodingKeys: String, CodingKey {
            case restoreRefs = "restore_refs"
        }
    }

    private struct BootstrapClaimRequest: Encodable {
        let bootstrapToken: String
        let deviceName: String
        let platform: String
        let devicePublicKey: String

        private enum CodingKeys: String, CodingKey {
            case bootstrapToken = "bootstrap_token"
            case deviceName = "device_name"
            case platform
            case devicePublicKey = "device_public_key"
        }
    }

    private struct DeviceRegisterRequest: Encodable {
        let claimID: String
        let challenge: String
        let signature: String

        private enum CodingKeys: String, CodingKey {
            case claimID = "claim_id"
            case challenge
            case signature
        }
    }

    private struct RefreshRequest: Encodable {
        let refreshToken: String

        private enum CodingKeys: String, CodingKey {
            case refreshToken = "refresh_token"
        }
    }

    private struct PromptRequest: Encodable { let prompt: String }
    private struct FollowUpRequest: Encodable { let message: String }
    private struct TrustRequest: Encodable { let approved: Bool }
    private struct LaunchRequest: Encodable {
        let title: String?
        let restoreRef: String?

        private enum CodingKeys: String, CodingKey {
            case title
            case restoreRef = "restore_ref"
        }
    }

    private let baseURL: URL
    private let accessToken: String?
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL, accessToken: String?, certificatePinsetVersion: String?) throws {
        self.baseURL = try RelayTrustPolicy.validateRelayURL(baseURL)
        self.accessToken = accessToken
        _ = try RelayTrustPolicy.pins(for: certificatePinsetVersion)

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        self.session = URLSession(configuration: configuration)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    func claimBootstrap(bootstrapToken: String, deviceName: String, devicePublicKey: String, platform: String) async throws -> RemotePairClaim {
        try await request(
            path: "/v2/mobile/pair/bootstrap/claim",
            method: "POST",
            body: BootstrapClaimRequest(
                bootstrapToken: bootstrapToken,
                deviceName: deviceName,
                platform: platform,
                devicePublicKey: devicePublicKey
            ),
            decodeAs: RemotePairClaim.self,
            includeAuthorization: false
        )
    }

    func fetchClaimStatus(claimID: String) async throws -> RemoteClaimStatus {
        try await request(
            path: "/v2/mobile/pair/bootstrap/claims/\(claimID)",
            method: "GET",
            body: Optional<String>.none,
            decodeAs: RemoteClaimStatus.self,
            includeAuthorization: false
        )
    }

    func completeRegistration(claimID: String, challenge: String, signature: String) async throws -> RemoteDeviceRegistration {
        try await request(
            path: "/v2/mobile/pair/device/register",
            method: "POST",
            body: DeviceRegisterRequest(claimID: claimID, challenge: challenge, signature: signature),
            decodeAs: RemoteDeviceRegistration.self,
            includeAuthorization: false
        )
    }

    func refreshSession(refreshToken: String) async throws -> RemoteSessionRefresh {
        try await request(
            path: "/v2/mobile/session/refresh",
            method: "POST",
            body: RefreshRequest(refreshToken: refreshToken),
            decodeAs: RemoteSessionRefresh.self,
            includeAuthorization: false
        )
    }

    func listHosts() async throws -> [RemoteHostStatus] {
        let response: HostsResponse = try await request(path: "/v2/mobile/hosts", method: "GET", body: Optional<String>.none, decodeAs: HostsResponse.self)
        return response.hosts
    }

    func listInstances(hostID: String) async throws -> [RemoteInstanceWire] {
        let response: InstancesResponse = try await request(path: "/v2/mobile/hosts/\(hostID)/instances", method: "GET", body: Optional<String>.none, decodeAs: InstancesResponse.self)
        return response.instances
    }

    func getInstanceDetail(hostID: String, instanceID: String) async throws -> RemoteInstanceWire {
        try await request(
            path: "/v2/mobile/hosts/\(hostID)/instances/\(instanceID)",
            method: "GET",
            body: Optional<String>.none,
            decodeAs: RemoteInstanceWire.self
        )
    }

    func launchInstance(hostID: String, title: String?, restoreRef: String?) async throws -> RemoteInstanceWire {
        try await request(
            path: "/v2/mobile/hosts/\(hostID)/instances",
            method: "POST",
            body: LaunchRequest(title: title, restoreRef: restoreRef),
            decodeAs: RemoteInstanceWire.self
        )
    }

    func closeInstance(hostID: String, instanceID: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/v2/mobile/hosts/\(hostID)/instances/\(instanceID)",
            method: "DELETE",
            body: Optional<String>.none,
            decodeAs: EmptyResponse.self
        )
    }

    func sendPrompt(hostID: String, instanceID: String, prompt: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/v2/mobile/hosts/\(hostID)/instances/\(instanceID)/prompt",
            method: "POST",
            body: PromptRequest(prompt: prompt),
            decodeAs: EmptyResponse.self
        )
    }

    func sendFollowUp(hostID: String, instanceID: String, message: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/v2/mobile/hosts/\(hostID)/instances/\(instanceID)/follow-up",
            method: "POST",
            body: FollowUpRequest(message: message),
            decodeAs: EmptyResponse.self
        )
    }

    func answerTrustPrompt(hostID: String, instanceID: String, approved: Bool) async throws {
        let _: EmptyResponse = try await request(
            path: "/v2/mobile/hosts/\(hostID)/instances/\(instanceID)/trust",
            method: "POST",
            body: TrustRequest(approved: approved),
            decodeAs: EmptyResponse.self
        )
    }

    func listKnownRestoreRefs(hostID: String) async throws -> [KnownRestoreRef] {
        let response: RestoreRefsResponse = try await request(
            path: "/v2/mobile/hosts/\(hostID)/restore-refs",
            method: "GET",
            body: Optional<String>.none,
            decodeAs: RestoreRefsResponse.self
        )
        return response.restoreRefs
    }

    private func request<Body: Encodable, Output: Decodable>(
        path: String,
        method: String,
        body: Body?,
        decodeAs: Output.Type,
        includeAuthorization: Bool = true
    ) async throws -> Output {
        let request = try buildRequest(path: path, method: method, body: body, includeAuthorization: includeAuthorization)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw HostAPIError.transport(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw HostAPIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "<no body>"
            throw HostAPIError.http(statusCode: httpResponse.statusCode, message: message)
        }

        if Output.self == EmptyResponse.self {
            return EmptyResponse() as! Output
        }

        do {
            return try decoder.decode(Output.self, from: data)
        } catch {
            throw HostAPIError.decoding(error)
        }
    }

    private func buildRequest<Body: Encodable>(path: String, method: String, body: Body?, includeAuthorization: Bool) throws -> URLRequest {
        guard let endpoint = URL(string: path, relativeTo: baseURL) else {
            throw HostAPIError.invalidBaseURL(baseURL.absoluteString)
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if includeAuthorization, let accessToken, accessToken.isEmpty == false {
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
}
