import SwiftUI

public struct HostContextCard: View {
    private let host: HostBeacon?
    private let presence: String?
    private let activeInstanceID: String?

    public init(
        host: HostBeacon?,
        presence: String?,
        activeInstanceID: String? = nil
    ) {
        self.host = host
        self.presence = presence
        self.activeInstanceID = activeInstanceID
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let host {
                Text(host.displayName)
                    .font(.headline)
                Text("\(modeLabel(for: host))\(presenceLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(endpointLabel(for: host))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let deviceID = host.deviceID, deviceID.isEmpty == false {
                    Text("Device: \(deviceID)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let activeInstanceID, activeInstanceID.isEmpty == false {
                    Text("Active instance: \(activeInstanceID)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No host selected")
                    .font(.headline)
                Text("Pair with or select a Team App host before launching, restoring, or sending prompts.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var presenceLabel: String {
        guard let presence, presence.isEmpty == false else { return "" }
        return " • \(presence.replacingOccurrences(of: "_", with: " "))"
    }

    private func modeLabel(for host: HostBeacon) -> String {
        switch host.resolvedConnectionMode {
        case .remoteRelay:
            return "Remote relay"
        case .lanDirect:
            return "LAN direct"
        }
    }

    private func endpointLabel(for host: HostBeacon) -> String {
        switch host.resolvedConnectionMode {
        case .remoteRelay:
            return "Relay: \(host.baseURL)"
        case .lanDirect:
            return "Endpoint: \(host.baseURL)"
        }
    }
}
