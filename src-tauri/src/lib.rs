mod analysis;
mod displays;
mod translation;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{Local, Timelike};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};

const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;
static SCHEDULE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
struct DailySchedule {
    enabled: bool,
    hour: u8,
    minute: u8,
    image_paths: Vec<String>,
    next_index: usize,
    last_applied_day: Option<String>,
    #[serde(default)]
    interval_minutes: Option<u16>,
    #[serde(default)]
    next_due_at: Option<i64>,
    #[serde(default)]
    display_paths: Vec<std::collections::BTreeMap<String, String>>,
}

impl Default for DailySchedule {
    fn default() -> Self {
        Self {
            enabled: false,
            hour: 8,
            minute: 0,
            image_paths: Vec::new(),
            next_index: 0,
            last_applied_day: None,
            interval_minutes: None,
            next_due_at: None,
            display_paths: Vec::new(),
        }
    }
}

#[derive(Serialize)]
struct ScheduleStatus {
    interval_minutes: Option<u16>,
    enabled: bool,
    hour: u8,
    minute: u8,
}

#[derive(Serialize)]
struct BuiltInWallpaper {
    id: String,
    name: String,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn schedule_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("schedule.json"))
}

fn read_schedule(app: &AppHandle) -> Result<DailySchedule, String> {
    let path = schedule_path(app)?;
    if !path.exists() {
        return Ok(DailySchedule::default());
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn write_schedule(app: &AppHandle, schedule: &DailySchedule) -> Result<(), String> {
    let path = schedule_path(app)?;
    let contents = serde_json::to_vec_pretty(schedule).map_err(|error| error.to_string())?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary_path, path).map_err(|error| error.to_string())
}

fn decode_image(data_url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let (encoded, extension) = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .map(|encoded| (encoded, "jpg"))
        .or_else(|| {
            data_url
                .strip_prefix("data:image/png;base64,")
                .map(|encoded| (encoded, "png"))
        })
        .ok_or_else(|| "Expected a JPEG or PNG data URL".to_string())?;
    if encoded.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err("Rendered image exceeds the 24 MB limit".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Rendered image exceeds the 24 MB limit".into());
    }
    let valid = match extension {
        "jpg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        _ => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
    };
    if !valid {
        return Err("Image data does not match its file format".into());
    }
    Ok((bytes, extension))
}

fn save_wallpaper_image(dir: &Path, name: &str, data_url: &str) -> Result<PathBuf, String> {
    let (bytes, extension) = decode_image(data_url)?;
    let path = dir.join(format!("{name}.{extension}"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

#[cfg(target_os = "macos")]
fn current_wallpaper_path() -> Result<PathBuf, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWorkspace};

    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| "Wallpaper access must run on the main thread".to_string())?;
    let screen = NSScreen::mainScreen(main_thread)
        .ok_or_else(|| "macOS did not report a main display".to_string())?;
    let url = NSWorkspace::sharedWorkspace()
        .desktopImageURLForScreen(&screen)
        .ok_or_else(|| "macOS did not report a wallpaper image for the main display".to_string())?;
    let path = url
        .path()
        .ok_or_else(|| "The current wallpaper URL has no local file path".to_string())?;
    Ok(PathBuf::from(path.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn current_wallpaper_path() -> Result<PathBuf, String> {
    wallpaper::get()
        .map(PathBuf::from)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn current_wallpaper_path_on_main_thread(app: &AppHandle) -> Result<PathBuf, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(current_wallpaper_path());
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|error| format!("Timed out reading the current macOS wallpaper: {error}"))?
}

fn wallpaper_source_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/System/Library/Wallpapers/.default"),
            PathBuf::from("/System/Library/Desktop Pictures/.wallpapers"),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        vec![
            PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
                .join("Web"),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec![
            PathBuf::from("/usr/share/backgrounds"),
            PathBuf::from("/usr/share/wallpapers"),
            PathBuf::from("/usr/share/xfce4/backdrops"),
        ]
    }
}

#[cfg(target_os = "macos")]
fn wallpaper_user_data_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find the current user's home folder".to_string())?;
    Ok(home.join("Library/Application Support/com.apple.wallpaper"))
}

#[cfg(target_os = "macos")]
fn active_aerial_path(asset_id: &str) -> Result<PathBuf, String> {
    let wallpaper_data = wallpaper_user_data_dir()?;
    let manifest_path = wallpaper_data.join("aerials/manifest/entries.json");
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
            format!("Could not read the installed Mac wallpaper catalog: {error}")
        })?)
        .map_err(|error| format!("Could not parse the installed Mac wallpaper catalog: {error}"))?;
    let assets = manifest
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "The installed Mac wallpaper catalog has no assets".to_string())?;

    let desired_appearance = Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|value| value == "dark" || value == "light")
        .unwrap_or_else(|| "light".to_string());

    let mut choices: Vec<(bool, bool, String)> = assets
        .iter()
        .filter(|asset| {
            asset.get("id").and_then(serde_json::Value::as_str) == Some(asset_id)
                || asset
                    .get("subcategories")
                    .and_then(serde_json::Value::as_array)
                    .map(|categories| {
                        categories
                            .iter()
                            .any(|category| category.as_str() == Some(asset_id))
                    })
                    .unwrap_or(false)
        })
        .filter_map(|asset| {
            let id = asset.get("id")?.as_str()?.to_string();
            let variant = asset.get("variant");
            let landscape = variant
                .and_then(|value| value.get("orientation"))
                .and_then(serde_json::Value::as_str)
                .map(|value| value == "landscape")
                .unwrap_or(false);
            let appearance = variant
                .and_then(|value| value.get("appearance"))
                .and_then(serde_json::Value::as_str)
                .map(|value| value == desired_appearance)
                .unwrap_or(false);
            Some((landscape, appearance, id))
        })
        .collect();
    choices.sort_by_key(|(landscape, appearance, _)| (!*landscape, !*appearance));

    for (_, _, id) in choices {
        let video = wallpaper_data.join(format!("aerials/videos/{id}.mov"));
        if video.is_file() {
            return Ok(video);
        }
    }
    Err(format!(
        "The selected Mac wallpaper is not available locally yet (asset {asset_id})"
    ))
}

