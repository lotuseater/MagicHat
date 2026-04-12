import Foundation
import SwiftUI

@MainActor
public final class FeatureStore: ObservableObject {
    public enum PairingState: String {
        case disconnected
        case discovering
        case pairing
        case paired
    }

    @Published public private(set) var pairingState: PairingState = .disconnected
    @Published public private(set) var discoveredHosts: [HostBeacon] = []
    @Published public private(set) var pairedHosts: [HostBeacon] = []
    @Published public private(set) var pairedHost: HostBeacon?

    @Published public private(set) var instances: [TeamAppInstance] = []
    @Published public private(set) var knownRestoreRefs: [KnownRestoreRef] = []
    @Published public private(set) var activeInstanceID: String?
    @Published public private(set) var statusSnapshot: TeamAppStatus?
    @Published public private(set) var activeHostPresence: String?
    @Published public private(set) var streamEvents: [TeamAppInstanceEvent] = []
    @Published public private(set) var streamStatus: String = "idle"

    @Published public private(set) var latestPromptReceipt: PromptAck?
    @Published public private(set) var latestFollowUpReceipt: PromptAck?
    @Published public private(set) var lastRestoredSessionID: String?

    @Published public private(set) var isPerformingRemoteAction = false
    @Published public private(set) var lastErrorMessage: String?

    private let runtime: any TeamAppRuntimeProviding
    private var pollingTask: Task<Void, Never>?

    public init(runtime: any TeamAppRuntimeProviding) {
        self.runtime = runtime
    }

    deinit {
        pollingTask?.cancel()
        let runtime = runtime
        Task {
            await runtime.stopObservingInstanceEvents()
        }
    }

    public func discoverHosts() async {
        await performPairingAction(state: .discovering) {
            pairedHosts = await runtime.pairedHosts()
            if let connected = await runtime.currentHost() {
                discoveredHosts = [connected]
                pairedHost = connected
                activeHostPresence = connected.lastKnownHostPresence
                pairingState = .paired
                knownRestoreRefs = try await runtime.listKnownRestoreRefs()
            } else {
                discoveredHosts = []
                knownRestoreRefs = []
                activeHostPresence = nil
                pairingState = .disconnected
            }
        }
    }

    public func bootstrap() async {
        await discoverHosts()
        if pairedHost != nil {
            await reloadInstances()
        }
    }

    public func pair(hostID: String, pin: String?) async {
        await performPairingAction(state: .pairing) {
            _ = pin

            let paired: HostBeacon
            if let selected = discoveredHosts.first(where: { $0.hostID == hostID }) {
                try await runtime.pair(to: selected, pairingCode: pin)
                paired = selected
            } else {
                paired = try await runtime.pairToFirstAvailableHost(pairingCode: pin)
            }

            try await syncHostContext()
            discoveredHosts = [paired]
            await reloadInstances()
        }
    }

    public func pairViaURI(_ rawURI: String, deviceName: String) async {
        let trimmed = rawURI.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        await performPairingAction(state: .pairing) {
            let paired = try await runtime.registerPairingURI(trimmed, deviceName: deviceName)
            try await syncHostContext()
            discoveredHosts = [paired]
            await reloadInstances()
        }
    }

    public func selectPairedHost(_ hostID: String) async {
        await performPairingAction(state: .pairing) {
            try await runtime.selectHost(id: hostID)
            try await syncHostContext(resetSelection: true)
            await reloadInstances()
        }
    }

    public func forgetPairedHost(_ hostID: String) async {
        await performPairingAction(state: .pairing) {
            try await runtime.removeHost(id: hostID)
            try await syncHostContext(resetSelection: true)
            if pairedHost != nil {
                await reloadInstances()
            } else {
                resetInstanceContext()
            }
        }
    }

    public func refreshCurrentHostStatus() async {
        await performRemoteAction {
            _ = try await runtime.refreshCurrentHostStatus()
            try await syncHostContext()
        }
    }

