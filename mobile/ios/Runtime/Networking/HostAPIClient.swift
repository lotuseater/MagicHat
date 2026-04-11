import Foundation

public enum HostAPIError: Error, LocalizedError {
    case invalidBaseURL(String)
    case noPairedHost
    case beaconDiscoveryFailed
    case transport(Error)
    case invalidResponse
    case http(statusCode: Int, message: String)
    case decoding(Error)
    case encoding(Error)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let raw):
            return "Invalid base URL: \(raw)"
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
        }
    }
}

public protocol HostAPIClient: Sendable {
    func fetchBeacon() async throws -> HostBeacon
    func fetchHealth() async throws -> HostHealth

    func listInstances() async throws -> [TeamAppInstance]
    func switchInstance(id: String) async throws -> TeamAppInstance
    func launchInstance(request: LaunchInstanceRequest) async throws -> TeamAppInstance
    func closeInstance(id: String) async throws

    func fetchStatus(instanceID: String) async throws -> TeamAppStatus
    func sendPrompt(_ submission: PromptSubmission, instanceID: String) async throws -> PromptAck
    func sendFollowUp(_ submission: FollowUpSubmission, instanceID: String) async throws -> PromptAck

    func restoreSession(id: String) async throws -> SessionRestoreResult
}

public struct URLSessionHostAPIClient: HostAPIClient {
    private enum Route {
        static let beacon = "/api/v1/beacon"
        static let health = "/api/v1/health"
        static let instances = "/api/v1/instances"

        static func instance(_ id: String) -> String {
            "/api/v1/instances/\(id)"
        }

        static func switchInstance(_ id: String) -> String {
            "/api/v1/instances/\(id)/switch"
        }

        static func status(_ id: String) -> String {
            "/api/v1/instances/\(id)/status"
        }

        static func prompt(_ id: String) -> String {
            "/api/v1/instances/\(id)/prompt"
        }

        static func followUp(_ id: String) -> String {
            "/api/v1/instances/\(id)/follow-up"
        }

        static func restoreSession(_ sessionID: String) -> String {
            "/api/v1/sessions/\(sessionID)/restore"
        }
    }

    private struct InstancesResponse: Decodable {
        let instances: [TeamAppInstance]
    }

    private struct InstanceResponse: Decodable {
        let instance: TeamAppInstance
    }

    private struct StatusResponse: Decodable {
        let status: TeamAppStatus
    }

    private struct AckResponse: Decodable {
        let ack: PromptAck
    }

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    public func fetchBeacon() async throws -> HostBeacon {
        try await request(path: Route.beacon, method: "GET", body: Optional<String>.none, decodeAs: HostBeacon.self)
    }

    public func fetchHealth() async throws -> HostHealth {
        try await request(path: Route.health, method: "GET", body: Optional<String>.none, decodeAs: HostHealth.self)
    }

    public func listInstances() async throws -> [TeamAppInstance] {
        do {
            let wrapped: InstancesResponse = try await request(path: Route.instances, method: "GET", body: Optional<String>.none, decodeAs: InstancesResponse.self)
            return wrapped.instances
        } catch {
            return try await request(path: Route.instances, method: "GET", body: Optional<String>.none, decodeAs: [TeamAppInstance].self)
        }
    }

    public func switchInstance(id: String) async throws -> TeamAppInstance {
        do {
            let wrapped: InstanceResponse = try await request(path: Route.switchInstance(id), method: "POST", body: Optional<String>.none, decodeAs: InstanceResponse.self)
            return wrapped.instance
        } catch {
            return try await request(path: Route.switchInstance(id), method: "POST", body: Optional<String>.none, decodeAs: TeamAppInstance.self)
        }
    }

    public func launchInstance(request launchRequest: LaunchInstanceRequest) async throws -> TeamAppInstance {
        do {
            let wrapped: InstanceResponse = try await request(path: Route.instances, method: "POST", body: launchRequest, decodeAs: InstanceResponse.self)
            return wrapped.instance
        } catch {
            return try await request(path: Route.instances, method: "POST", body: launchRequest, decodeAs: TeamAppInstance.self)
        }
    }

    public func closeInstance(id: String) async throws {
        _ = try await request(path: Route.instance(id), method: "DELETE", body: Optional<String>.none, decodeAs: EmptyResponse.self)
    }

    public func fetchStatus(instanceID: String) async throws -> TeamAppStatus {
        do {
            let wrapped: StatusResponse = try await request(path: Route.status(instanceID), method: "GET", body: Optional<String>.none, decodeAs: StatusResponse.self)
            return wrapped.status
        } catch {
            return try await request(path: Route.status(instanceID), method: "GET", body: Optional<String>.none, decodeAs: TeamAppStatus.self)
        }
    }

    public func sendPrompt(_ submission: PromptSubmission, instanceID: String) async throws -> PromptAck {
        do {
            let wrapped: AckResponse = try await request(path: Route.prompt(instanceID), method: "POST", body: submission, decodeAs: AckResponse.self)
            return wrapped.ack
        } catch {
            return try await request(path: Route.prompt(instanceID), method: "POST", body: submission, decodeAs: PromptAck.self)
        }
    }

    public func sendFollowUp(_ submission: FollowUpSubmission, instanceID: String) async throws -> PromptAck {
        do {
            let wrapped: AckResponse = try await request(path: Route.followUp(instanceID), method: "POST", body: submission, decodeAs: AckResponse.self)
            return wrapped.ack
        } catch {
            return try await request(path: Route.followUp(instanceID), method: "POST", body: submission, decodeAs: PromptAck.self)
        }
    }

    public func restoreSession(id: String) async throws -> SessionRestoreResult {
        try await request(path: Route.restoreSession(id), method: "POST", body: Optional<String>.none, decodeAs: SessionRestoreResult.self)
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

private struct EmptyResponse: Codable {}
