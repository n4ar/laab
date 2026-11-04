//! A model that runs on the iPhone (Gemma, through LiteRT-LM), so a chat can be
//! summarized without its messages leaving the device. iOS only.

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_local_ai);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("local-ai")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_local_ai)?;
            Ok(())
        })
        .build()
}
