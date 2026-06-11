// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LoomKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "LoomKit", targets: ["LoomKit"]),
    ],
    targets: [
        .target(
            name: "LoomKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "LoomKitTests",
            dependencies: ["LoomKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