#[cfg(target_os = "macos")]
fn active_wallpaper_source_from_index(wallpaper_data: &Path, app_data: &Path) -> Option<PathBuf> {
    let index_path = wallpaper_data.join("Store/Index.plist");
    let index = plist::Value::from_file(index_path).ok()?;
    let displays = index.as_dictionary()?.get("Displays")?.as_dictionary()?;
    let mut sources = Vec::new();
    for display in displays.values() {
        let Some(desktop) = display
            .as_dictionary()
            .and_then(|display| display.get("Desktop"))
            .and_then(plist::Value::as_dictionary)
        else {
            continue;
        };
        let last_use = desktop
            .get("LastUse")
            .and_then(plist::Value::as_date)
            .map(|date| date.to_xml_format())
            .unwrap_or_default();
        let Some(choice) = desktop
            .get("Content")
            .and_then(plist::Value::as_dictionary)
            .and_then(|content| content.get("Choices"))
            .and_then(plist::Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(plist::Value::as_dictionary)
        else {
            continue;
        };
        let provider = choice
            .get("Provider")
            .and_then(plist::Value::as_string)
            .unwrap_or_default();
        let Some(configuration) = choice
            .get("Configuration")
            .and_then(plist::Value::as_data)
            .and_then(|data| plist::Value::from_reader(Cursor::new(data)).ok())
        else {
            continue;
        };
        let Some(configuration) = configuration.as_dictionary() else {
            continue;
        };

        if provider == "com.apple.wallpaper.choice.aerials" {
            if let Some(asset_id) = configuration
                .get("assetID")
                .and_then(plist::Value::as_string)
            {
                if let Ok(path) = active_aerial_path(asset_id) {
                    sources.push((last_use.clone(), path));
                }
            }
        } else if provider == "com.apple.wallpaper.choice.image" {
            if let Some(source) = configuration
                .get("url")
                .and_then(plist::Value::as_dictionary)
                .and_then(|url| url.get("relative"))
                .and_then(plist::Value::as_string)
                .and_then(|url| url::Url::parse(url).ok())
                .and_then(|url| url.to_file_path().ok())
            {
                let is_verseglade_output = source.starts_with(app_data);
                if source.is_file() && !is_verseglade_output {
                    sources.push((last_use, source));
                }
            }
        }
    }

    sources.sort_by(|left, right| right.0.cmp(&left.0));
    sources.into_iter().next().map(|(_, path)| path)
}

#[cfg(target_os = "macos")]
fn active_wallpaper_source(app: &AppHandle) -> Result<PathBuf, String> {
    let wallpaper_data = wallpaper_user_data_dir()?;
    let app_data = app_data_dir(app)?;
    if let Some(path) = active_wallpaper_source_from_index(&wallpaper_data, &app_data) {
        return Ok(path);
    }
    current_wallpaper_path_on_main_thread(app)
}

fn collect_wallpaper_sources(root: &Path, depth: u8, sources: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_wallpaper_sources(&path, depth + 1, sources);
            continue;
        }
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(extension.as_str(), "heic" | "jpg" | "jpeg" | "png" | "mov") {
            sources.push(path);
        }
    }
}

