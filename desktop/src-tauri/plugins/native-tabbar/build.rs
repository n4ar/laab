// `update` and the listener commands are handled in Swift.
const COMMANDS: &[&str] = &["update", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
