import SwiftUI

public struct RestoreSessionView: View {
    @ObservedObject private var store: FeatureStore
    @State private var sessionID = ""
    @State private var monitorEnabled = true

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Restore Session")
                .font(.title3.bold())

            TextField("Team App session ID", text: $sessionID)
                .textFieldStyle(.roundedBorder)
#if os(iOS)
                .textInputAutocapitalization(.never)
#endif
                .disableAutocorrection(true)

            Button("Restore on PC") {
                let targetSession = sessionID
                sessionID = ""
                Task { await store.restoreSession(sessionID: targetSession) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Toggle("Monitor progress periodically", isOn: $monitorEnabled)
                .onChange(of: monitorEnabled) { _, enabled in
                    if enabled {
                        store.startPollingStatus()
                    } else {
                        store.stopPollingStatus()
                    }
                }

            Text("Use this when Team App was rebuilt/restarted on PC and you need to continue the interrupted task from phone.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .onAppear {
            if monitorEnabled {
                store.startPollingStatus()
            }
        }
        .onDisappear {
            store.stopPollingStatus()
        }
    }
}