fn resolve_builtin_wallpaper(id: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(id)
        .canonicalize()
        .map_err(|error| format!("Could not access that built-in wallpaper: {error}"))?;
    let allowed = wallpaper_source_roots().iter().any(|root| {
        root.canonicalize()
            .map(|root| path.starts_with(root))
            .unwrap_or(false)
    });
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !allowed || !matches!(extension.as_str(), "heic" | "jpg" | "jpeg" | "png" | "mov") {
        return Err("Choose a wallpaper from the installed system wallpaper folders".into());
    }
    Ok(path)
}

#[tauri::command]
fn list_builtin_wallpapers() -> Vec<BuiltInWallpaper> {
    let mut paths = Vec::new();
    for root in wallpaper_source_roots() {
        collect_wallpaper_sources(&root, 0, &mut paths);
    }
    paths.sort();
    paths.dedup();
    paths
        .into_iter()
        .filter_map(|path| {
            let id = path.canonicalize().ok()?.to_string_lossy().into_owned();
            let name = path.file_stem()?.to_string_lossy().replace('_', " ");
            Some(BuiltInWallpaper { id, name })
        })
        .collect()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_builtin_wallpaper(
    app: AppHandle,
    id: String,
    thumbnail: Option<bool>,
) -> Result<String, String> {
    let source = if id == "current" {
        active_wallpaper_source(&app)?
    } else {
        resolve_builtin_wallpaper(&id)?
    };
    let dir = app_data_dir(&app)?.join("wallpaper-previews");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let destination = dir.join(format!("{}.jpg", Local::now().timestamp_millis()));
    let extension = source
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension == "mov" {
        let quicklook_dir = dir.join(format!("quicklook-{}", Local::now().timestamp_millis()));
        fs::create_dir_all(&quicklook_dir).map_err(|error| error.to_string())?;
        let output = Command::new("qlmanage")
            .args(["-t", "-s", "4096", "-o"])
            .arg(&quicklook_dir)
            .arg(&source)
            .output()
            .map_err(|error| format!("Could not create a wallpaper preview: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!(
                "Could not preview this dynamic wallpaper. {detail}"
            ));
        }
        let poster = fs::read_dir(&quicklook_dir)
            .map_err(|error| error.to_string())?
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.is_file())
            .ok_or_else(|| "macOS did not create a wallpaper preview".to_string())?;
        let conversion = Command::new("sips")
            .args(["-s", "format", "jpeg", "-s", "formatOptions", "97"])
            .arg(poster)
            .arg("--out")
            .arg(&destination)
            .output()
            .map_err(|error| format!("Could not convert the wallpaper preview: {error}"))?;
        if !conversion.status.success() {
            return Err(format!(
                "Could not convert the wallpaper preview: {}",
                String::from_utf8_lossy(&conversion.stderr).trim()
            ));
        }
        fs::remove_dir_all(quicklook_dir).map_err(|error| error.to_string())?;
    } else {
        let conversion = Command::new("sips")
            .args(["-s", "format", "jpeg", "-s", "formatOptions", "97"])
            .arg(&source)
            .arg("--out")
            .arg(&destination)
            .output()
            .map_err(|error| format!("Could not convert this wallpaper: {error}"))?;
        if !conversion.status.success() {
            return Err(format!(
                "Could not convert this wallpaper: {}",
                String::from_utf8_lossy(&conversion.stderr).trim()
            ));
        }
    }

    if thumbnail.unwrap_or(false) {
        let status = Command::new("sips")
            .args(["-Z", "480"])
            .arg(&destination)
            .output()
            .map_err(|error| error.to_string())?;
        if !status.status.success() {
            return Err("Could not resize the wallpaper thumbnail".into());
        }
    }
    let bytes = fs::read(destination).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Wallpaper preview exceeds the 24 MB limit".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_builtin_wallpaper(
    _app: AppHandle,
    id: String,
    _thumbnail: Option<bool>,
) -> Result<String, String> {
    let source = resolve_builtin_wallpaper(&id)?;
    let size = fs::metadata(&source)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_IMAGE_BYTES as u64 {
        return Err("Wallpaper exceeds the 24 MB limit".into());
    }
    let mime = mime_guess::from_path(&source).first_or_octet_stream();
    if !mime.essence_str().starts_with("image/") {
        return Err(
            "This wallpaper format cannot be previewed here. Choose an image file instead.".into(),
        );
    }
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[tauri::command]
async fn get_current_wallpaper(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let app_for_main = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            get_builtin_wallpaper(app_for_main, "current".to_string(), None)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let path = current_wallpaper_path()?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();

        if bytes.len() > MAX_IMAGE_BYTES {
            return Err("Current wallpaper exceeds the 24 MB preview limit".into());
        }
        if !mime.starts_with("image/") {
            return Err("Current wallpaper uses an unsupported image format".into());
        }
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }
}

