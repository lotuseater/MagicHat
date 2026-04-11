import Foundation

public protocol TeamAppRuntimeProviding: AnyObject {
    func pairToFirstAvailableHost() async throws -> HostBeacon
    func pair(to host: HostBeacon) async throws
    func currentHost() async -> HostBeacon?

    func listInstances() async throws -> [TeamAppInstance]
    func switchToInstance(id: String) async throws -> TeamAppInstance
    func launchInstance(initialPrompt: String?) async throws -> TeamAppInstance
    func closeInstance(id: String) async throws

    func fetchStatus(for instanceID: String) async throws -> TeamAppStatus
    func sendPrompt(_ text: String, to instanceID: String) async throws -> PromptAck
    func sendFollowUp(_ text: String, threadID: String?, to instanceID: String) async throws -> PromptAck

    func restoreSession(_ sessionID: String) async throws -> SessionRestoreResult
    func restoreLastSession() async throws -> SessionSnapshot?
}
