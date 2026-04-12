// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "MagicHatIOSCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "MagicHatIOSCore",
            targets: ["MagicHatIOSCore"]
        ),
    ],
    targets: [
        .target(
            name: "MagicHatIOSCore",
            path: ".",
            exclude: [
                "Package.swift",
                "AppShell/MagicHatApp.swift",
                "Tests",
            ],
            sources: [
                "AppShell",
                "Features",
                "Runtime",
            ]
        ),
        .testTarget(
            name: "MagicHatIOSCoreTests",
            dependencies: ["MagicHatIOSCore"],
            path: "Tests/MagicHatIOSCoreTests"
        ),
    ]
)
