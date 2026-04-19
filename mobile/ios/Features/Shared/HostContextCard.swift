import SwiftUI

public struct HostContextCard: View {
    private enum AccessibilityID {
        static let card = "magichat.hostContext.card"
        static let title = "magichat.hostContext.title"
        static let detail = "magichat.hostContext.detail"
        static let endpoint = "magichat.hostContext.endpoint"
        static let device = "magichat.hostContext.device"
        static let activeInstance = "magichat.hostContext.activeInstance"
        static let offlineMessage = "magichat.hostContext.offlineMessage"
        static let refresh = "magichat.hostContext.refresh"
    }

    private let host: HostBeacon?
    private let presence: String?
    private let activeInstanceID: String?
    private let onRefreshStatus: (() -> Void)?
    private let refreshEnabled: Bool

    public init(
        host: HostBeacon?,
        presence: String?,
        activeInstanceID: String? = nil,
        onRefreshStatus: (() -> Void)? = nil,
        refreshEnabled: Bool = true
    ) {
        self.host = host
        self.presence = presence
        self.activeInstanceID = activeInstanceID
        self.onRefreshStatus = onRefreshStatus
        self.refreshEnabled = refreshEnabled
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let host {
                Text(host.displayName)
                    .font(.headline)
                    .accessibilityIdentifier(AccessibilityID.title)
                Text("\(host.transportLabel)\(presenceLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(AccessibilityID.detail)
                Text(host.endpointLabel)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(AccessibilityID.endpoint)
                if let deviceID = host.deviceID, deviceID.isEmpty == false {
                    Text("Device: \(deviceID)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AccessibilityID.device)
                }
                if let activeInstanceID, activeInstanceID.isEmpty == false {
                    Text("Active instance: \(activeInstanceID)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AccessibilityID.activeInstance)
                }
                if host.canRunCommands == false {
                    Text("This host is offline right now. You can still manage pairings, but Team App commands are paused until it reconnects.")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier(AccessibilityID.offlineMessage)
                }
                if let onRefreshStatus {
                    Button("Check Host") {
                        onRefreshStatus()
                    }
                    .buttonStyle(.bordered)
                    .disabled(refreshEnabled == false)
                    .accessibilityIdentifier(AccessibilityID.refresh)
                }
            } else {
                Text("No host selected")
                    .font(.headline)
                    .accessibilityIdentifier(AccessibilityID.title)
                Text("Pair with or select a Team App host before launching, restoring, or sending prompts.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(AccessibilityID.detail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier(AccessibilityID.card)
    }

    private var presenceLabel: String {
        let label = host?.presenceDisplayLabel ?? presence?.replacingOccurrences(of: "_", with: " ")
        guard let label, label.isEmpty == false else { return "" }
        return " • \(label)"
    }
}
