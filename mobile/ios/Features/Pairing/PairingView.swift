import SwiftUI

public struct PairingView: View {
    @ObservedObject private var store: FeatureStore
    @State private var selectedHostID: String?
    @State private var pin = ""
    @State private var pairingURI = ""

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("PC Pairing")
                        .font(.title3.bold())
                    Spacer()
                    Text(store.pairingState.rawValue.capitalized)
                        .foregroundStyle(store.pairingState == .paired ? .green : .secondary)
                }

                HostContextCard(
                    host: store.pairedHost,
                    presence: store.activeHostPresence,
                    onRefreshStatus: store.pairedHost == nil ? nil : { Task { await store.refreshCurrentHostStatus() } },
                    refreshEnabled: store.pairingState != .pairing && store.isPerformingRemoteAction == false
                )

                TextField("magichat://pair?... or magichat://host:port?psk=...", text: $pairingURI)
#if os(iOS)
                    .textInputAutocapitalization(.never)
#endif
                    .disableAutocorrection(true)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("magichat.pairing.uri")

                HStack(spacing: 8) {
                    Button("Pair From URI") {
                        let rawURI = pairingURI
                        pairingURI = ""
                        Task {
                            await store.pairViaURI(rawURI, deviceName: "MagicHat iPhone")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.pairingState == .pairing || pairingURI.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("magichat.pairing.fromURI")

                    Button("Discover Team App Hosts") {
                        Task { await store.discoverHosts() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(store.pairingState == .pairing)
                    .accessibilityIdentifier("magichat.pairing.discover")
                }

                if store.discoveredHosts.isEmpty {
                    Text("Discover a LAN Team App host or paste a remote pairing URI to get started.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Reachable Hosts")
                            .font(.headline)

                        ForEach(store.discoveredHosts) { host in
                            Button {
                                selectedHostID = host.hostID
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(host.displayName)
                                            .font(.headline)
                                        Text(host.baseURL)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if selectedHostID == host.hostID {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.green)
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

                if store.pairedHosts.isEmpty == false {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Paired Hosts")
                            .font(.headline)

                        ForEach(store.pairedHosts) { host in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(host.displayName)
                                            .font(.subheadline.bold())
                                        Text(host.baseURL)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if store.pairedHost?.hostID == host.hostID {
                                        Text("Active")
                                            .font(.caption.bold())
                                            .foregroundStyle(.green)
                                    }
                                }

                                HStack(spacing: 8) {
                                    if store.pairedHost?.hostID != host.hostID {
                                        Button("Use This Host") {
                                            Task { await store.selectPairedHost(host.hostID) }
                                        }
                                        .buttonStyle(.bordered)
                                        .disabled(store.pairingState == .pairing)
                                    }

                                    Button(role: .destructive) {
                                        Task { await store.forgetPairedHost(host.hostID) }
                                    } label: {
                                        Label("Forget", systemImage: "trash")
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(store.pairingState == .pairing)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }

                TextField("Pairing PIN (optional)", text: $pin)
#if os(iOS)
                    .textInputAutocapitalization(.never)
#endif
                    .disableAutocorrection(true)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("magichat.pairing.pin")

                Button("Pair Selected Host") {
                    Task {
                        await store.pair(hostID: selectedHostID ?? "", pin: pin.isEmpty ? nil : pin)
                    }
                }
                .buttonStyle(.bordered)
                .disabled(store.pairingState == .pairing || store.discoveredHosts.isEmpty)
                .accessibilityIdentifier("magichat.pairing.selectedHost")

                Text("If no host is selected, pairing falls back to the first reachable Team App beacon.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let errorMessage = store.lastErrorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .accessibilityIdentifier("magichat.pairing.screen")
    }
}
