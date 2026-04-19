import SwiftUI

public enum MagicHatFeatureTab: Hashable {
    case pair
    case instances
    case prompts
    case status
    case restore
}

public struct MagicHatFeaturesRootView: View {
    @StateObject private var store: FeatureStore
    @State private var selectedTab: MagicHatFeatureTab
    private let bootstrapOnAppear: Bool

    public init(runtime: any TeamAppRuntimeProviding, selectedTab: MagicHatFeatureTab = .pair) {
        _store = StateObject(wrappedValue: FeatureStore(runtime: runtime))
        _selectedTab = State(initialValue: selectedTab)
        self.bootstrapOnAppear = true
    }

    public init(store: FeatureStore, selectedTab: MagicHatFeatureTab = .pair, bootstrapOnAppear: Bool = true) {
        _store = StateObject(wrappedValue: store)
        _selectedTab = State(initialValue: selectedTab)
        self.bootstrapOnAppear = bootstrapOnAppear
    }

    public var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                PairingView(store: store)
                    .navigationTitle("Pair")
                    .accessibilityIdentifier("magichat.tab.pair")
            }
            .tag(MagicHatFeatureTab.pair)
            .tabItem {
                Label("Pair", systemImage: "antenna.radiowaves.left.and.right")
            }

            NavigationStack {
                InstanceListView(store: store)
                    .navigationTitle("Instances")
                    .accessibilityIdentifier("magichat.tab.instances")
            }
            .tag(MagicHatFeatureTab.instances)
            .tabItem {
                Label("Instances", systemImage: "rectangle.stack")
            }

            NavigationStack {
                PromptComposerView(store: store)
                    .navigationTitle("Prompts")
                    .accessibilityIdentifier("magichat.tab.prompts")
            }
            .tag(MagicHatFeatureTab.prompts)
            .tabItem {
                Label("Prompts", systemImage: "bubble.left.and.bubble.right")
            }

            NavigationStack {
                StatusPanelView(store: store)
                    .navigationTitle("Status")
                    .accessibilityIdentifier("magichat.tab.status")
            }
            .tag(MagicHatFeatureTab.status)
            .tabItem {
                Label("Status", systemImage: "waveform.path.ecg")
            }

            NavigationStack {
                RestoreSessionView(store: store)
                    .navigationTitle("Restore")
                    .accessibilityIdentifier("magichat.tab.restore")
            }
            .tag(MagicHatFeatureTab.restore)
            .tabItem {
                Label("Restore", systemImage: "arrow.clockwise")
            }
        }
        .accessibilityIdentifier("magichat.root.tabs")
        .overlay(alignment: .top) {
            if let errorMessage = store.lastErrorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal)
                    .padding(.top, 6)
                    .accessibilityIdentifier("magichat.error.banner")
            }
        }
        .task {
            guard bootstrapOnAppear else {
                return
            }
            await store.bootstrap()
        }
    }
}
