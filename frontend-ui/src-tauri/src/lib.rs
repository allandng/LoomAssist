use std::{fs, panic, process::Command, sync::{Arc, Mutex}, thread, time::{SystemTime, UNIX_EPOCH, Duration}};
use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Listener, Manager, WindowEvent,
};

/// Local backend origin. 127.0.0.1 (not `localhost`) so Windows never tries
/// the IPv6 loopback first and stalls when uvicorn binds IPv4 only.
const BACKEND_BASE: &str = "http://127.0.0.1:8000";

// ── Phase v3.0: OS credential store (OAuth tokens / CalDAV passwords) ────────
//
// Slot format: `com.loomassist` service + `{kind}` account where kind is
// `supabase` or `connection.{uuid}`. Tokens NEVER touch SQLite or disk — only
// the platform store (Windows Credential Locker, macOS Keychain, Linux Secret
// Service — see the `keyring` features in Cargo.toml). The Python backend
// reads the same service/account pair through the `keyring` package.

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

// ── Text-to-speech (Future-features 2C: daily morning briefing) ──────────────
//
// Spawns and detaches the platform TTS engine; the frontend doesn't block on
// this. Never panics — every failure is returned as `Err(String)` so the UI can
// fall back to the Web Speech API.

/// Speak the given text with the platform's built-in speech engine.
#[tauri::command]
fn speak_briefing(text: String) -> Result<(), String> {
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Ok(());
    }
    spawn_tts(&text)
}

#[cfg(target_os = "windows")]
fn spawn_tts(text: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // Text travels through an environment variable so quoting can never break
    // the command line or inject script.
    let script = "Add-Type -AssemblyName System.Speech; \
                  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
                  $s.Speak($env:LOOM_SPEAK_TEXT); $s.Dispose()";
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
        .env("LOOM_SPEAK_TEXT", text)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("PowerShell speech synthesis unavailable: {e}"))
}

#[cfg(target_os = "macos")]
fn spawn_tts(text: &str) -> Result<(), String> {
    Command::new("say")
        .arg(text)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("`say` unavailable: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_tts(text: &str) -> Result<(), String> {
    // speech-dispatcher first (respects the user's configured voice), then
    // espeak-ng / espeak.
    for bin in ["spd-say", "espeak-ng", "espeak"] {
        if Command::new(bin).arg(text).spawn().is_ok() {
            return Ok(());
        }
    }
    Err("No speech engine found (install speech-dispatcher or espeak-ng)".to_owned())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
fn spawn_tts(_text: &str) -> Result<(), String> {
    Err("Speech synthesis is not supported on this platform".to_owned())
}

// ── Logging location ─────────────────────────────────────────────────────────

/// Tauri's per-platform log dir for this app id (Windows
/// `%LOCALAPPDATA%\<id>\logs`, macOS `~/Library/Logs/<id>`, Linux
/// `$XDG_DATA_HOME/<id>/logs`). Falls back to the OS temp dir.
fn loom_log_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("LoomAssist").join("logs"))
}

// ── Tray: next event ─────────────────────────────────────────────────────────

/// Parse an event `start_time` as the backend stores it.
///
/// The backend writes naive local ISO strings (`2026-04-25T09:00:00`). Those
/// are interpreted in the machine's local time zone; strings that carry an
/// explicit offset or `Z` are honoured as absolute instants.
fn parse_event_start(s: &str) -> Option<DateTime<Local>> {
    let s = s.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Local));
    }
    // Drop fractional seconds for the naive forms.
    let core = s.split('.').next().unwrap_or(s);
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(core, fmt) {
            let local = Local.from_local_datetime(&naive);
            return local.single().or_else(|| local.earliest());
        }
    }
    None
}

/// Fetch the title of the next upcoming event from the local backend.
fn fetch_next_event_title() -> String {
    match ureq::get(&format!("{BACKEND_BASE}/events/")).call() {
        Ok(response) => {
            if let Ok(body) = response.into_string() {
                if let Ok(events) = serde_json::from_str::<Vec<serde_json::Value>>(&body) {
                    let now = Local::now();
                    let mut upcoming: Vec<(DateTime<Local>, String)> = events
                        .iter()
                        .filter_map(|e| {
                            if !e["deleted_at"].is_null() {
                                return None; // soft-deleted
                            }
                            let start = e["start_time"].as_str()?;
                            let title = e["title"].as_str()?;
                            let dt = parse_event_start(start)?;
                            if dt > now { Some((dt, title.to_owned())) } else { None }
                        })
                        .collect();
                    upcoming.sort_by_key(|(t, _)| *t);
                    if let Some((ts, title)) = upcoming.first() {
                        let diff_mins = (*ts - now).num_minutes().max(0);
                        return if diff_mins < 60 {
                            format!("Next: {} in {}m", title, diff_mins)
                        } else {
                            format!("Next: {} at {}", title, ts.format("%H:%M"))
                        };
                    }
                }
            }
            "No upcoming events".to_owned()
        }
        Err(_) => "Backend offline".to_owned(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let log_dir = loom_log_dir(&handle);
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
            let open_item   = MenuItem::with_id(app, "open", "Open LoomAssist",     true,  None::<&str>)?;
            let quit_item   = MenuItem::with_id(app, "quit", "Quit",                true,  None::<&str>)?;

            let menu = Menu::with_items(app, &[&next_item, &pomo_item, &sep, &open_item, &quit_item])?;

            let next_clone = next_item.clone();
            let pomo_clone2 = pomo_item.clone();

            // Build tray
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("LoomAssist")
                .on_menu_event({
                    let handle3 = handle.clone();
                    move |_tray, event| {
                        match event.id().as_ref() {
                            "open" => {
                                if let Some(win) = handle3.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                }
                            }
                            "quit" => handle3.exit(0),
                            _ => {}
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder.build(app)?;

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
            keychain_set,
            keychain_get,
            keychain_delete,
            speak_briefing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
