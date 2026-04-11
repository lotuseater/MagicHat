import Foundation

public protocol BeaconDiscovering: Sendable {
    func discoverBeacons() async throws -> [HostBeacon]
}

public struct HTTPBeaconDiscovery: BeaconDiscovering {
    private let candidateURLs: [URL]
    private let makeClient: @Sendable (URL) -> HostAPIClient

    public init(
        candidateURLs: [URL],
        makeClient: @escaping @Sendable (URL) -> HostAPIClient
    ) {
        self.candidateURLs = candidateURLs
        self.makeClient = makeClient
    }

    public func discoverBeacons() async throws -> [HostBeacon] {
        if candidateURLs.isEmpty {
            throw HostAPIError.beaconDiscoveryFailed
        }

        return await withTaskGroup(of: HostBeacon?.self) { group in
            for url in candidateURLs {
                group.addTask {
                    do {
                        return try await makeClient(url).fetchBeacon()
                    } catch {
                        return nil
                    }
                }
            }

            var found: [String: HostBeacon] = [:]
            for await beacon in group {
                guard let beacon else { continue }
                found[beacon.hostID] = beacon
            }

            return found.values.sorted { left, right in
                left.lastSeenAt > right.lastSeenAt
            }
        }
    }

    public static func `default`() -> HTTPBeaconDiscovery {
        let env = ProcessInfo.processInfo.environment
        let envCandidates = env["MAGICHAT_HOST_CANDIDATES"]?
            .split(separator: ",")
            .compactMap { URL(string: String($0).trimmingCharacters(in: .whitespacesAndNewlines)) } ?? []

        let defaults: [URL] = [
            URL(string: "http://127.0.0.1:8765")!,
            URL(string: "http://localhost:8765")!,
            URL(string: "http://127.0.0.1:8080")!,
            URL(string: "http://localhost:8080")!
        ]

        let candidates = envCandidates.isEmpty ? defaults : envCandidates
        return HTTPBeaconDiscovery(candidateURLs: candidates) { baseURL in
            URLSessionHostAPIClient(baseURL: baseURL)
        }
    }
}
