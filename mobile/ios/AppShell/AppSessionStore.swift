import Foundation
import SwiftUI

@MainActor
public final class AppSessionStore: ObservableObject {
    @Published public private(set) var hosts: [RuntimeBeaconHost] = []
    @Published public private(set) var instances: [RuntimeTeamAppInstance] = []
    @Published public private(set) var activeHostID: String?
    @Published public private(set) var activeInstanceID: String?
    @Published public private(set) var lastErrorMessage: String?
    @Published public private(set) var launchRestoreSnapshot: RuntimeLaunchRestoreSnapshot?

    private let runtime: RuntimeClient

    public init(runtime: RuntimeClient = RuntimeClient()) {
        self.runtime = runtime
    }

    public func bootstrap() async {
        await refreshHosts()
        await refreshLaunchSnapshot()
        await restoreLastSessionIfAvailable()
    }

    public func refreshHosts() async {
        do {
            hosts = try await runtime.discoverHosts()
            if activeHostID == nil {
                activeHostID = hosts.first?.id
            }
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func registerPairingURI(_ rawURI: String, pinOverride: String?) async {
        do {
            let host = try await runtime.registerPairingURI(rawURI)
            let paired = try await runtime.pair(hostID: host.id, pin: pinOverride)
            activeHostID = paired.hostID
            await refreshHosts()
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func pairSelectedHost(pin: String?) async {
        guard let hostID = activeHostID else {
            return
        }

        do {
            _ = try await runtime.pair(hostID: hostID, pin: pin)
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func selectHost(_ hostID: String) async {
        activeHostID = hostID
    }

    public func refreshInstances() async {
        guard let hostID = activeHostID else {
            instances = []
            return
        }

        do {
            instances = try await runtime.listInstances(hostID: hostID)
            activeInstanceID = instances.first(where: { $0.active })?.id ?? instances.first?.id
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func switchToInstance(_ instanceID: String) async {
        guard let hostID = activeHostID else {
            return
        }

        do {
            try await runtime.switchToInstance(hostID: hostID, instanceID: instanceID)
            activeInstanceID = instanceID
            instances = instances.map { instance in
                var updated = instance
                updated.active = instance.id == instanceID
                return updated
            }
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func launchInstance() async {
        guard let hostID = activeHostID else {
            return
        }

        do {
            let created = try await runtime.launchInstance(hostID: hostID)
            activeInstanceID = created.id
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func closeInstance(_ instanceID: String) async {
        guard let hostID = activeHostID else {
            return
        }

        do {
            try await runtime.closeInstance(hostID: hostID, instanceID: instanceID)
            if activeInstanceID == instanceID {
                activeInstanceID = nil
            }
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func sendPrompt(_ text: String) async {
        guard let hostID = activeHostID,
              let instanceID = activeInstanceID
        else {
            return
        }

        do {
            _ = try await runtime.sendPrompt(hostID: hostID, instanceID: instanceID, prompt: text)
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func sendFollowUp(_ text: String) async {
        guard let hostID = activeHostID,
              let instanceID = activeInstanceID
        else {
            return
        }

        do {
            _ = try await runtime.sendFollowUp(hostID: hostID, instanceID: instanceID, followUp: text)
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func restoreSession(sessionID: String) async {
        guard let hostID = activeHostID else {
            return
        }

        do {
            let restored = try await runtime.restoreSession(hostID: hostID, sessionID: sessionID)
            activeInstanceID = restored.id
            await refreshInstances()
            await refreshLaunchSnapshot()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    public func restoreLastSessionIfAvailable() async {
        do {
            guard let snapshot = await runtime.restoreLaunchSnapshot() else {
                return
            }
            launchRestoreSnapshot = snapshot
            activeHostID = snapshot.hostID
            let restored = try await runtime.restoreSession(hostID: snapshot.hostID, sessionID: snapshot.sessionID)
            activeInstanceID = restored.id
            await refreshInstances()
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    private func refreshLaunchSnapshot() async {
        launchRestoreSnapshot = await runtime.restoreLaunchSnapshot()
    }
}
