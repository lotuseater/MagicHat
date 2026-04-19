import SwiftUI

public struct InstanceListView: View {
    @ObservedObject private var store: FeatureStore

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        let hasPairedHost = store.pairedHost != nil
        let canRunCommands = store.pairedHost?.canRunCommands == true

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Team App Instances")
                        .font(.title3.bold())
                    Spacer()
                    Button("Refresh") {
                        Task { await store.reloadInstances() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(hasPairedHost == false || store.isPerformingRemoteAction)
                    .accessibilityIdentifier("magichat.instances.refresh")

                    Button("Open New") {
                        Task { await store.launchInstance() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(canRunCommands == false || store.isPerformingRemoteAction)
                    .accessibilityIdentifier("magichat.instances.openNew")
                }

                HostContextCard(
                    host: store.pairedHost,
                    presence: store.activeHostPresence,
                    activeInstanceID: store.activeInstanceID,
                    onRefreshStatus: store.pairedHost == nil ? nil : { Task { await store.refreshCurrentHostStatus() } },
                    refreshEnabled: store.isPerformingRemoteAction == false
                )

                if hasPairedHost == false {
                    ContentUnavailableView(
                        "No Host Selected",
                        systemImage: "desktopcomputer",
                        description: Text("Pair with a Team App host first, then this tab can launch and manage instances.")
                    )
                } else if canRunCommands == false {
                    Text("The active host is offline. You can still refresh to check again or switch to another paired host.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if store.instances.isEmpty {
                    ContentUnavailableView(
                        "No Open Instances",
                        systemImage: "rectangle.stack.badge.plus",
                        description: Text("Connected to the current host, but there are no open Team App instances yet.")
                    )
                } else {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(store.instances) { instance in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(alignment: .top, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(instance.title)
                                            .font(.headline)
                                        Text(instance.lastResultPreview ?? "No result yet")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(3)
                                        if let restoreRef = instance.restoreRef {
                                            Text("restore ref: \(restoreRef)")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }

                                    Spacer()

                                    VStack(alignment: .trailing, spacing: 6) {
                                        Text(instance.state.rawValue.capitalized)
                                            .font(.caption)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(.thinMaterial, in: Capsule())

                                        if store.activeInstanceID == instance.id {
                                            Text("Active")
                                                .font(.caption.bold())
                                                .foregroundStyle(.green)
                                        }
                                    }
                                }

                                HStack(spacing: 8) {
                                    Button("Switch") {
                                        Task { await store.switchInstance(instance.id) }
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(store.activeInstanceID == instance.id || store.isPerformingRemoteAction || canRunCommands == false)

                                    Button(role: .destructive) {
                                        Task { await store.closeInstance(instance.id) }
                                    } label: {
                                        Label("Close", systemImage: "xmark.circle")
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(store.isPerformingRemoteAction || canRunCommands == false)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }

                if store.isPerformingRemoteAction {
                    ProgressView("Applying remote action...")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .accessibilityIdentifier("magichat.instances.screen")
    }
}
