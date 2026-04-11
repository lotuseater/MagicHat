import SwiftUI

public struct PromptComposerView: View {
    @ObservedObject private var store: FeatureStore
    @State private var promptText = ""
    @State private var followUpText = ""

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Prompt + Follow-up")
                .font(.title3.bold())

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
                .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

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
                .disabled(followUpText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

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
