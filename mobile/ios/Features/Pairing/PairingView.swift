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
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("PC Pairing")
                    .font(.title3.bold())
                Spacer()
                Text(store.pairingState.rawValue.capitalized)
                    .foregroundStyle(store.pairingState == .paired ? .green : .secondary)
            }

            HostContextCard(host: store.pairedHost, presence: store.activeHostPresence)

            TextField("magichat://pair?... or magichat://host:port?psk=...", text: $pairingURI)
#if os(iOS)
                .textInputAutocapitalization(.never)
#endif
                .disableAutocorrection(true)
                .textFieldStyle(.roundedBorder)

            Button("Pair From URI") {
                let rawURI = pairingURI
                pairingURI = ""
                Task {
                    await store.pairViaURI(rawURI, deviceName: "MagicHat iPhone")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.pairingState == .pairing || pairingURI.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Button("Discover Team App Hosts") {
                Task { await store.discoverHosts() }
            }
            .buttonStyle(.bordered)
            .disabled(store.pairingState == .pairing)

            if store.discoveredHosts.isEmpty {
                Text("Discover a LAN Team App host or paste a remote pairing URI to get started.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                List(store.discoveredHosts) { host in
                    Button {
                        selectedHostID = host.hostID
                    } label: {
                        HStack {
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
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
                .frame(minHeight: 120)
            }

            TextField("Pairing PIN (optional)", text: $pin)
#if os(iOS)
                .textInputAutocapitalization(.never)
#endif
                .disableAutocorrection(true)
                .textFieldStyle(.roundedBorder)

            Button("Pair Selected Host") {
                Task {
                    await store.pair(hostID: selectedHostID ?? "", pin: pin.isEmpty ? nil : pin)
                }
            }
            .buttonStyle(.bordered)
            .disabled(store.pairingState == .pairing || store.discoveredHosts.isEmpty)

            Text("If no host is selected, pairing falls back to the first reachable Team App beacon.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let errorMessage = store.lastErrorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .padding()
    }
}
