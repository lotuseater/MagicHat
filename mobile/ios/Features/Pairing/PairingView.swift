import SwiftUI

public struct PairingView: View {
    @ObservedObject private var store: FeatureStore
    @State private var selectedHostID: String?
    @State private var pin = ""

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

            if let paired = store.pairedHost {
                Text("Connected to: \(paired.displayName)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Button("Discover Team App Hosts") {
                Task { await store.discoverHosts() }
            }
            .buttonStyle(.borderedProminent)

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
            .disabled(store.pairingState == .pairing)

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