    public func reloadInstances() async {
        await performRemoteAction {
            guard pairedHost != nil else {
                resetInstanceContext()
                return
            }
            let updated = try await runtime.listInstances()
            instances = updated
            knownRestoreRefs = try await runtime.listKnownRestoreRefs()
            try await syncHostContext()

            if activeInstanceID == nil || updated.contains(where: { $0.id == activeInstanceID }) == false {
                activeInstanceID = updated.first?.id
            }

            if activeInstanceID != nil {
                await restartInstanceStream()
                await refreshStatus()
            } else {
                statusSnapshot = nil
                streamEvents = []
                streamStatus = "idle"
                await runtime.stopObservingInstanceEvents()
            }
        }
    }

    public func switchInstance(_ instanceID: String) async {
        await performRemoteAction {
            let switched = try await runtime.switchToInstance(id: instanceID)
            activeInstanceID = switched.id
            replaceOrAppend(switched)
            await restartInstanceStream()
            await refreshStatus()
        }
    }

    public func launchInstance() async {
        await performRemoteAction {
            let created = try await runtime.launchInstance(initialPrompt: nil)
            activeInstanceID = created.id
            replaceOrAppend(created)
            instances = try await runtime.listInstances()
            await restartInstanceStream()
            await refreshStatus()
        }
    }

    public func closeInstance(_ instanceID: String) async {
        await performRemoteAction {
            try await runtime.closeInstance(id: instanceID)
            instances.removeAll(where: { $0.id == instanceID })

            if activeInstanceID == instanceID {
                activeInstanceID = instances.first?.id
            }

            if activeInstanceID != nil {
                await restartInstanceStream()
                await refreshStatus()
            } else {
                statusSnapshot = nil
                streamEvents = []
                streamStatus = "idle"
                await runtime.stopObservingInstanceEvents()
            }
        }
    }

    public func refreshStatus() async {
        guard let instanceID = activeInstanceID else { return }

        await performRemoteAction {
            let status = try await runtime.fetchStatus(for: instanceID)
            statusSnapshot = status

            if let index = instances.firstIndex(where: { $0.id == instanceID }) {
                let current = instances[index]
                instances[index] = TeamAppInstance(
                    id: current.id,
                    title: current.title,
                    state: status.state,
                    createdAt: current.createdAt,
                    updatedAt: status.updatedAt,
                    activeSessionID: status.activeSessionID ?? current.activeSessionID,
                    lastResultPreview: status.latestResult ?? current.lastResultPreview,
                    restoreRef: current.restoreRef
                )
            }
        }
    }

    public func submitPrompt(_ prompt: String) async {
        guard let instanceID = activeInstanceID else { return }
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        await performRemoteAction {
            latestPromptReceipt = try await runtime.sendPrompt(trimmed, to: instanceID)
            await refreshStatus()
        }
    }

    public func submitFollowUp(_ followUp: String) async {
        guard let instanceID = activeInstanceID else { return }
        let trimmed = followUp.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        await performRemoteAction {
            let threadID = statusSnapshot?.activeSessionID
            latestFollowUpReceipt = try await runtime.sendFollowUp(trimmed, threadID: threadID, to: instanceID)
            await refreshStatus()
        }
    }

    public func answerTrustPrompt(_ approved: Bool) async {
        guard let instanceID = activeInstanceID else { return }

        await performRemoteAction {
            try await runtime.answerTrustPrompt(approved, for: instanceID)
            await refreshStatus()
        }
    }

    public func restoreSession(sessionID: String) async {
        let trimmed = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        await performRemoteAction {
            let restored = try await runtime.restoreSession(trimmed)
            lastRestoredSessionID = restored.sessionID
            activeInstanceID = restored.instance.id
            statusSnapshot = restored.status
            replaceOrAppend(restored.instance)
            instances = try await runtime.listInstances()
            knownRestoreRefs = try await runtime.listKnownRestoreRefs()
            await restartInstanceStream()
            await refreshStatus()
        }
    }

    public func startPollingStatus(every intervalSeconds: TimeInterval = 2.0) {
        pollingTask?.cancel()

        pollingTask = Task {
            while !Task.isCancelled {
                await refreshStatus()
                try? await Task.sleep(nanoseconds: UInt64(intervalSeconds * 1_000_000_000))
            }
        }
    }

