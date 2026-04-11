import SwiftUI

public struct MagicHatFeaturesRootView: View {
    @StateObject private var store: FeatureStore

    public init(runtime: any TeamAppRuntimeProviding) {
        _store = StateObject(wrappedValue: FeatureStore(runtime: runtime))
    }

    public var body: some View {
        TabView {
            NavigationStack {
                PairingView(store: store)
                    .navigationTitle("Pair")
            }
            .tabItem {
                Label("Pair", systemImage: "antenna.radiowaves.left.and.right")
            }

            NavigationStack {
                InstanceListView(store: store)
                    .navigationTitle("Instances")
            }
            .tabItem {
                Label("Instances", systemImage: "rectangle.stack")
            }

            NavigationStack {
                PromptComposerView(store: store)
                    .navigationTitle("Prompts")
            }
            .tabItem {
                Label("Prompts", systemImage: "bubble.left.and.bubble.right")
            }

            NavigationStack {
                StatusPanelView(store: store)
                    .navigationTitle("Status")
            }
            .tabItem {
                Label("Status", systemImage: "waveform.path.ecg")
            }

            NavigationStack {
                RestoreSessionView(store: store)
                    .navigationTitle("Restore")
            }
            .tabItem {
                Label("Restore", systemImage: "arrow.clockwise")
            }
        }
        .overlay(alignment: .top) {
            if let errorMessage = store.lastErrorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal)
                    .padding(.top, 6)
            }
        }
    }
}
