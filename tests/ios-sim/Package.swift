// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "MagicHatIOSSimSmoke",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    dependencies: [
        .package(path: "../../mobile/ios"),
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
            dependencies: [
                "MagicHatIOSSimSmoke",
                .product(name: "MagicHatIOSCore", package: "MagicHatIOSCore"),
            ],
            path: "Tests"
        ),
    ]
)
