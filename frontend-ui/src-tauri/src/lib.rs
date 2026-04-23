use std::{env, fs, panic, time::{SystemTime, UNIX_EPOCH}};
use tauri::Emitter;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn loom_log_dir() -> std::path::PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    std::path::Path::new(&home).join("Library/Logs/LoomAssist")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let log_dir = loom_log_dir();
            let _ = fs::create_dir_all(&log_dir);

            panic::set_hook(Box::new(move |info| {
                let msg = info.to_string();
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let path = log_dir.join(format!("rust_panic_{}.log", ts));
                let _ = fs::write(&path, format!("[{}] {}\n", ts, msg));
                let _ = handle.emit("rust-panic", serde_json::json!({ "message": msg }));
            }));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
