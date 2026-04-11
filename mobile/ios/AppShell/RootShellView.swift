import SwiftUI

public struct RootShellView: View {
    @ObservedObject private var appState: AppState

    public init(appState: AppState) {
        self.appState = appState
    }

    public var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    Text(connectionLabel)
                    if let host = appState.activeHost {
                        Text("Host ID: \(host.hostID)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Restore") {
                    if let instanceID = appState.activeInstanceID {
                        Text("Instance: \(instanceID)")
                    } else {
                        Text("No active instance")
                    }

                    if let sessionID = appState.activeSessionID {
                        Text("Session: \(sessionID)")
                    } else {
                        Text("No session selected")
                    }
                }
            }
            .navigationTitle("MagicHat")
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .topBarTrailing, content: reconnectButton)
                #else
                ToolbarItem(placement: .automatic, content: reconnectButton)
                #endif
            }
        }
    }

    @ViewBuilder
    private func reconnectButton() -> some View {
        Button("Reconnect") {
            Task {
                await appState.refreshConnection()
            }
        }
    }

    private var connectionLabel: String {
        switch appState.connectionState {
        case .booting:
            return "Booting runtime"
        case .unpaired:
            return "Not paired"
        case .connected(let host):
            return "Connected to \(host)"
        case .failed(let message):
            return "Connection failed: \(message)"
        }
    }
}
