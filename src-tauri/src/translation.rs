use tauri::AppHandle;

#[tauri::command]
pub async fn translate_quotation(
    app: AppHandle,
    text: Option<String>,
    language: Option<String>,
) -> Result<serde_json::Value, String> {
    if text
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1200)
    {
        return Err("Use a quotation of at most 1200 characters.".into());
    }
    if language.as_ref().is_some_and(|value| {
        value.len() > 16 || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }) {
        return Err("Choose a valid language.".into());
    }
    tauri::async_runtime::spawn_blocking(move || run(app, text, language))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
fn run(
    _app: AppHandle,
    _text: Option<String>,
    _language: Option<String>,
) -> Result<serde_json::Value, String> {
    Ok(
        serde_json::json!({"available": false, "languages": [], "text": null,
        "error": "Apple's built-in model is available only on compatible Macs. Enter your own translated text on this system."}),
    )
}

#[cfg(target_os = "macos")]
fn run(
    app: AppHandle,
    text: Option<String>,
    language: Option<String>,
) -> Result<serde_json::Value, String> {
    use std::{
        hash::{Hash, Hasher},
        io::{Read, Write},
        os::unix::fs::PermissionsExt,
        process::{Command, Stdio},
        sync::Mutex,
        time::{Duration, Instant},
    };
    use tauri::Manager;
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().map_err(|_| "Translation is unavailable")?;
    let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/verseglade-translate"));
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hash);
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("native-tools");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let helper = directory.join(format!("translate-{:x}", hash.finish()));
    if !helper.exists() {
        std::fs::write(&helper, bytes).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let mut child = Command::new(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let input = serde_json::json!({"text": text, "language": language});
    let write = child
        .stdin
        .take()
        .ok_or("Could not open translation input")?
        .write_all(input.to_string().as_bytes());
    if let Err(error) = write {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.to_string());
    }
    // Drain output while the process runs, avoiding pipe deadlock for longer translations.
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Could not read translation output")?;
    let reader = std::thread::spawn(move || {
        let mut output = String::new();
        stdout.read_to_string(&mut output).map(|_| output)
    });
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let output = reader
                .join()
                .map_err(|_| "Could not read translation")?
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Apple's on-device model could not start on this Mac.".into());
            }
            return serde_json::from_str(&output).map_err(|e| e.to_string());
        }
        if start.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("Translation timed out. Try a shorter quotation.".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}
