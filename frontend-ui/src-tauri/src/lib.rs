use std::{env, fs, panic, sync::{Arc, Mutex}, thread, time::{SystemTime, UNIX_EPOCH, Duration}};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager, WindowEvent,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ── Phase v3.0: macOS Keychain (OAuth tokens / CalDAV passwords) ────────────
//
// Slot format: `com.loomassist.{kind}` where kind is `supabase` or
// `connection.{uuid}`. Tokens NEVER touch SQLite or disk — only the Keychain.

const KEYCHAIN_SERVICE: &str = "com.loomassist";

#[tauri::command]
fn keychain_set(slot: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &slot).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(slot: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &slot).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keychain_delete(slot: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &slot).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn loom_log_dir() -> std::path::PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    std::path::Path::new(&home).join("Library/Logs/LoomAssist")
}

/// Fetch the title of the next upcoming event from the local backend.
fn fetch_next_event_title() -> String {
    match ureq::get("http://localhost:8000/events/").call() {
        Ok(response) => {
            if let Ok(body) = response.into_string() {
                if let Ok(events) = serde_json::from_str::<Vec<serde_json::Value>>(&body) {
                    let now_secs = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let mut upcoming: Vec<(u64, String)> = events
                        .iter()
                        .filter_map(|e| {
                            let start = e["start_time"].as_str()?;
                            let title = e["title"].as_str()?;
                            // Parse ISO datetime to seconds since epoch (simple approach)
                            let dt = chrono_or_simple_parse(start)?;
                            if dt > now_secs { Some((dt, title.to_owned())) } else { None }
                        })
                        .collect();
                    upcoming.sort_by_key(|(t, _)| *t);
                    if let Some((ts, title)) = upcoming.first() {
                        let diff_mins = (ts - now_secs) / 60;
                        return if diff_mins < 60 {
                            format!("Next: {} in {}m", title, diff_mins)
                        } else {
                            format!("Next: {}", title)
                        };
                    }
                }
            }
            "No upcoming events".to_owned()
        }
        Err(_) => "Backend offline".to_owned(),
    }
}

/// Very lightweight ISO 8601 datetime parser → Unix seconds (no external dep).
fn chrono_or_simple_parse(s: &str) -> Option<u64> {
    // Expect: YYYY-MM-DDTHH:MM:SS or similar
    let s = s.trim_end_matches('Z');
    let parts: Vec<&str> = s.split('T').collect();
    if parts.len() < 2 { return None; }
    let date_parts: Vec<u32> = parts[0].split('-')
        .filter_map(|p| p.parse().ok()).collect();
    let time_parts: Vec<u32> = parts[1][..8.min(parts[1].len())].split(':')
        .filter_map(|p| p.parse().ok()).collect();
    if date_parts.len() < 3 || time_parts.len() < 2 { return None; }
    let (y, m, d) = (date_parts[0] as i64, date_parts[1] as i64, date_parts[2] as i64);
    let (h, min) = (time_parts[0] as i64, time_parts[1] as i64);
    // Rough seconds-since-epoch (ignores leap seconds, good enough for ordering)
    let days = (y - 1970) * 365 + (y - 1969) / 4 + // rough leap years
        [0i64,31,59,90,120,151,181,212,243,273,304,334][(m-1) as usize] + (d - 1);
    Some((days * 86400 + h * 3600 + min * 60) as u64)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let log_dir = loom_log_dir();
            let _ = fs::create_dir_all(&log_dir);

            // Panic hook
            {
                let handle2 = handle.clone();
                let log_dir2 = log_dir.clone();
                panic::set_hook(Box::new(move |info| {
                    let msg = info.to_string();
                    let ts = SystemTime::now().duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs()).unwrap_or(0);
                    let path = log_dir2.join(format!("rust_panic_{}.log", ts));
                    let _ = fs::write(&path, format!("[{}] {}\n", ts, msg));
                    let _ = handle2.emit("rust-panic", serde_json::json!({ "message": msg }));
                }));
            }

            // ── Tray icon (Phase 11) ──────────────────────────────────────────
            let pomodoro_state: Arc<Mutex<String>> = Arc::new(Mutex::new("idle".to_owned()));
            let pomodoro_clone = Arc::clone(&pomodoro_state);

            // Listen for pomodoro state changes from the frontend
            {
                let ps = Arc::clone(&pomodoro_state);
                handle.listen("pomodoro-state-change", move |event| {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                        if let Some(state) = payload["state"].as_str() {
                            if let Ok(mut guard) = ps.lock() {
                                *guard = state.to_owned();
                            }
                        }
                    }
                });
            }

            // Build tray menu items
            let next_item   = MenuItem::with_id(app, "next", "No upcoming events", false, None::<&str>)?;
            let pomo_item   = MenuItem::with_id(app, "pomo", "Pomodoro: idle",      false, None::<&str>)?;
            let sep         = PredefinedMenuItem::separator(app)?;
            let open_item   = MenuItem::with_id(app, "open", "Open Loom",           true,  None::<&str>)?;
            let quit_item   = MenuItem::with_id(app, "quit", "Quit",                true,  None::<&str>)?;

            let menu = Menu::with_items(app, &[&next_item, &pomo_item, &sep, &open_item, &quit_item])?;

            let next_clone = next_item.clone();
            let pomo_clone2 = pomo_item.clone();

            // Build tray
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event({
                    let handle3 = handle.clone();
                    move |_tray, event| {
                        match event.id().as_ref() {
                            "open" => {
                                if let Some(win) = handle3.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                            "quit" => handle3.exit(0),
                            _ => {}
                        }
                    }
                })
                .build(app)?;

            // Background thread: poll every 60 seconds
            thread::spawn(move || {
                loop {
                    thread::sleep(Duration::from_secs(60));
                    let next_text = fetch_next_event_title();
                    let _ = next_clone.set_text(&next_text);

                    let pomo_text = {
                        let guard = pomodoro_clone.lock().unwrap_or_else(|e| e.into_inner());
                        format!("Pomodoro: {}", guard.clone())
                    };
                    let _ = pomo_clone2.set_text(&pomo_text);
                }
            });

            Ok(())
        })
        // Prevent close from quitting — hide window instead; Quit from tray exits
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            keychain_set,
            keychain_get,
            keychain_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
