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
                Text("\(host.transportLabel)\(presenceLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(host.endpointLabel)
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
                if host.canRunCommands == false {
                    Text("This host is offline right now. You can still manage pairings, but Team App commands are paused until it reconnects.")
                        .font(.footnote)
                        .foregroundStyle(.red)
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
        let label = host?.presenceDisplayLabel ?? presence?.replacingOccurrences(of: "_", with: " ")
        guard let label, label.isEmpty == false else { return "" }
        return " • \(label)"
    }
}
