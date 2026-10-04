# Verseglade

Verseglade adds a small quotation to the wallpaper you already use. The ivory-and-sage interface keeps the current wallpaper, Apple built-in wallpapers, photo import, quote-size control, daily scheduling, tray operation, and launch at login.

## Appearance

Use the top-right Dark/Ivory button to switch themes. Ivory is the default; your preference is stored locally and survives restart. Appearance changes only the interface, not exported wallpaper text or placement.

## Placement and image analysis

Choose one of nine positions in a 3×3 grid, or use **Auto**. Placement uses the current monitor’s reported work area to avoid Dock/taskbars on all four edges, with a 15% minimum bottom margin. Screen geometry refreshes when the app moves, resizes, or regains focus. Auto scores quiet image regions and contrast locally. On macOS it also uses Apple Vision's attention-based saliency regions and face detection. Windows, Linux, and browser previews use the shared texture/contrast fallback; this fallback does not recognize faces or objects. No cloud service or model download is required. Analysis is cached for each image and screen resolution while editing.

Wallpaper output automatically matches the current screen’s pixel resolution. Placement is relative to that screen, with no shape selection required. The image is center-cropped before analysis and rendering. On macOS, each connected display gets a separately rendered output at its own resolution, with its own work-area margins and native display ID. The same selected source photo and quotation are used for each display. Saved rotations retain these per-display images. Windows/Linux still use the existing global wallpaper setter.

The preview and export use the same Canvas renderer. Short quotations have a smaller default size, and longer text is fitted without truncation. Only quotation text and its reference are drawn, with no text shadow or background overlay. Preview resolution is reduced; the export matches the screen pixel resolution.

## Photo playlists

Choose up to eight photos (40 MB per file, 80 MB total input). Multiple photos start in Auto mode. Select a thumbnail to override placement for that photo. A new selection replaces the playlist; editing state is held for the current session.

Photos are normalized to bounded JPEGs before retaining them. Original files are untouched. The source is center-cropped to the screen before adding the quote; placement uses the final screen dimensions.

## Quotations and languages

The quotation panel asks for your preferred language and remembers it locally. The built-in list scrolls in a compact panel rather than stretching the page. English offers built-in quotations; other languages offer Apple on-device translation when the Mac model supports them, or your own text otherwise.

The built-in 18 quotations are clearly labelled original English paraphrases with Bhagavad Gita references. **My quotation · any language** lets you paste your own text, optionally with a source or verse reference. It preserves line breaks, supports right-to-left direction, and wraps long unspaced text using grapheme boundaries when available. Rendering depends on installed system fonts. Sources for the new verse references are listed in [QUOTE_SOURCES.md](QUOTE_SOURCES.md). On compatible Macs, Translate selected quote on this Mac uses Apple’s on-device Foundation Model. Availability and target-language support are checked at runtime. The result is an editable machine translation of the selected English paraphrase, not a scholarly translation of Sanskrit; review it before applying. Other systems retain custom text. There is no verified multilingual Gita catalog.

## Current Apple wallpaper

On macOS, Current wallpaper reads the active selection, including locally downloaded aerial wallpapers. Apple built-in images remain available through the picker. Applying a quotation to a dynamic wallpaper creates a static image; it does not keep the wallpaper animated.

Wallpaper discovery uses Apple's local wallpaper store with a public NSWorkspace fallback. The store format is not a stable public API. Multiple macOS Spaces and external-display behavior still need hardware verification.

## Scheduling

Choose every 1, 5, 15, or 30 minutes, every hour, every 2 hours, or daily at a local time. Rotation runs while Verseglade is open or hidden in its tray. Interval schedules start counting from save; deadlines persist across restarts, with checks every five seconds. After sleep, one overdue wallpaper is applied and the next interval starts from that application. Closing the window hides the app; **Quit** stops it. Enable launch at login to run after sign-in. A missed daily deadline applies one wallpaper on the next check after startup or wake.

