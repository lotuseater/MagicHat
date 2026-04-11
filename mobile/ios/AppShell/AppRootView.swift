import SwiftUI

public struct AppRootView: View {
    @StateObject private var store = AppSessionStore()

    @State private var pairingURI: String = ""
    @State private var pairingPin: String = ""
    @State private var promptText: String = ""
    @State private var followUpText: String = ""
    @State private var restoreSessionID: String = ""

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    headerSection
                    hostSection
                    instanceSection
                    promptSection
                    restoreSection
                }
                .padding(16)
            }
            .navigationTitle(LaunchAssets.appDisplayName)
            .task {
                await store.bootstrap()
            }
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(LaunchAssets.launchHeadline)
                .font(.headline)
            Text(LaunchAssets.launchSubtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let error = store.lastErrorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private var hostSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pair to Host")
                .font(.headline)

            TextField(
                "magichat://host:port?psk=...",
                text: Binding(
                    get: { pairingURI },
                    set: { newValue in pairingURI = newValue }
                )
            )
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            #endif
            .textFieldStyle(RoundedBorderTextFieldStyle())

            SecureField(
                "PIN / PSK (optional)",
                text: Binding(
                    get: { pairingPin },
                    set: { newValue in pairingPin = newValue }
                )
            )
            .textFieldStyle(RoundedBorderTextFieldStyle())

            HStack(spacing: 8) {
                Button("Register URI") {
                    Task {
                        let pinValue = pairingPin.trimmingCharacters(in: .whitespacesAndNewlines)
                        let normalizedPin = pinValue.isEmpty ? nil : pinValue
                        await store.registerPairingURI(pairingURI, pinOverride: normalizedPin)
                    }
                }
                .buttonStyle(.borderedProminent)

                Button("Refresh Hosts") {
                    Task { await store.refreshHosts() }
                }
                .buttonStyle(.bordered)
            }

            if store.hosts.isEmpty == false {
                Picker(
                    "Host",
                    selection: Binding(
                        get: { store.activeHostID ?? "" },
                        set: { selectedHostID in
                            Task {
                                if selectedHostID.isEmpty {
                                    return
                                }
                                await store.selectHost(selectedHostID)
                                let pinValue = pairingPin.trimmingCharacters(in: .whitespacesAndNewlines)
                                let normalizedPin = pinValue.isEmpty ? nil : pinValue
                                await store.pairSelectedHost(pin: normalizedPin)
                            }
                        }
                    )
                ) {
                    ForEach(store.hosts, id: \.id) { host in
                        Text(host.displayName + " (" + host.address + ")")
                            .tag(host.id)
                    }
                }
                .pickerStyle(.menu)

                HStack(spacing: 8) {
                    Button("Pair Selected") {
                        Task {
                            let pinValue = pairingPin.trimmingCharacters(in: .whitespacesAndNewlines)
                            let normalizedPin = pinValue.isEmpty ? nil : pinValue
                            await store.pairSelectedHost(pin: normalizedPin)
                        }
                    }
                    .buttonStyle(.bordered)

                    Button("Refresh Instances") {
                        Task { await store.refreshInstances() }
                    }
                    .buttonStyle(.bordered)

                    Button("Launch Instance") {
                        Task { await store.launchInstance() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private var instanceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Known Team App Instances")
                .font(.headline)

            if store.instances.isEmpty {
                Text("No active instances discovered yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.instances, id: \.id) { instance in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(instance.title)
                                .font(.subheadline.bold())
                            Spacer()
                            Text(instance.health.rawValue)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text(instance.resultPreview)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)

                        HStack(spacing: 8) {
                            Button(instance.active ? "Active" : "Switch") {
                                Task { await store.switchToInstance(instance.id) }
                            }
                            .buttonStyle(.bordered)
                            .disabled(instance.active)

                            Button("Close") {
                                Task { await store.closeInstance(instance.id) }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(12)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Prompt and Follow-Up")
                .font(.headline)

            TextField(
                "Send prompt to active instance",
                text: Binding(
                    get: { promptText },
                    set: { newValue in promptText = newValue }
                )
            )
            .textFieldStyle(RoundedBorderTextFieldStyle())

            Button("Send Prompt") {
                let text = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    return
                }
                Task {
                    await store.sendPrompt(text)
                    promptText = ""
                }
            }
            .buttonStyle(.bordered)

            TextField(
                "Send follow-up",
                text: Binding(
                    get: { followUpText },
                    set: { newValue in followUpText = newValue }
                )
            )
            .textFieldStyle(RoundedBorderTextFieldStyle())

            Button("Send Follow-Up") {
                let text = followUpText.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    return
                }
                Task {
                    await store.sendFollowUp(text)
                    followUpText = ""
                }
            }
            .buttonStyle(.bordered)
        }
    }

    private var restoreSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Restore Session")
                .font(.headline)

            if let snapshot = store.launchRestoreSnapshot {
                Text("Saved host " + snapshot.hostID + ", session " + snapshot.sessionID)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            TextField(
                "Session ID",
                text: Binding(
                    get: { restoreSessionID },
                    set: { newValue in restoreSessionID = newValue }
                )
            )
            .textFieldStyle(RoundedBorderTextFieldStyle())

            HStack(spacing: 8) {
                Button("Restore by ID") {
                    let sessionID = restoreSessionID.trimmingCharacters(in: .whitespacesAndNewlines)
                    if sessionID.isEmpty {
                        return
                    }
                    Task { await store.restoreSession(sessionID: sessionID) }
                }
                .buttonStyle(.borderedProminent)

                Button("Restore Last") {
                    Task { await store.restoreLastSessionIfAvailable() }
                }
                .buttonStyle(.bordered)
            }
        }
    }
}
