import Foundation
import Combine

@MainActor
public final class AppState: ObservableObject {
    public enum ConnectionState: Equatable {
        case booting
        case unpaired
        case connected(host: String)
        case failed(message: String)
    }

    @Published public private(set) var connectionState: ConnectionState = .booting
    @Published public private(set) var activeHost: HostBeacon?
    @Published public private(set) var activeInstanceID: String?
    @Published public private(set) var activeSessionID: String?

    public let runtime: TeamAppRuntimeProviding

    private var didBootstrap = false

    public init(environment: AppEnvironment = .live()) {
        self.runtime = environment.runtime
    }

    public func bootstrapIfNeeded() async {
        guard didBootstrap == false else {
            return
        }

        didBootstrap = true

        do {
            if let snapshot = try await runtime.restoreLastSession() {
                apply(snapshot: snapshot)
                connectionState = .connected(host: snapshot.host.displayName)
                return
            }

            let host = try await runtime.pairToFirstAvailableHost()
            activeHost = host
            connectionState = .connected(host: host.displayName)
        } catch {
            connectionState = .failed(message: error.localizedDescription)
        }
    }

    public func refreshConnection() async {
        if let host = await runtime.currentHost() {
            activeHost = host
            connectionState = .connected(host: host.displayName)
        } else {
            connectionState = .unpaired
        }
    }

    private func apply(snapshot: SessionSnapshot) {
        activeHost = snapshot.host
        activeInstanceID = snapshot.activeInstanceID
        activeSessionID = snapshot.activeSessionID
    }
}
