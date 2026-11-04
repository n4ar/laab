//! Chats the user keeps: all their history, and every photo, video and file,
//! stay on this device past the cache's limit. Works only while LAAB runs, and
//! carries on where it stopped the next time.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::state::AppState;

static RUNNING: AtomicBool = AtomicBool::new(false);

// ponytail: fixed pauses so a whole chat doesn't look like a burst to LINE;
// lower them only once a real account has shown it tolerates more.
const PAGE_PAUSE: Duration = Duration::from_secs(2);
const FILE_PAUSE: Duration = Duration::from_secs(1);

const MEDIA: [&str; 4] = ["IMAGE", "VIDEO", "AUDIO", "FILE"];

fn history_done_key(chat: &str) -> String {
    format!("kept_history_done:{chat}")
}

/// Start catching up, unless that is already happening.
pub fn kick(state: &Arc<AppState>) {
    if state.demo || RUNNING.swap(true, Ordering::Acquire) {
        return;
    }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        run(&state).await;
        RUNNING.store(false, Ordering::Release);
    });
}

/// A new photo or file in a kept chat.
pub fn message_arrived(state: &Arc<AppState>, chat: &str, content_type: &str) {
    if MEDIA.contains(&content_type) && state.store().kept_chats().unwrap_or_default().iter().any(|c| c == chat) {
        kick(state);
    }
}

async fn run(state: &Arc<AppState>) {
    let chats = state.store().kept_chats().unwrap_or_default();
    for chat in chats {
        if !history(state, &chat).await {
            return;
        }
        let media = state.store().kept_media(&chat).unwrap_or_default();
        for (id, content_type, file_name) in media {
            // The user may have stopped keeping it, or signed out, meanwhile.
            if state.line().await.is_none() {
                return;
            }
            match crate::media::keep(state, &chat, &id, &content_type, file_name).await {
                Ok(false) => continue,
                Ok(true) => {}
                // Expired or offline: tried again next time.
                Err(e) => tracing::warn!("keeping a file failed: {e}"),
            }
            tokio::time::sleep(FILE_PAUSE).await;
        }
    }
}

/// Page back to the start of the chat, once. False stops the run.
async fn history(state: &Arc<AppState>, chat: &str) -> bool {
    let key = history_done_key(chat);
    if matches!(state.store().get_kv(&key), Ok(Some(_))) {
        return true;
    }
    loop {
        match crate::line::fetch_older(state, chat).await {
            Ok(0) => {
                let _ = state.store().set_kv(&key, "1");
                state.messages_changed(chat);
                return true;
            }
            Ok(_) => tokio::time::sleep(PAGE_PAUSE).await,
            Err(e) => {
                tracing::warn!("keeping a chat's history stopped: {e}");
                return false;
            }
        }
    }
}
