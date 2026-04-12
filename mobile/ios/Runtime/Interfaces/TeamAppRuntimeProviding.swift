import Foundation

public protocol TeamAppRuntimeProviding: AnyObject {
    func pairToFirstAvailableHost() async throws -> HostBeacon
    func pair(to host: HostBeacon) async throws
    func registerPairingURI(_ rawURI: String, deviceName: String) async throws -> HostBeacon
    func currentHost() async -> HostBeacon?

    func listInstances() async throws -> [TeamAppInstance]
    func listKnownRestoreRefs() async throws -> [KnownRestoreRef]
    func switchToInstance(id: String) async throws -> TeamAppInstance
    func launchInstance(initialPrompt: String?) async throws -> TeamAppInstance
    func closeInstance(id: String) async throws

    func fetchStatus(for instanceID: String) async throws -> TeamAppStatus
    func sendPrompt(_ text: String, to instanceID: String) async throws -> PromptAck
    func sendFollowUp(_ text: String, threadID: String?, to instanceID: String) async throws -> PromptAck
    func answerTrustPrompt(_ approved: Bool, for instanceID: String) async throws
    func observeInstanceEvents(
        for instanceID: String,
        onEvent: @escaping @Sendable (TeamAppInstanceEvent) -> Void,
        onState: @escaping @Sendable (String) -> Void
    ) async
    func stopObservingInstanceEvents() async

    func restoreSession(_ sessionID: String) async throws -> SessionRestoreResult
    func restoreLastSession() async throws -> SessionSnapshot?
}
