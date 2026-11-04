// swift-tools-version:5.9

import PackageDescription

// LiteRT-LM's repository is about 900 MB and needs Git LFS, so this takes its
// released library and a copy of its Swift wrapper (LiteRTLM/, v0.19.0,
// Apache-2.0) instead of depending on the repository.
let package = Package(
    name: "tauri-plugin-local-ai",
    platforms: [
        .iOS("17.0"),
    ],
    products: [
        .library(
            name: "tauri-plugin-local-ai",
            type: .static,
            targets: ["tauri-plugin-local-ai"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .binaryTarget(
            name: "CLiteRTLM",
            url: "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.19.0/CLiteRTLM.xcframework.zip",
            checksum: "b7b2450fc084058adc5185498f8b7810a9297e054a10cf55818b62e1d5f8d65d"),
        .target(
            name: "LiteRTLM",
            dependencies: ["CLiteRTLM"],
            path: "LiteRTLM",
            exclude: ["LICENSE"]),
        .target(
            name: "tauri-plugin-local-ai",
            dependencies: [
                .byName(name: "Tauri"),
                "LiteRTLM",
            ],
            path: "Sources")
    ]
)
