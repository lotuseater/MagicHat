// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "MagicHatIOSSimSmoke",
    platforms: [
        .iOS(.v16),
        .macOS(.v12),
    ],
    products: [
        .library(name: "MagicHatIOSSimSmoke", targets: ["MagicHatIOSSimSmoke"]),
    ],
    targets: [
        .target(
            name: "MagicHatIOSSimSmoke",
            path: "Sources"
        ),
        .testTarget(
            name: "MagicHatIOSSimSmokeTests",
            dependencies: ["MagicHatIOSSimSmoke"],
            path: "Tests"
        ),
    ]
)
