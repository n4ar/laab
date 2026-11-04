// All of these are handled in Swift.
const COMMANDS: &[&str] = &["status", "download", "summarize", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();

    // LiteRT-LM is a dynamic framework. The Xcode project embeds it for the app;
    // Rust links its own cdylib too, and needs to find it for that.
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        let slice = if target.ends_with("-sim") { "ios-arm64-simulator" } else { "ios-arm64" };
        let out = std::env::var("OUT_DIR").expect("OUT_DIR");
        println!(
            "cargo:rustc-link-search=framework={out}/swift-rs/tauri-plugin-local-ai/artifacts/ios/CLiteRTLM/CLiteRTLM.xcframework/{slice}"
        );
        println!("cargo:rustc-link-lib=framework=CLiteRTLM");
    }
}
