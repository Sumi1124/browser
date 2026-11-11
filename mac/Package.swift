// swift-tools-version:5.9
// Aster for Mac: a WebKit browser with built-in study tools.
import PackageDescription

let package = Package(
    name: "Aster",
    platforms: [.macOS(.v14)],
    targets: [
        // UI-free logic, unit-tested with `swift test`.
        .target(name: "AsterKit", path: "Sources/AsterKit"),
        .executableTarget(name: "Aster", dependencies: ["AsterKit"], path: "Sources/Aster"),
        .testTarget(name: "AsterKitTests", dependencies: ["AsterKit"], path: "Tests/AsterKitTests"),
    ]
)
