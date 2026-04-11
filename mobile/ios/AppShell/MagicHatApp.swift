import SwiftUI

@main
public struct MagicHatApp: App {
    private let environment = AppEnvironment.live()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            MagicHatFeaturesRootView(runtime: environment.runtime)
        }
    }
}
