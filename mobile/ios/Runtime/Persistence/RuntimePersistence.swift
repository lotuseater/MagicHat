import Foundation

public struct PairedHostsState: Codable, Hashable, Sendable {
    public let hosts: [HostBeacon]
    public let activeHostID: String?

    public init(hosts: [HostBeacon], activeHostID: String?) {
        self.hosts = hosts
        self.activeHostID = activeHostID
    }
}

public protocol RuntimePersistence: Sendable {
    func loadPairedHost() async -> HostBeacon?
    func savePairedHost(_ host: HostBeacon?) async throws
    func loadPairedHostsState() async -> PairedHostsState?
    func savePairedHostsState(_ state: PairedHostsState?) async throws
    func loadSessionSnapshot() async -> SessionSnapshot?
    func saveSessionSnapshot(_ snapshot: SessionSnapshot?) async throws
}

public extension RuntimePersistence {
    func loadPairedHostsState() async -> PairedHostsState? {
        guard let host = await loadPairedHost() else {
            return nil
        }
        return PairedHostsState(hosts: [host], activeHostID: host.hostID)
    }

    func savePairedHostsState(_ state: PairedHostsState?) async throws {
        let activeHost = state.flatMap { snapshot in
            snapshot.hosts.first(where: { $0.hostID == snapshot.activeHostID }) ?? snapshot.hosts.first
        }
        try await savePairedHost(activeHost)
    }
}

public actor FileRuntimePersistence: RuntimePersistence {
    private let directoryURL: URL
    private let hostFileURL: URL
    private let hostsStateFileURL: URL
    private let snapshotFileURL: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(baseDirectory: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager

        let fallback = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("MagicHatRuntime", isDirectory: true)

        self.directoryURL = baseDirectory ?? fallback
        self.hostFileURL = self.directoryURL.appendingPathComponent("paired-host.json")
        self.hostsStateFileURL = self.directoryURL.appendingPathComponent("paired-hosts.json")
        self.snapshotFileURL = self.directoryURL.appendingPathComponent("session-snapshot.json")

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        self.encoder = encoder

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        Self.createDirectoryIfNeeded(at: self.directoryURL, fileManager: fileManager)
    }

    public func loadPairedHost() async -> HostBeacon? {
        decode(HostBeacon.self, from: hostFileURL)
    }

    public func savePairedHost(_ host: HostBeacon?) async throws {
        if let host {
            try persist(host, to: hostFileURL)
        } else {
            try removeIfPresent(hostFileURL)
        }
    }

    public func loadPairedHostsState() async -> PairedHostsState? {
        if let snapshot = decode(PairedHostsState.self, from: hostsStateFileURL) {
            return snapshot
        }

        guard let host = decode(HostBeacon.self, from: hostFileURL) else {
            return nil
        }

        return PairedHostsState(hosts: [host], activeHostID: host.hostID)
    }

    public func savePairedHostsState(_ state: PairedHostsState?) async throws {
        if let state {
            try persist(state, to: hostsStateFileURL)
            let activeHost = state.hosts.first(where: { $0.hostID == state.activeHostID }) ?? state.hosts.first
            try await savePairedHost(activeHost)
        } else {
            try removeIfPresent(hostsStateFileURL)
            try await savePairedHost(nil)
        }
    }

    public func loadSessionSnapshot() async -> SessionSnapshot? {
        decode(SessionSnapshot.self, from: snapshotFileURL)
    }

    public func saveSessionSnapshot(_ snapshot: SessionSnapshot?) async throws {
        if let snapshot {
            try persist(snapshot, to: snapshotFileURL)
        } else {
            try removeIfPresent(snapshotFileURL)
        }
    }

    private static func createDirectoryIfNeeded(at directoryURL: URL, fileManager: FileManager) {
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        } catch {
            assertionFailure("Failed to create runtime persistence directory: \(error)")
        }
    }

    private func persist<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try encoder.encode(value)
        try data.write(to: url, options: .atomic)
    }

    private func decode<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }

        return try? decoder.decode(T.self, from: data)
    }

    private func removeIfPresent(_ url: URL) throws {
        if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }
}
