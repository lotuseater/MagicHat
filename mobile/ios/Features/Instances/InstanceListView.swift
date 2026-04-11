import SwiftUI

public struct InstanceListView: View {
    @ObservedObject private var store: FeatureStore

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Team App Instances")
                    .font(.title3.bold())
                Spacer()
                if let presence = store.activeHostPresence {
                    Text(presence.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button("Refresh") {
                    Task { await store.reloadInstances() }
                }
                .buttonStyle(.bordered)

                Button("Open New") {
                    Task { await store.launchInstance() }
                }
                .buttonStyle(.borderedProminent)
            }

            if store.instances.isEmpty {
                ContentUnavailableView(
                    "No Open Instances",
                    systemImage: "rectangle.stack.badge.plus",
                    description: Text("Pair with a host and launch a Team App instance from here.")
                )
            } else {
                List(store.instances) { instance in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(instance.title)
                                .font(.headline)
                            Text(instance.lastResultPreview ?? "No result yet")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            if let restoreRef = instance.restoreRef {
                                Text("restore ref: \(restoreRef)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

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

                        Button("Switch") {
                            Task { await store.switchInstance(instance.id) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(store.activeInstanceID == instance.id)

                        Button(role: .destructive) {
                            Task { await store.closeInstance(instance.id) }
                        } label: {
                            Label("Close", systemImage: "xmark.circle")
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.plain)
            }

            if store.isPerformingRemoteAction {
                ProgressView("Applying remote action...")
            }
        }
        .padding()
    }
}
