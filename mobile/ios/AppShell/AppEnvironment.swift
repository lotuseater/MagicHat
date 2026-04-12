import Foundation

public struct AppEnvironment {
    public let runtime: TeamAppRuntimeProviding

    public init(runtime: TeamAppRuntimeProviding) {
        self.runtime = runtime
    }

    public static func live() -> AppEnvironment {
        let runtime = TeamAppRuntimeService(
            beaconDiscovery: HTTPBeaconDiscovery.default(),
            persistence: FileRuntimePersistence()
        ) { baseURL, accessToken in
            URLSessionHostAPIClient(baseURL: baseURL, accessToken: accessToken)
        }

        return AppEnvironment(runtime: runtime)
    }
}
