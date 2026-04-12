import SwiftUI

public struct PromptComposerView: View {
    @ObservedObject private var store: FeatureStore
    @State private var promptText = ""
    @State private var followUpText = ""

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        let hasActiveInstance = store.activeInstanceID != nil
        let canRunCommands = store.pairedHost?.canRunCommands == true

        VStack(alignment: .leading, spacing: 12) {
            Text("Prompt + Follow-up")
                .font(.title3.bold())

            HostContextCard(
                host: store.pairedHost,
                presence: store.activeHostPresence,
                activeInstanceID: store.activeInstanceID,
                onRefreshStatus: store.pairedHost == nil ? nil : { Task { await store.refreshCurrentHostStatus() } },
                refreshEnabled: store.isPerformingRemoteAction == false
            )

            if hasActiveInstance == false {
                Text("Pick or launch an instance first. Prompts and follow-ups are sent to the currently active Team App instance.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if canRunCommands == false {
                Text("The active host is offline, so prompt delivery is paused until it reconnects.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Prompt")
                    .font(.headline)

                TextEditor(text: $promptText)
                    .frame(minHeight: 90)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                Button("Send Prompt") {
                    let payload = promptText
                    promptText = ""
                    Task { await store.submitPrompt(payload) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasActiveInstance == false || canRunCommands == false || store.isPerformingRemoteAction)

                if let receipt = store.latestPromptReceipt {
                    Text("Prompt request: \(receipt.requestID) @ \(receipt.acceptedAt.formatted(date: .omitted, time: .standard))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Follow-up")
                    .font(.headline)

                TextEditor(text: $followUpText)
                    .frame(minHeight: 70)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                Button("Send Follow-up") {
                    let payload = followUpText
                    followUpText = ""
                    Task { await store.submitFollowUp(payload) }
                }
                .buttonStyle(.bordered)
                .disabled(followUpText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasActiveInstance == false || canRunCommands == false || store.isPerformingRemoteAction)

                if let receipt = store.latestFollowUpReceipt {
                    Text("Follow-up request: \(receipt.requestID) @ \(receipt.acceptedAt.formatted(date: .omitted, time: .standard))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
    }
}
