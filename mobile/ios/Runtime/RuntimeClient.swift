import Foundation

private final class RuntimeTLSDelegate: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

private extension URLSessionWebSocketTask {
    func receiveMessage() async throws -> URLSessionWebSocketTask.Message {
        try await withCheckedThrowingContinuation { continuation in
            receive { result in
                continuation.resume(with: result)
            }
        }
    }

    func sendMessage(_ message: URLSessionWebSocketTask.Message) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            send(message) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}

public actor RuntimeClient {
    private struct PendingWaiter {
        let token: UUID
        let expectedTypes: Set<String>
        let operation: String
        let continuation: CheckedContinuation<[String: Any], Error>
        let timeoutTask: Task<Void, Never>
    }

    private static let stateStoreKey = "magichat.runtime.state.v1"
    private static let fallbackHostID = "local-dev-host"

    private let defaults: UserDefaults

    private var stateStore: RuntimeStateStore

    private var webSocketSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?
    private var tlsDelegate: RuntimeTLSDelegate?
    private var receiveTask: Task<Void, Never>?
    private var connectedHostID: String?

    private var backlog: [[String: Any]] = []
    private var pendingWaiter: PendingWaiter?

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.stateStore = Self.readStateStore(defaults: defaults)
    }

    deinit {
        receiveTask?.cancel()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketSession?.invalidateAndCancel()
        pendingWaiter?.timeoutTask.cancel()
    }

    public func discoverHosts() async throws -> [RuntimeBeaconHost] {
        mergeLocalDiscoveryHints()
        persistStateStore()

        return stateStore.hosts
            .map { host in
                RuntimeBeaconHost(
                    id: host.id,
                    displayName: host.displayName,
                    address: "\(host.address):\(host.port)",
                    lastSeenAt: host.lastSeenAt
                )
            }
            .sorted { lhs, rhs in
                if lhs.lastSeenAt == rhs.lastSeenAt {
                    return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
                }
                return lhs.lastSeenAt > rhs.lastSeenAt
            }
    }

    public func pair(hostID: String, pin: String?) async throws -> RuntimePairedHost {
        guard var host = hostRecord(for: hostID) else {
            throw RuntimeClientError.unknownHost(hostID)
        }

        let now = Date()
        host.pairedAt = now
        host.lastSeenAt = now
        if let pin, pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            host.pairingKey = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        upsertHost(host)
        stateStore.activeHostID = host.id
        persistStateStore()

        _ = try await ensureConnected(to: host.id, operation: "pair")

        return RuntimePairedHost(hostID: host.id, displayName: host.displayName, pairedAt: now)
    }

    public func listInstances(hostID: String) async throws -> [RuntimeTeamAppInstance] {
        let host = try await ensureConnected(to: hostID, operation: "list_instances")

        let response = try await request(
            payload: ["type": "request_instance_list"],
            expecting: ["instance_list"],
            operation: "request_instance_list"
        )

        let activeInstanceID = host.activeInstanceID
        let instances = decodeInstanceList(response, activeInstanceID: activeInstanceID)

        var updatedHost = host
        updatedHost.lastSeenAt = Date()
        upsertHost(updatedHost)
        persistStateStore()

        return instances
    }

    public func switchToInstance(hostID: String, instanceID: String) async throws {
        guard var host = hostRecord(for: hostID) else {
            throw RuntimeClientError.unknownHost(hostID)
        }

        host.activeInstanceID = instanceID
        host.lastSeenAt = Date()
        upsertHost(host)
        stateStore.activeHostID = host.id
        persistStateStore()
    }

    public func launchInstance(hostID: String) async throws -> RuntimeTeamAppInstance {
        var host = try await ensureConnected(to: hostID, operation: "launch_instance")
        let projectPath = try await resolveLaunchProjectPath(for: host)

        let response = try await request(
            payload: [
                "type": "create_instance",
                "project_path": projectPath,
                "initial_instruction": ""
            ],
            expecting: ["instance_created"],
            operation: "create_instance",
            timeout: 15
        )
        let created = mapInstance(response, activeInstanceID: nil)

        host.preferredProjectPath = projectPath
        host.activeInstanceID = created.id
        host.lastSeenAt = Date()
        upsertHost(host)
        stateStore.activeHostID = host.id
        persistStateStore()

        return created
    }

    public func closeInstance(hostID: String, instanceID: String) async throws {
        guard var host = try await ensureConnected(to: hostID, operation: "close_instance") as StoredHostRecord? else {
            throw RuntimeClientError.unknownHost(hostID)
        }

        _ = try await request(
            payload: ["type": "stop_instance", "instance_id": instanceID],
            expecting: ["instance_stopped"],
            operation: "stop_instance"
        )

        if host.activeInstanceID == instanceID {
            host.activeInstanceID = nil
        }
        host.lastSeenAt = Date()
        upsertHost(host)
        persistStateStore()
    }

    public func fetchStatus(hostID: String, instanceID: String) async throws -> RuntimeStatusSnapshot {
        let host = try await ensureConnected(to: hostID, operation: "fetch_status")

        let instances = try await listInstances(hostID: host.id)
        guard let instance = instances.first(where: { $0.id == instanceID }) else {
            throw RuntimeClientError.sessionNotFound(instanceID)
        }

        var latestResult = instance.resultPreview

        if let sessionHistory = try? await request(
            payload: ["type": "get_session_history", "instance_id": instanceID, "max_lines": 40],
            expecting: ["session_history"],
            operation: "get_session_history",
            timeout: 6
        ),
           let messages = sessionHistory["messages"] as? [[String: Any]] {
            for message in messages.reversed() {
                if let text = message["text"] as? String,
                   text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                    latestResult = text
                    break
                }
            }
        }

        let completedSteps = instance.health == .finished ? 1 : 0
        let progress = RuntimeProgressSnapshot(
            stepLabel: instance.resultPreview.isEmpty ? instance.title : instance.resultPreview,
            completedSteps: completedSteps,
            totalSteps: 1,
            updatedAt: Date()
        )

        return RuntimeStatusSnapshot(health: instance.health, progress: progress, latestResult: latestResult)
    }

    public func sendPrompt(hostID: String, instanceID: String, prompt: String) async throws -> RuntimeSubmissionReceipt {
        try await sendInstruction(hostID: hostID, instanceID: instanceID, text: prompt, operation: "send_prompt")
    }

    public func sendFollowUp(hostID: String, instanceID: String, followUp: String) async throws -> RuntimeSubmissionReceipt {
        try await sendInstruction(hostID: hostID, instanceID: instanceID, text: followUp, operation: "send_follow_up")
    }

    public func restoreSession(hostID: String, sessionID: String) async throws -> RuntimeTeamAppInstance {
        let host = try await ensureConnected(to: hostID, operation: "restore_session")

        _ = try await request(
            payload: ["type": "discover_instances"],
            expecting: ["instance_list"],
            operation: "discover_instances",
            timeout: 12
        )

        let instances = try await listInstances(hostID: host.id)
        if let exactMatch = instances.first(where: { $0.id == sessionID }) {
            try await switchToInstance(hostID: host.id, instanceID: exactMatch.id)
            return exactMatch
        }

        if let titleMatch = instances.first(where: { $0.title == sessionID }) {
            try await switchToInstance(hostID: host.id, instanceID: titleMatch.id)
            return titleMatch
        }

        throw RuntimeClientError.sessionNotFound(sessionID)
    }

    public func registerPairingURI(_ uri: String) async throws -> RuntimeBeaconHost {
        let parsed = try PairingURIComponents.parse(uri)
        let hostID = "\(parsed.host):\(parsed.port)"
        let now = Date()

        var record = hostRecord(for: hostID) ?? StoredHostRecord(
            id: hostID,
            displayName: parsed.displayName ?? parsed.host,
            address: parsed.host,
            port: parsed.port,
            useTLS: parsed.useTLS,
            pairingKey: parsed.pairingKey,
            lastSeenAt: now,
            pairedAt: nil,
            preferredProjectPath: parsed.preferredProjectPath,
            activeInstanceID: nil
        )

        record.displayName = parsed.displayName ?? record.displayName
        record.useTLS = parsed.useTLS
        record.lastSeenAt = now
        if let key = parsed.pairingKey, key.isEmpty == false {
            record.pairingKey = key
        }
        if let preferredProjectPath = parsed.preferredProjectPath,
           preferredProjectPath.isEmpty == false {
            record.preferredProjectPath = preferredProjectPath
        }

        upsertHost(record)
        persistStateStore()

        return RuntimeBeaconHost(
            id: record.id,
            displayName: record.displayName,
            address: "\(record.address):\(record.port)",
            lastSeenAt: record.lastSeenAt
        )
    }

    public func restoreLaunchSnapshot() async -> RuntimeLaunchRestoreSnapshot? {
        guard let activeHostID = stateStore.activeHostID,
              let host = hostRecord(for: activeHostID),
              let sessionID = host.activeInstanceID,
              sessionID.isEmpty == false
        else {
            return nil
        }

        return RuntimeLaunchRestoreSnapshot(hostID: activeHostID, sessionID: sessionID)
    }

    private func sendInstruction(hostID: String,
                                 instanceID: String,
                                 text: String,
                                 operation: String) async throws -> RuntimeSubmissionReceipt {
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            throw RuntimeClientError.missingRequiredField("instruction")
        }

        var host = try await ensureConnected(to: hostID, operation: operation)

        let response = try await request(
            payload: [
                "type": "send_instruction",
                "instance_id": instanceID,
                "instruction": text
            ],
            expecting: ["instance_update"],
            operation: "send_instruction"
        )

        host.activeInstanceID = instanceID
        host.lastSeenAt = Date()
        upsertHost(host)
        stateStore.activeHostID = host.id
        persistStateStore()

        let sequenceValue = (response["sequence"] as? NSNumber)?.intValue
        let fallbackSequence = Int(Date().timeIntervalSince1970 * 1000)
        let requestID = "\(operation)-\(instanceID)-\(sequenceValue ?? fallbackSequence)"
        return RuntimeSubmissionReceipt(requestID: requestID, acceptedAt: Date())
    }

    private func ensureConnected(to hostID: String, operation: String) async throws -> StoredHostRecord {
        guard let host = hostRecord(for: hostID) else {
            throw RuntimeClientError.unknownHost(hostID)
        }

        if connectedHostID == hostID,
           webSocketTask != nil {
            return host
        }

        var lastError: Error = RuntimeClientError.transportUnavailable
        for attempt in 0..<3 {
            do {
                try await connect(to: host)
                return host
            } catch {
                lastError = error
                if attempt < 2 {
                    let backoffNs = UInt64((attempt + 1) * 500_000_000)
                    try await Task.sleep(nanoseconds: backoffNs)
                }
            }
        }

        throw RuntimeClientError.server(code: nil, message: "\(operation) failed: \(lastError.localizedDescription)")
    }

    private func connect(to host: StoredHostRecord) async throws {
        disconnectTransport(clearHostBinding: false)

        let request = URLRequest(url: host.socketURL)

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true

        if host.useTLS {
            let tlsDelegate = RuntimeTLSDelegate()
            self.tlsDelegate = tlsDelegate
            webSocketSession = URLSession(configuration: configuration, delegate: tlsDelegate, delegateQueue: nil)
        } else {
            tlsDelegate = nil
            webSocketSession = URLSession(configuration: configuration)
        }

        guard let webSocketSession else {
            throw RuntimeClientError.transportUnavailable
        }

        var authRequest = request
        if let pairingKey = host.pairingKey, pairingKey.isEmpty == false {
            authRequest.addValue(pairingKey, forHTTPHeaderField: "X-MHP-Auth")
        }

        let task = webSocketSession.webSocketTask(with: authRequest)
        webSocketTask = task
        task.resume()

        startReceiveLoop()

        let initialStatus = try await waitForMessage(
            expecting: ["auth_status"],
            operation: "auth_status",
            timeout: 8
        )

        let initiallyAuthenticated = (initialStatus["authenticated"] as? NSNumber)?.boolValue ?? false
        if initiallyAuthenticated == false {
            if let pairingKey = host.pairingKey, pairingKey.isEmpty == false {
                try await sendJSON(["type": "auth", "psk": pairingKey])
                let authResult = try await waitForMessage(
                    expecting: ["auth_status"],
                    operation: "auth",
                    timeout: 8
                )

                let authenticated = (authResult["authenticated"] as? NSNumber)?.boolValue ?? false
                if authenticated == false {
                    throw RuntimeClientError.unauthenticated
                }
            } else {
                throw RuntimeClientError.unauthenticated
            }
        }

        connectedHostID = host.id
    }

    private func startReceiveLoop() {
        receiveTask?.cancel()

        receiveTask = Task { [weak self] in
            guard let self else { return }
            while Task.isCancelled == false {
                do {
                    guard let message = try await self.receiveOneMessage() else {
                        await self.transportDidClose(with: RuntimeClientError.transportUnavailable)
                        return
                    }
                    await self.handleMessage(message)
                } catch {
                    await self.transportDidClose(with: error)
                    return
                }
            }
        }
    }

    private func receiveOneMessage() async throws -> URLSessionWebSocketTask.Message? {
        guard let task = webSocketTask else {
            return nil
        }
        return try await task.receiveMessage()
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        let payload: [String: Any]

        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                return
            }
            payload = object
        case .data(let data):
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return
            }
            payload = object
        @unknown default:
            return
        }

        backlog.append(payload)
        if backlog.count > 200 {
            backlog.removeFirst(backlog.count - 200)
        }

        resolvePendingWaiterIfPossible()
    }

    private func transportDidClose(with error: Error) {
        if let pendingWaiter {
            pendingWaiter.timeoutTask.cancel()
            pendingWaiter.continuation.resume(throwing: RuntimeClientError.server(code: nil, message: error.localizedDescription))
            self.pendingWaiter = nil
        }
        disconnectTransport(clearHostBinding: true)
    }

    private func request(payload: [String: Any],
                         expecting: Set<String>,
                         operation: String,
                         timeout: TimeInterval = 8) async throws -> [String: Any] {
        try await sendJSON(payload)
        return try await waitForMessage(expecting: expecting, operation: operation, timeout: timeout)
    }

    private func sendJSON(_ payload: [String: Any]) async throws {
        guard let webSocketTask else {
            throw RuntimeClientError.transportUnavailable
        }
        let data = try JSONSerialization.data(withJSONObject: payload, options: [])
        guard let text = String(data: data, encoding: .utf8) else {
            throw RuntimeClientError.malformedServerMessage
        }

        try await webSocketTask.sendMessage(.string(text))
    }

    private func waitForMessage(expecting expectedTypes: Set<String>,
                                operation: String,
                                timeout: TimeInterval) async throws -> [String: Any] {
        if let backlogIndex = backlog.firstIndex(where: { payload in
            guard let type = payload["type"] as? String else {
                return false
            }
            return expectedTypes.contains(type) || type == "error"
        }) {
            let payload = backlog.remove(at: backlogIndex)
            try throwServerErrorIfNeeded(payload)
            return payload
        }

        if pendingWaiter != nil {
            throw RuntimeClientError.requestInFlight
        }

        return try await withCheckedThrowingContinuation { continuation in
            let token = UUID()
            let timeoutTask = Task { [weak self] in
                guard let self else { return }
                let timeoutNs = UInt64(timeout * 1_000_000_000)
                try? await Task.sleep(nanoseconds: timeoutNs)
                await self.timeoutPendingWaiter(token: token, operation: operation)
            }

            pendingWaiter = PendingWaiter(
                token: token,
                expectedTypes: expectedTypes,
                operation: operation,
                continuation: continuation,
                timeoutTask: timeoutTask
            )
        }
    }

    private func timeoutPendingWaiter(token: UUID, operation: String) {
        guard let waiter = pendingWaiter, waiter.token == token else {
            return
        }

        pendingWaiter = nil
        waiter.timeoutTask.cancel()
        waiter.continuation.resume(throwing: RuntimeClientError.requestTimedOut(operation))
    }

    private func resolvePendingWaiterIfPossible() {
        guard let waiter = pendingWaiter else {
            return
        }

        guard let index = backlog.firstIndex(where: { payload in
            guard let type = payload["type"] as? String else {
                return false
            }
            return waiter.expectedTypes.contains(type) || type == "error"
        }) else {
            return
        }

        let payload = backlog.remove(at: index)
        pendingWaiter = nil
        waiter.timeoutTask.cancel()

        do {
            try throwServerErrorIfNeeded(payload)
            waiter.continuation.resume(returning: payload)
        } catch {
            waiter.continuation.resume(throwing: error)
        }
    }

    private func throwServerErrorIfNeeded(_ payload: [String: Any]) throws {
        guard let type = payload["type"] as? String, type == "error" else {
            return
        }

        let code = (payload["code"] as? NSNumber)?.intValue
        let message = (payload["message"] as? String) ?? "Unknown server error"
        throw RuntimeClientError.server(code: code, message: message)
    }

    private func resolveLaunchProjectPath(for host: StoredHostRecord) async throws -> String {
        if let preferred = host.preferredProjectPath,
           preferred.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            return preferred
        }

        let response = try await request(
            payload: ["type": "list_projects"],
            expecting: ["project_list"],
            operation: "list_projects"
        )

        guard let projects = response["projects"] as? [[String: Any]], projects.isEmpty == false else {
            throw RuntimeClientError.noProjectsFound
        }

        if let wizardProjectPath = projects.first(where: { project in
            let name = (project["name"] as? String)?.lowercased() ?? ""
            return name.contains("wizard") || name.contains("team")
        })?["path"] as? String,
           wizardProjectPath.isEmpty == false {
            return wizardProjectPath
        }

        if let firstPath = projects.compactMap({ $0["path"] as? String }).first,
           firstPath.isEmpty == false {
            return firstPath
        }

        throw RuntimeClientError.noProjectsFound
    }

    private func decodeInstanceList(_ payload: [String: Any], activeInstanceID: String?) -> [RuntimeTeamAppInstance] {
        guard let rawInstances = payload["instances"] as? [Any] else {
            return []
        }

        return rawInstances
            .compactMap { $0 as? [String: Any] }
            .map { mapInstance($0, activeInstanceID: activeInstanceID) }
            .sorted { lhs, rhs in
                if lhs.active == rhs.active {
                    return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
                }
                return lhs.active && rhs.active == false
            }
    }

    private func mapInstance(_ raw: [String: Any], activeInstanceID: String?) -> RuntimeTeamAppInstance {
        let id = (raw["id"] as? String) ?? UUID().uuidString
        let projectName = (raw["project_name"] as? String) ?? (raw["project_path"] as? String) ?? "Unknown Project"
        let state = ((raw["state"] as? String) ?? "working").lowercased()
        let lastOutput = (raw["last_output"] as? String) ?? ""
        let currentTask = (raw["current_task"] as? String) ?? ""

        let health: RuntimeInstanceHealthState
        switch state {
        case "idle":
            health = .idle
        case "waiting_input":
            health = .blocked
        case "error":
            health = .failed
        case "completed", "stopped":
            health = .finished
        default:
            health = .running
        }

        let previewSource = lastOutput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? lastOutput
            : currentTask

        let preview = previewSource.count > 240 ? String(previewSource.prefix(240)) : previewSource

        return RuntimeTeamAppInstance(
            id: id,
            title: projectName,
            active: id == activeInstanceID,
            health: health,
            resultPreview: preview
        )
    }

    private func disconnectTransport(clearHostBinding: Bool) {
        receiveTask?.cancel()
        receiveTask = nil

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil
        tlsDelegate = nil

        if clearHostBinding {
            connectedHostID = nil
        }

        backlog.removeAll(keepingCapacity: false)

        if let waiter = pendingWaiter {
            waiter.timeoutTask.cancel()
            waiter.continuation.resume(throwing: RuntimeClientError.transportUnavailable)
            pendingWaiter = nil
        }
    }

    private func hostRecord(for hostID: String) -> StoredHostRecord? {
        stateStore.hosts.first(where: { $0.id == hostID })
    }

    private func upsertHost(_ record: StoredHostRecord) {
        if let existingIndex = stateStore.hosts.firstIndex(where: { $0.id == record.id }) {
            stateStore.hosts[existingIndex] = record
        } else {
            stateStore.hosts.append(record)
        }
    }

    private static func readStateStore(defaults: UserDefaults) -> RuntimeStateStore {
        guard let data = defaults.data(forKey: Self.stateStoreKey),
              let decoded = try? JSONDecoder().decode(RuntimeStateStore.self, from: data)
        else {
            return .empty
        }
        return decoded
    }

    private func persistStateStore() {
        if let data = try? JSONEncoder().encode(stateStore) {
            defaults.set(data, forKey: Self.stateStoreKey)
        }
    }

    private func mergeLocalDiscoveryHints() {
        let now = Date()

        if let uriValue = ProcessInfo.processInfo.environment["MAGICHAT_PAIRING_URI"],
           uriValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
           let parsed = try? PairingURIComponents.parse(uriValue) {
            let hostID = "\(parsed.host):\(parsed.port)"
            let existing = hostRecord(for: hostID)
            var host = existing ?? StoredHostRecord(
                id: hostID,
                displayName: parsed.displayName ?? parsed.host,
                address: parsed.host,
                port: parsed.port,
                useTLS: parsed.useTLS,
                pairingKey: parsed.pairingKey,
                lastSeenAt: now,
                pairedAt: nil,
                preferredProjectPath: parsed.preferredProjectPath,
                activeInstanceID: nil
            )
            host.lastSeenAt = now
            if let pairingKey = parsed.pairingKey, pairingKey.isEmpty == false {
                host.pairingKey = pairingKey
            }
            if let name = parsed.displayName, name.isEmpty == false {
                host.displayName = name
            }
            if let preferredProjectPath = parsed.preferredProjectPath,
               preferredProjectPath.isEmpty == false {
                host.preferredProjectPath = preferredProjectPath
            }
            upsertHost(host)
        }

        let beaconURL = URL(fileURLWithPath: "/tmp/wizard_team_app/active_instances.json")
        guard let data = try? Data(contentsOf: beaconURL),
              let object = try? JSONSerialization.jsonObject(with: data),
              let records = object as? [[String: Any]],
              records.isEmpty == false
        else {
            if stateStore.hosts.isEmpty {
                upsertHost(
                    StoredHostRecord(
                        id: Self.fallbackHostID,
                        displayName: "Local Wizard Host",
                        address: "127.0.0.1",
                        port: 19750,
                        useTLS: false,
                        pairingKey: nil,
                        lastSeenAt: now,
                        pairedAt: nil,
                        preferredProjectPath: nil,
                        activeInstanceID: nil
                    )
                )
            }
            return
        }

        let displayName = records.count == 1 ? "Local Team App" : "Local Team Apps (\(records.count))"
        let existing = hostRecord(for: Self.fallbackHostID)
        var host = existing ?? StoredHostRecord(
            id: Self.fallbackHostID,
            displayName: displayName,
            address: "127.0.0.1",
            port: 19750,
            useTLS: false,
            pairingKey: nil,
            lastSeenAt: now,
            pairedAt: nil,
            preferredProjectPath: nil,
            activeInstanceID: nil
        )
        host.displayName = displayName
        host.lastSeenAt = now

        if let firstArtifactDir = records.first?["artifact_dir"] as? String,
           firstArtifactDir.isEmpty == false,
           let parent = URL(fileURLWithPath: firstArtifactDir).deletingLastPathComponent().path as String? {
            host.preferredProjectPath = host.preferredProjectPath ?? parent
        }

        upsertHost(host)
    }
}
