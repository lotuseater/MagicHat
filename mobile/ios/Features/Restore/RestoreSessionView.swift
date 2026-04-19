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
        let canRunCommands = store.pairedHost?.canRunCommands == true

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Restore Session")
                    .font(.title3.bold())

                HostContextCard(
                    host: store.pairedHost,
                    presence: store.activeHostPresence,
                    activeInstanceID: store.activeInstanceID,
                    onRefreshStatus: store.pairedHost == nil ? nil : { Task { await store.refreshCurrentHostStatus() } },
                    refreshEnabled: store.isPerformingRemoteAction == false
                )

                TextField("Restore ref or Team App session ID", text: $sessionID)
                    .textFieldStyle(.roundedBorder)
#if os(iOS)
                    .textInputAutocapitalization(.never)
#endif
                    .disableAutocorrection(true)
                    .disabled(hasPairedHost == false || store.isPerformingRemoteAction)
                    .accessibilityIdentifier("magichat.restore.sessionID")

                if let lastRestoredSessionID = store.lastRestoredSessionID {
                    Text("Last restored session: \(lastRestoredSessionID)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if hasPairedHost == false {
                    Text("Pair with a Team App host first so this screen has a safe place to restore work into.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if canRunCommands == false {
                    Text("The active host is offline, so restore actions are paused until it reconnects.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button("Restore on PC") {
                    let targetSession = sessionID
                    sessionID = ""
                    Task { await store.restoreSession(sessionID: targetSession) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasPairedHost == false || canRunCommands == false || store.isPerformingRemoteAction)
                .accessibilityIdentifier("magichat.restore.submit")

                Toggle("Monitor progress periodically", isOn: $monitorEnabled)
                    .onChange(of: monitorEnabled) { _, enabled in
                        if enabled {
                            store.startPollingStatus()
                        } else {
                            store.stopPollingStatus()
                        }
                    }
                    .accessibilityIdentifier("magichat.restore.monitor")

                if store.knownRestoreRefs.isEmpty == false {
                    Text("Known Restore Refs")
                        .font(.headline)

                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(store.knownRestoreRefs) { restoreRef in
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
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Text("Use this when Team App was rebuilt or restarted on PC and you need to continue the interrupted task from phone.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .accessibilityIdentifier("magichat.restore.screen")
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
