import Foundation

internal protocol InstanceEventStreaming: Sendable {
    typealias RequestProvider = @Sendable () async throws -> InstanceEventStreamRequest

    func start(
        requestProvider: @escaping RequestProvider,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async
    func stop() async
}

internal struct InstanceEventStreamRequest: Sendable, Equatable {
    let baseURL: URL
    let streamPath: String
    let accessToken: String?
}

internal actor URLSessionInstanceEventStreamClient: InstanceEventStreaming {
    private struct StreamConfig: Sendable {
        let requestProvider: RequestProvider
        let onEvent: @Sendable (TeamAppInstanceEvent) -> Void
        let onState: @Sendable (String) -> Void
    }

    private struct PendingEvent {
        var id: String?
        var name: String?
        var dataLines: [String] = []
    }

    private let session: URLSession
    private let reconnectDelayNanoseconds: UInt64
    private let decoder = JSONDecoder()

    private var activeConfig: StreamConfig?
    private var streamTask: Task<Void, Never>?
    private var closedByClient = false
    private var lastEventID: String?

    init(
        session: URLSession = .shared,
        reconnectDelayNanoseconds: UInt64 = 1_000_000_000
    ) {
        self.session = session
        self.reconnectDelayNanoseconds = reconnectDelayNanoseconds
    }

    func start(
        requestProvider: @escaping RequestProvider,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async {
        await stop()

        closedByClient = false
        lastEventID = nil
        activeConfig = StreamConfig(
            requestProvider: requestProvider,
            onEvent: onEvent,
            onState: onState
        )

        streamTask = Task { [weak self] in
            await self?.runLoop()
        }
    }

    func stop() async {
        closedByClient = true
        streamTask?.cancel()
        streamTask = nil
        activeConfig = nil
        lastEventID = nil
    }

    private func runLoop() async {
        while !Task.isCancelled {
            guard let config = activeConfig else {
                return
            }

            config.onState("connecting")

            do {
                try await consumeStream(config)
                if closedByClient || Task.isCancelled {
                    return
                }
                config.onState("closed")
            } catch is CancellationError {
                return
            } catch {
                if closedByClient || Task.isCancelled {
                    return
                }
                config.onState("disconnected:\(error.localizedDescription)")
            }

            do {
                try await Task.sleep(nanoseconds: reconnectDelayNanoseconds)
            } catch {
                return
            }
        }
    }

    private func consumeStream(_ config: StreamConfig) async throws {
        let streamRequest = try await config.requestProvider()
        let request = try buildRequest(streamRequest)
        let (bytes, response) = try await session.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw HostAPIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw HostAPIError.http(
                statusCode: httpResponse.statusCode,
                message: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            )
        }

        config.onState("connected")

        var pending = PendingEvent()
        for try await rawLine in bytes.lines {
            if Task.isCancelled || closedByClient {
                return
            }

            if rawLine.isEmpty {
                dispatchPendingEvent(pending, using: config)
                pending = PendingEvent()
                continue
            }

            if rawLine.hasPrefix(":") {
                continue
            }

            if rawLine.hasPrefix("id:") {
                pending.id = rawLine
                    .dropFirst(3)
                    .trimmingCharacters(in: .whitespaces)
                continue
            }

            if rawLine.hasPrefix("event:") {
                pending.name = rawLine
                    .dropFirst(6)
                    .trimmingCharacters(in: .whitespaces)
                continue
            }

            if rawLine.hasPrefix("data:") {
                pending.dataLines.append(
                    rawLine
                        .dropFirst(5)
                        .trimmingCharacters(in: .whitespaces)
                )
            }
        }

        dispatchPendingEvent(pending, using: config)
    }

    private func dispatchPendingEvent(_ pending: PendingEvent, using config: StreamConfig) {
        let joinedData = pending.dataLines.joined(separator: "\n")
        guard !joinedData.isEmpty else {
            return
        }

        if let id = pending.id, !id.isEmpty {
            lastEventID = id
        }

        let event = parseEvent(
            streamID: pending.id,
            eventName: pending.name,
            data: joinedData
        )
        config.onEvent(event)
    }

    private func parseEvent(streamID: String?, eventName: String?, data: String) -> TeamAppInstanceEvent {
        if eventName == "heartbeat" {
            return TeamAppInstanceEvent(
                streamID: streamID,
                type: "heartbeat",
                instanceID: nil,
                message: nil,
                outputChunk: nil,
                health: nil,
                updatedAt: nil
            )
        }

        if let payload = data.data(using: .utf8),
           let decoded = try? decoder.decode(StreamEventPayload.self, from: payload) {
            return TeamAppInstanceEvent(
                streamID: streamID,
                type: decoded.type ?? eventName ?? "message",
                instanceID: decoded.instanceID,
                message: decoded.message,
                outputChunk: decoded.outputChunk,
                health: decoded.health,
                updatedAt: decoded.updatedAt
            )
        }

        return TeamAppInstanceEvent(
            streamID: streamID,
            type: eventName ?? "message",
            instanceID: nil,
            message: data,
            outputChunk: nil,
            health: nil,
            updatedAt: nil
        )
    }

    private func buildRequest(_ streamRequest: InstanceEventStreamRequest) throws -> URLRequest {
        guard let endpoint = URL(string: streamRequest.streamPath, relativeTo: streamRequest.baseURL) else {
            throw HostAPIError.invalidBaseURL(streamRequest.baseURL.absoluteString)
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        if let accessToken = streamRequest.accessToken, accessToken.isEmpty == false {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        if let lastEventID, lastEventID.isEmpty == false {
            request.setValue(lastEventID, forHTTPHeaderField: "Last-Event-ID")
        }

        return request
    }
}

private struct StreamEventPayload: Decodable {
    let type: String?
    let instanceID: String?
    let message: String?
    let outputChunk: String?
    let health: String?
    let updatedAt: String?

    private enum CodingKeys: String, CodingKey {
        case type
        case instanceID = "instance_id"
        case message
        case outputChunk = "output_chunk"
        case health
        case updatedAt = "updated_at"
    }
}