#[cfg(target_os = "macos")]
fn set_wallpaper_native_target(path: &Path, display_id: Option<&str>) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWorkspace, NSWorkspaceDesktopImageOptionKey};
    use objc2_foundation::{NSDictionary, NSString, NSURL};

    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| "Wallpaper access must run on the main thread".to_string())?;
    let workspace = NSWorkspace::sharedWorkspace();
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let options = NSDictionary::<NSWorkspaceDesktopImageOptionKey, AnyObject>::dictionary();
    let mut applied = false;
    for screen in NSScreen::screens(main_thread).iter() {
        if display_id.is_some_and(|id| displays::screen_id(&screen).as_deref() != Ok(id)) {
            continue;
        }
        applied = true;
        unsafe {
            workspace
                .setDesktopImageURL_forScreen_options_error(&url, &screen, &options)
                .map_err(|error| format!("macOS could not set the wallpaper: {error:?}"))?;
        }
    }
    if !applied {
        return Err("The selected display is disconnected".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_wallpaper_native(path: &Path) -> Result<(), String> {
    set_wallpaper_native_target(path, None)
}

#[cfg(not(target_os = "macos"))]
fn set_wallpaper_native(path: &Path) -> Result<(), String> {
    wallpaper::set_from_path(path.to_str().ok_or("Invalid wallpaper path")?)
        .map_err(|error| error.to_string())
}

fn set_wallpaper_on_main_thread(app: &AppHandle, path: PathBuf) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(set_wallpaper_native(&path));
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(15))
        .map_err(|error| format!("Timed out applying the wallpaper: {error}"))?
}

