import Foundation
import SwiftUI

public struct StatusPanelView: View {
    @ObservedObject private var store: FeatureStore

    public init(store: FeatureStore) {
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Health + Results")
                    .font(.title3.bold())
                Spacer()
                Button("Refresh Now") {
                    Task { await store.refreshStatus() }
                }
                .buttonStyle(.bordered)
            }

            if let snapshot = store.statusSnapshot {
                HStack(spacing: 12) {
                    Label(snapshot.state.rawValue.capitalized, systemImage: icon(for: snapshot.state))
                        .font(.headline)
                    Spacer()
                    Text(snapshot.healthMessage ?? "No health warning")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                ProgressView(value: normalizedProgress(snapshot.progressPercent)) {
                    Text(progressLabel(for: snapshot.progressPercent))
                }

                Text("Updated: \(snapshot.updatedAt.formatted(date: .omitted, time: .standard))")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(snapshot.latestResult ?? "No result payload yet")
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                ContentUnavailableView(
                    "No Status Yet",
                    systemImage: "waveform.path.ecg",
                    description: Text("Switch to an active instance to inspect health, progress, and latest results.")
                )
            }
        }
        .padding()
    }

    private func icon(for state: TeamAppInstanceState) -> String {
        switch state {
        case .idle:
            return "pause.circle"
        case .running:
            return "bolt.circle"
        case .queued:
            return "clock"
        case .completed:
            return "checkmark.circle"
        case .failed:
            return "xmark.octagon"
        case .unknown:
            return "questionmark.circle"
        }
    }

    private func normalizedProgress(_ value: Double?) -> Double {
        guard let value else { return 0 }
        return min(max(value / 100.0, 0), 1)
    }

    private func progressLabel(for value: Double?) -> String {
        guard let value else {
            return "Progress unavailable"
        }

        return String(format: "Progress %.0f%%", value)
    }
}