    public func stopPollingStatus() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func syncHostContext(resetSelection: Bool = false) async throws {
        let currentHost = await runtime.currentHost()
        pairedHosts = await runtime.pairedHosts()
        pairedHost = currentHost
        activeHostPresence = currentHost?.lastKnownHostPresence
        pairingState = currentHost == nil ? .disconnected : .paired

        if resetSelection {
            resetInstanceContext()
        }
    }

    private func resetInstanceContext() {
        instances = []
        knownRestoreRefs = []
        activeInstanceID = nil
        statusSnapshot = nil
        streamEvents = []
        streamStatus = "idle"
        latestPromptReceipt = nil
        latestFollowUpReceipt = nil
        lastRestoredSessionID = nil
    }

    private func replaceOrAppend(_ instance: TeamAppInstance) {
        if let index = instances.firstIndex(where: { $0.id == instance.id }) {
            instances[index] = instance
        } else {
            instances.append(instance)
        }
    }

    private func restartInstanceStream() async {
        guard let instanceID = activeInstanceID else {
            streamEvents = []
            streamStatus = "idle"
            await runtime.stopObservingInstanceEvents()
            return
        }

        streamEvents = []
        streamStatus = "connecting"
        await runtime.observeInstanceEvents(
            for: instanceID,
            onEvent: { [weak self] event in
                Task { @MainActor [weak self] in
                    self?.applyStreamEvent(event)
                }
            },
            onState: { [weak self] state in
                Task { @MainActor [weak self] in
                    self?.streamStatus = state
                }
            }
        )
    }

    private func applyStreamEvent(_ event: TeamAppInstanceEvent) {
        if event.type.lowercased() != "heartbeat" {
            streamEvents = Array((streamEvents + [event]).suffix(150))
        }

        guard let activeInstanceID,
              event.instanceID == nil || event.instanceID == activeInstanceID
        else {
            return
        }

        let activeSessionID =
            statusSnapshot?.activeSessionID ??
            instances.first(where: { $0.id == activeInstanceID })?.activeSessionID
        let nextState = TeamAppInstanceState.fromRemoteValue(event.health) != .unknown
            ? TeamAppInstanceState.fromRemoteValue(event.health)
            : (statusSnapshot?.state ?? instances.first(where: { $0.id == activeInstanceID })?.state ?? .unknown)
        let nextHealthMessage = event.message ?? event.health ?? statusSnapshot?.healthMessage
        let nextLatestResult = event.outputChunk ?? event.message ?? statusSnapshot?.latestResult

        statusSnapshot = TeamAppStatus(
            instanceID: activeInstanceID,
            state: nextState,
            progressPercent: statusSnapshot?.progressPercent,
            healthMessage: nextHealthMessage,
            latestResult: nextLatestResult,
            activeSessionID: activeSessionID,
            trustStatus: statusSnapshot?.trustStatus,
            pendingTrustProject: statusSnapshot?.pendingTrustProject,
            updatedAt: Date()
        )

        if let index = instances.firstIndex(where: { $0.id == activeInstanceID }) {
            let current = instances[index]
            instances[index] = TeamAppInstance(
                id: current.id,
                title: current.title,
                state: nextState,
                createdAt: current.createdAt,
                updatedAt: Date(),
                activeSessionID: activeSessionID ?? current.activeSessionID,
                lastResultPreview: nextLatestResult ?? current.lastResultPreview,
                restoreRef: current.restoreRef
            )
        }
    }

    private func performPairingAction(state: PairingState, work: () async throws -> Void) async {
        lastErrorMessage = nil
        pairingState = state

        do {
            try await work()
            if pairedHost == nil && pairedHosts.isEmpty {
                pairingState = .disconnected
            }
        } catch {
            pairingState = pairedHost == nil && pairedHosts.isEmpty ? .disconnected : .paired
            lastErrorMessage = error.localizedDescription
        }
    }

    private func performRemoteAction(work: () async throws -> Void) async {
        lastErrorMessage = nil
        isPerformingRemoteAction = true
        defer { isPerformingRemoteAction = false }

        do {
            try await work()
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }
}