Photos advance in selection order. **Change the quotation too** rotates the 18 short quotations starting with the selected one; otherwise the current quotation stays fixed. Custom text remains fixed while photos rotate. The combined sequence repeats after both photo and quotation cycles complete. Up to eight photos and 18 quotations produce at most 126 rendered wallpapers.

Rendered wallpapers are saved individually, then the completed rotation is published. Failed preparation preserves the previous schedule. Saved image paths and schedule progress survive restart. You can update the schedule while enabled or pause it. Newly saved schedules whose time has already passed may apply on the next scheduler check.

Older generated output is not automatically pruned yet. Do not delete files used by the active wallpaper or schedule.

## Run and verify

```sh
npm install
npm run tauri dev
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

## Downloads and landing page

The static landing page is in `website/` and is published at [vasihemanth.github.io/verseglade](https://vasihemanth.github.io/verseglade/). Its download buttons link to GitHub Releases. GitHub Actions builds macOS Apple silicon `.dmg`, Windows x64 NSIS `.exe`, and Linux x64 `.AppImage` installers when a `v*` version tag is pushed. The release assets use the filenames linked from the landing page.

The Microsoft Store EXE submission requires a direct installer URL without redirects. Each tagged release also publishes a versioned Windows installer under `website/downloads/<tag>/` on GitHub Pages for that purpose. The Store listing privacy policy is at [website/privacy.html](website/privacy.html).

The Tauri bundle identifier remains `com.hemanth.gita-wallpaper` so existing installations retain their saved preferences and schedules after the Verseglade rebrand.

The Windows NSIS installer is currently unsigned. Microsoft Defender SmartScreen can therefore show “Windows protected your PC” for a new download. People who obtained the installer from the official Verseglade release can choose **More info**, confirm the app is Verseglade, then choose **Run anyway**. Do not bypass the warning for an installer from another source. Code signing can identify a verified publisher, but does not guarantee that new builds immediately avoid SmartScreen warnings; publisher and file reputation also matter. See [Microsoft's SmartScreen reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Mac builds also require an Xcode SDK containing FoundationModels and its Swift compiler for the bundled translation bridge. The bridge uses availability checks for older systems.

Rust and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) are required. Tests use Node's built-in test runner with TypeScript stripping; verified with Node 25.9.0.

Bun also works for the frontend build:

```sh
bun run --bun build
```

Tauri's default hooks continue to use npm. Bun changes tooling performance, not the packaged Rust/WebView runtime.

Generate native icons from the editable ivory SVG:

```sh
npm run tauri icon -- design/ivory-icon.svg
```

Build the macOS app bundle:

```sh
npm run tauri build -- --bundles app
```

## Verification status

Twelve JavaScript tests cover nine-position bounds, quiet-region selection, avoiding detected subject regions, photo/quote cycle coverage, unspaced text wrapping, visible screen cropping, and exact screen-resolution output including 5K, work-area offsets on every edge, and catalog rotation bounds. Nine Rust tests cover installed wallpaper discovery, real offline Vision analysis, image rejection, the 08:00 default, and once-per-day scheduling/catch-up.

Browser checks exercised multi-photo upload, independent photo placement, portrait preview, and custom Sanskrit text. A native macOS check loaded the existing Apple wallpaper, confirmed Apple Vision in Auto mode, saved six schedule images individually, and paused the temporary schedule. Test settings were restored afterwards; no test wallpaper was applied. Windows/Linux native wallpaper application and multiple physical displays were not exercised on this Mac.

See [DESKTOP_COMPATIBILITY.md](DESKTOP_COMPATIBILITY.md) for the reviewed setup matrix, unsupported screen-saver/lock-screen targets, and multi-monitor limitations. Update saved schedules after changing display geometry.

On-device translation verification: the native bridge reported model availability on this Mac and translated the 2.47 English paraphrase into French in about 1.6 seconds. Hindi was rejected as unsupported by the installed model. Other language availability can vary by OS/model version. No cloud translation endpoint is used. The helper process exits after each request, with a 60-second timeout.

Preview remains visible when the custom quotation is blank. Custom/translated text and its reference are saved locally and restored on restart, alongside the language preference.
