import SwiftUI

public struct RestoreSessionView: View {
    @ObservedObject private var store: FeatureStore
    @State private var sessionID = ""
    @State private var monitorEnabled = true

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        let hasPairedHost = store.pairedHost != nil

        VStack(alignment: .leading, spacing: 12) {
            Text("Restore Session")
                .font(.title3.bold())

            HostContextCard(
                host: store.pairedHost,
                presence: store.activeHostPresence,
                activeInstanceID: store.activeInstanceID
            )

            TextField("Restore ref or Team App session ID", text: $sessionID)
                .textFieldStyle(.roundedBorder)
#if os(iOS)
                .textInputAutocapitalization(.never)
#endif
                .disableAutocorrection(true)
                .disabled(hasPairedHost == false || store.isPerformingRemoteAction)

            if hasPairedHost == false {
                Text("Pair with a Team App host first so this screen has a safe place to restore work into.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if store.knownRestoreRefs.isEmpty == false {
                Text("Known Restore Refs")
                    .font(.headline)

                List(store.knownRestoreRefs) { restoreRef in
                    Button {
                        sessionID = restoreRef.restoreRef
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(restoreRef.title ?? restoreRef.restoreRef)
                                .font(.subheadline.bold())
                            Text(restoreRef.restoreRef)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let session = restoreRef.sessionID {
                                Text("session: \(session)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
                .frame(minHeight: 120)
            }

            Button("Restore on PC") {
                let targetSession = sessionID
                sessionID = ""
                Task { await store.restoreSession(sessionID: targetSession) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasPairedHost == false || store.isPerformingRemoteAction)

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
