# Desktop compatibility review

The application writes static wallpaper images. It does not draw over other applications, screen savers, or lock screens.

| Setup | Behavior and verification boundary |
| --- | --- |
| Current screen resolution / portrait / ultrawide / high DPI | Output uses physical monitor pixels; aspect is center-cropped before text is added. Synthetic geometry tests cover these cases. |
| Dock / taskbar / panels on any edge | Native monitor work-area insets are used with minimum padding; bottom keeps at least 15%. Actual OS work-area reporting determines accuracy. |
| App moved between monitors | Current display geometry is refreshed for preview and new exports. |
| Multiple displays with different shapes | macOS renders and applies a separate image for each display by native ID, including saved rotations. Windows/Linux still use a global output. Different source photos per monitor are not configurable. |
| Windows Fill / Fit / Stretch / Tile / Span | Wallpaper setter does not normalize the user's wallpaper mode. Tile/Span are unsupported layout assumptions; hardware verification required. |
| Linux desktops / X11 / Wayland | Shared rendering works, but native wallpaper-setting support depends on desktop and installed helpers; not every compositor is supported. |
| Dynamic wallpapers | Applying text creates a static raster; animation is not retained. |
| Screen savers / lock screens | Separate system targets, not integrated. Wallpaper quotes will not be visible over them. |
| Saved schedules after layout changes | Images are pre-rendered. Update the daily schedule after changing monitors, resolution, or panel geometry. |
| Long / multilingual text | Grapheme wrapping and fitting; system fonts required. No automatic translation. Pale text can be difficult to read on bright photos. |

Windows/Linux hardware, side panels, and mixed physical displays have not been tested on this Mac. Geometry tests are not evidence of native wallpaper integration on those systems.

## Follow-up architecture

macOS now renders and stores a wallpaper per display with native display IDs. Extend this to Windows/Linux. Windows requires a per-monitor desktop wallpaper API. Retain source photos and quote settings for schedule regeneration when geometry changes. Screen savers need their own native integration and lifecycle; they should not be presented as a wallpaper switch.

Official references: [Apple visibleFrame](https://developer.apple.com/documentation/appkit/nsscreen/visibleframe), [Windows monitor work area](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-monitorinfo), [Windows IDesktopWallpaper](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper), [X11 work area](https://specifications.freedesktop.org/wm/latest-single/), [Apple ScreenSaverView](https://developer.apple.com/documentation/screensaver/screensaverview).

## Built-in wallpaper previews

The visual browser shows six installed wallpapers per page, a larger selected-image preview, and an explicit Use this wallpaper action. Selection updates the app preview; applying to the desktop remains a separate action. macOS converts HEIC and dynamic wallpaper posters with system tools and reduces thumbnails to 480 pixels. Windows scans `%WINDIR%/Web`; Linux scans `/usr/share/backgrounds`, `/usr/share/wallpapers`, and `/usr/share/xfce4/backdrops`. Only locally installed image files are included; online catalogs, theme archives, and distro-specific locations outside these folders are not discovered. Choose photos remains available for those files. Windows and Linux discovery/preview code has not been verified on native hardware.
