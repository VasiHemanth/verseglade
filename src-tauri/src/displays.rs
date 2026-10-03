use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}
#[derive(Serialize)]
pub struct Display {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub insets: Insets,
}

#[cfg(target_os = "macos")]
pub fn screen_id(screen: &objc2_app_kit::NSScreen) -> Result<String, String> {
    let key = objc2_foundation::NSString::from_str("NSScreenNumber");
    let value = screen
        .deviceDescription()
        .objectForKey(&key)
        .ok_or("Could not identify this display")?;
    let number: u32 = unsafe { objc2::msg_send![&*value, unsignedIntValue] };
    Ok(number.to_string())
}

#[tauri::command]
pub async fn list_wallpaper_displays(app: AppHandle) -> Result<Vec<Display>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let (send, receive) = std::sync::mpsc::channel();
            app.run_on_main_thread(move || {
                let result = (|| {
                    let marker = objc2::MainThreadMarker::new()
                        .ok_or("Display access requires the main thread")?;
                    objc2_app_kit::NSScreen::screens(marker)
                        .iter()
                        .map(|screen| {
                            let frame = screen.frame();
                            let visible = screen.visibleFrame();
                            let scale = screen.backingScaleFactor();
                            Ok(Display {
                                id: screen_id(&screen)?,
                                name: screen.localizedName().to_string(),
                                width: (frame.size.width * scale).round() as u32,
                                height: (frame.size.height * scale).round() as u32,
                                insets: Insets {
                                    left: ((visible.origin.x - frame.origin.x) / frame.size.width)
                                        .max(0.0),
                                    right: ((frame.origin.x + frame.size.width
                                        - visible.origin.x
                                        - visible.size.width)
                                        / frame.size.width)
                                        .max(0.0),
                                    top: ((frame.origin.y + frame.size.height
                                        - visible.origin.y
                                        - visible.size.height)
                                        / frame.size.height)
                                        .max(0.0),
                                    bottom: ((visible.origin.y - frame.origin.y)
                                        / frame.size.height)
                                        .max(0.0),
                                },
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
            receive
                .recv_timeout(std::time::Duration::from_secs(15))
                .map_err(|e| e.to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
}