fn apply_display_paths(
    app: &AppHandle,
    paths: std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let result = (|| {
            let marker = objc2::MainThreadMarker::new()
                .ok_or("Display access requires the main thread".to_string())?;
            let connected = objc2_app_kit::NSScreen::screens(marker)
                .iter()
                .filter_map(|screen| displays::screen_id(&screen).ok())
                .collect::<Vec<_>>();
            paths
                .iter()
                .filter(|(id, _)| connected.contains(id))
                .try_for_each(|(id, path)| set_wallpaper_native_target(Path::new(path), Some(id)))
        })();
        #[cfg(not(target_os = "macos"))]
        let result = paths
            .values()
            .next()
            .ok_or("No wallpaper was prepared".to_string())
            .and_then(|path| set_wallpaper_native(Path::new(path)));
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_display_wallpaper(
    app: AppHandle,
    display_id: String,
    image_data_url: String,
) -> Result<(), String> {
    if display_id.is_empty() || !display_id.bytes().all(|c| c.is_ascii_digit()) {
        return Err("Invalid display".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app_data_dir(&app)?;
        let name = format!("display-{display_id}-{}", Local::now().timestamp_millis());
        let path = save_wallpaper_image(&dir, &name, &image_data_url)?;
        apply_display_paths(
            &app,
            [(display_id, path.to_string_lossy().into_owned())]
                .into_iter()
                .collect(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn analyze_wallpaper(image_data_url: String) -> Result<analysis::Analysis, String> {
    if image_data_url.len() > 512 * 1024 {
        return Err("Use a small image thumbnail for analysis".into());
    }
    let (bytes, _) = decode_image(&image_data_url)?;
    tauri::async_runtime::spawn_blocking(move || analysis::analyze(&bytes))
        .await
        .map_err(|e| e.to_string())?
}

fn draft_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 40 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid schedule draft".into());
    }
    Ok(app_data_dir(app)?.join("schedule-images").join(id))
}

#[tauri::command]
fn begin_schedule(app: AppHandle) -> Result<String, String> {
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .to_string();
    fs::create_dir_all(draft_dir(&app, &id)?).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
async fn append_schedule_image(
    app: AppHandle,
    draft_id: String,
    index: usize,
    display_id: Option<String>,
    image_data_url: String,
) -> Result<(), String> {
    if index >= 128 {
        return Err("A rotation supports up to 128 wallpapers".into());
    }
    let dir = draft_dir(&app, &draft_id)?;
    if !dir.is_dir() {
        return Err("Schedule draft no longer exists".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
        if read_schedule(&app)?
            .image_paths
            .iter()
            .any(|p| Path::new(p).starts_with(&dir))
        {
            return Err("This rotation has already been published".into());
        }
        let name = match display_id {
            Some(id)
                if !id.is_empty() && id.len() <= 16 && id.bytes().all(|c| c.is_ascii_digit()) =>
            {
                format!("quote-{index:02}-display-{id}")
            }
            Some(_) => return Err("Invalid display".into()),
            None => format!("quote-{index:02}"),
        };
        save_wallpaper_image(&dir, &name, &image_data_url).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

type DisplayRotation = Vec<std::collections::BTreeMap<String, String>>;
fn collect_rotation_paths(
    dir: &Path,
    count: usize,
    ids: &[String],
) -> Result<(Vec<String>, DisplayRotation), String> {
    let mut image_paths = Vec::with_capacity(count);
    let mut display_paths = Vec::new();
    for index in 0..count {
        let mut paths = std::collections::BTreeMap::new();
        for id in if ids.is_empty() {
            vec![None]
        } else {
            ids.iter().map(Some).collect()
        } {
            let name = id.map_or_else(
                || format!("quote-{index:02}"),
                |id| format!("quote-{index:02}-display-{id}"),
            );
            let jpeg = dir.join(format!("{name}.jpg"));
            let png = dir.join(format!("{name}.png"));
            let path = if jpeg.is_file() {
                jpeg
            } else if png.is_file() {
                png
            } else {
                return Err("The wallpaper rotation is incomplete".into());
            };
            let path = path.to_string_lossy().into_owned();
            if let Some(id) = id {
                paths.insert(id.clone(), path.clone());
            }
            if id.is_none() || image_paths.len() == index {
                image_paths.push(path);
            }
        }
        if !ids.is_empty() {
            display_paths.push(paths);
        }
    }
    Ok((image_paths, display_paths))
}

#[tauri::command]
async fn commit_schedule(
    app: AppHandle,
    draft_id: String,
    count: usize,
    interval_minutes: Option<u16>,
    display_ids: Option<Vec<String>>,
    hour: u8,
    minute: u8,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
        if hour > 23 || minute > 59 || count == 0 || count > 128 {
            return Err("Choose a valid time and a rotation of 1–128 wallpapers".into());
        }
        if interval_minutes.is_some_and(|value| ![1, 5, 15, 30, 60, 120].contains(&value)) {
            return Err("Choose a supported rotation interval".into());
        }
        let dir = draft_dir(&app, &draft_id)?;
        let ids = display_ids.unwrap_or_default();
        if ids.len() > 16
            || ids
                .iter()
                .any(|id| id.is_empty() || id.len() > 16 || !id.bytes().all(|c| c.is_ascii_digit()))
        {
            return Err("Invalid display list".into());
        }
        let (image_paths, display_paths) = collect_rotation_paths(&dir, count, &ids)?;
        // Publish only after all files are ready; the previous schedule stays intact on failure.
        write_schedule(
            &app,
            &DailySchedule {
                enabled: true,
                hour,
                minute,
                image_paths,
                next_index: 0,
                last_applied_day: None,
                interval_minutes,
                display_paths,
                next_due_at: interval_minutes
                    .map(|minutes| Local::now().timestamp() + i64::from(minutes) * 60),
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cancel_schedule(app: AppHandle, draft_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
        let dir = draft_dir(&app, &draft_id)?;
        if read_schedule(&app)?
            .image_paths
            .iter()
            .any(|p| Path::new(p).starts_with(&dir))
        {
            return Err("Cannot remove the active rotation".into());
        }
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_wallpaper(app: AppHandle, image_data_url: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let filename = format!("wallpaper-{}", Local::now().timestamp_millis());
    let image_path = save_wallpaper_image(&dir, &filename, &image_data_url)?;
    let app_for_main = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        set_wallpaper_on_main_thread(&app_for_main, image_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_daily_schedule(
    app: AppHandle,
    images: Vec<String>,
    hour: u8,
    minute: u8,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
        if hour > 23 || minute > 59 {
            return Err("Choose a valid local time".into());
        }
        if images.is_empty() || images.len() > 32 {
            return Err("The schedule must contain between 1 and 32 quote wallpapers".into());
        }
        let dir = app_data_dir(&app)?
            .join("schedule-images")
            .join(Local::now().timestamp_millis().to_string());
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let mut image_paths = Vec::with_capacity(images.len());
        for (index, data_url) in images.iter().enumerate() {
            let path = save_wallpaper_image(&dir, &format!("quote-{index:02}"), data_url)?;
            image_paths.push(path.to_string_lossy().into_owned());
        }
        write_schedule(
            &app,
            &DailySchedule {
                enabled: true,
                hour,
                minute,
                image_paths,
                next_index: 0,
                last_applied_day: None,
                interval_minutes: None,
                next_due_at: None,
                display_paths: Vec::new(),
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn disable_daily_schedule(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut schedule = read_schedule(&app)?;
        schedule.enabled = false;
        write_schedule(&app, &schedule)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_schedule_status(app: AppHandle) -> Result<ScheduleStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
        let schedule = read_schedule(&app)?;
        Ok(ScheduleStatus {
            interval_minutes: schedule.interval_minutes,
            enabled: schedule.enabled,
            hour: schedule.hour,
            minute: schedule.minute,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn schedule_is_due(schedule: &DailySchedule, now: chrono::DateTime<chrono::FixedOffset>) -> bool {
    if !schedule.enabled || schedule.image_paths.is_empty() {
        return false;
    }
    if let Some(minutes) = schedule.interval_minutes {
        return minutes > 0
            && schedule
                .next_due_at
                .is_none_or(|deadline| now.timestamp() >= deadline);
    }
    let today = now.format("%Y-%m-%d").to_string();
    schedule.enabled
        && !schedule.image_paths.is_empty()
        && (now.hour(), now.minute()) >= (u32::from(schedule.hour), u32::from(schedule.minute))
        && schedule.last_applied_day.as_deref() != Some(&today)
}

fn apply_due_schedule(app: &AppHandle) -> Result<(), String> {
    let _guard = SCHEDULE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut schedule = read_schedule(app)?;
    let now = Local::now();
    if !schedule_is_due(&schedule, now.fixed_offset()) {
        return Ok(());
    }
    let index = schedule.next_index % schedule.image_paths.len();
    if let Some(paths) = schedule.display_paths.get(index) {
        apply_display_paths(app, paths.clone())?;
    } else {
        set_wallpaper_on_main_thread(app, PathBuf::from(&schedule.image_paths[index]))?;
    }
    schedule.next_index = (index + 1) % schedule.image_paths.len();
    if let Some(minutes) = schedule.interval_minutes {
        schedule.next_due_at = Some(now.timestamp() + i64::from(minutes) * 60);
    }
    schedule.last_applied_day = Some(now.format("%Y-%m-%d").to_string());
    write_schedule(app, &schedule)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            eprintln!("Could not show main window: {error}");
        } else if let Err(error) = window.set_focus() {
            eprintln!("Could not focus main window: {error}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            analyze_wallpaper,
            displays::list_wallpaper_displays,
            apply_display_wallpaper,
            translation::translate_quotation,
            begin_schedule,
            append_schedule_image,
            commit_schedule,
            cancel_schedule,
            get_current_wallpaper,
            list_builtin_wallpapers,
            get_builtin_wallpaper,
            apply_wallpaper,
            save_daily_schedule,
            disable_daily_schedule,
            get_schedule_status
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Open Verseglade", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;
            let icon = app
                .default_window_icon()
                .ok_or("Missing application icon")?
                .clone();
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Verseglade")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let close_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Err(error) = close_window.hide() {
                            eprintln!("Could not hide main window: {error}");
                        }
                    }
                });
            }

            let schedule_app = app.handle().clone();
            thread::spawn(move || loop {
                if let Err(error) = apply_due_schedule(&schedule_app) {
                    eprintln!("Scheduled wallpaper change failed: {error}");
                }
                thread::sleep(Duration::from_secs(5));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{list_builtin_wallpapers, resolve_builtin_wallpaper};

    #[test]
    fn lists_the_installed_golden_gate_wallpaper() {
        assert!(list_builtin_wallpapers()
            .iter()
            .any(|wallpaper| wallpaper.name == "Golden Gate"));
    }

    #[test]
    fn resolves_the_installed_golden_gate_wallpaper() {
        let golden_gate = list_builtin_wallpapers()
            .into_iter()
            .find(|wallpaper| wallpaper.name == "Golden Gate")
            .expect("Golden Gate wallpaper should be installed");

        assert!(resolve_builtin_wallpaper(&golden_gate.id).is_ok());
    }
}

#[cfg(test)]
mod schedule_tests {
    use super::{decode_image, schedule_is_due, DailySchedule};
    fn time(value: &str) -> chrono::DateTime<chrono::FixedOffset> {
        chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M")
            .unwrap()
            .and_utc()
            .fixed_offset()
    }
    fn schedule() -> DailySchedule {
        DailySchedule {
            enabled: true,
            image_paths: vec!["wallpaper.jpg".into()],
            ..Default::default()
        }
    }
    #[test]
    fn default_time_is_eight_and_rotation_waits_until_deadline() {
        let s = schedule();
        assert_eq!((s.hour, s.minute), (8, 0));
        assert!(!schedule_is_due(&s, time("2026-10-03 07:59")));
        assert!(schedule_is_due(&s, time("2026-10-03 08:00")));
    }
    #[test]
    fn rotation_applies_once_per_day_and_catches_up_after_restart() {
        let mut s = schedule();
        assert!(schedule_is_due(&s, time("2026-10-03 23:59")));
        s.last_applied_day = Some("2026-10-03".into());
        assert!(!schedule_is_due(&s, time("2026-10-03 23:59")));
        assert!(!schedule_is_due(&s, time("2026-10-04 00:00")));
        assert!(schedule_is_due(&s, time("2026-10-05 12:00")));
        s.enabled = false;
        assert!(!schedule_is_due(&s, time("2026-10-05 12:00")));
    }
    #[test]
    fn intervals_wait_for_deadline_and_catch_up_once_after_sleep() {
        for minutes in [1, 5, 15, 30, 60, 120] {
            let mut s = schedule();
            s.interval_minutes = Some(minutes);
            let start = time("2026-10-03 08:00");
            s.next_due_at = Some(start.timestamp() + i64::from(minutes) * 60);
            assert!(!schedule_is_due(&s, start));
            let deadline = start + chrono::Duration::minutes(i64::from(minutes));
            assert!(schedule_is_due(&s, deadline));
            let wake = deadline + chrono::Duration::hours(8);
            assert!(schedule_is_due(&s, wake));
            s.next_due_at = Some(wake.timestamp() + i64::from(minutes) * 60);
            assert!(!schedule_is_due(&s, wake));
            s.enabled = false;
            assert!(!schedule_is_due(&s, wake + chrono::Duration::hours(24)));
        }
    }
    #[test]
    fn rotation_requires_each_display_image_and_preserves_target_mapping() {
        let dir = std::env::temp_dir().join(format!(
            "verseglade-displays-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let ids = vec!["1".to_string(), "2".to_string()];
        std::fs::write(dir.join("quote-00-display-1.jpg"), b"test").unwrap();
        assert!(super::collect_rotation_paths(&dir, 1, &ids).is_err());
        std::fs::write(dir.join("quote-00-display-2.jpg"), b"test").unwrap();
        let (legacy, targets) = super::collect_rotation_paths(&dir, 1, &ids).unwrap();
        assert_eq!(legacy.len(), 1);
        assert!(targets[0]["1"].ends_with("quote-00-display-1.jpg"));
        assert!(targets[0]["2"].ends_with("quote-00-display-2.jpg"));
        let mut s = schedule();
        s.image_paths = legacy;
        s.display_paths = targets;
        let restored: DailySchedule =
            serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(restored.display_paths, s.display_paths);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn old_daily_schedule_json_remains_compatible() {
        let s: DailySchedule = serde_json::from_str(r#"{"enabled":true,"hour":8,"minute":0,"image_paths":["one.jpg"],"next_index":0,"last_applied_day":null}"#).unwrap();
        assert_eq!(s.interval_minutes, None);
        assert_eq!(s.next_due_at, None);
        assert!(schedule_is_due(&s, time("2026-10-03 08:00")));
    }
    #[test]
    fn empty_rotation_and_malformed_images_are_rejected() {
        let mut s = schedule();
        s.image_paths.clear();
        assert!(!schedule_is_due(&s, time("2026-10-03 08:00")));
        assert!(decode_image("data:image/jpeg;base64,YmFk").is_err());
        assert!(decode_image("data:text/plain;base64,YmFk").is_err());
    }
}
