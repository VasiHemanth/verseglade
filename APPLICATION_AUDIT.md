# Stillpoint application audit and roadmap

Reviewed 3 October 2026. Three agents investigated content, displays/scheduling, and performance; the primary agent reviewed source and inspected the existing native release. This is an exploration report, not an implementation change.

## Architecture and present behavior

- `src/App.tsx`: React state, six original English paraphrases, background selection, DOM preview, Canvas JPEG generation, Tauri commands, autostart controls.
- `src/App.css`: responsive interface; fixed 16:9 preview with a separate CSS quote layout.
- `src-tauri/src/lib.rs`: wallpaper discovery/conversion, file storage, native wallpaper APIs, daily scheduler, tray and window lifecycle.
- `src-tauri/tauri.conf.json`: npm development/build hooks, bundled frontend, native window and CSP.
- macOS uses WKWebView and Rust at runtime. Node is used for frontend tooling, not a bundled application server.
- Scheduling pre-renders the entire six-item collection, stores JPEGs, and checks local time every 30 seconds. It runs while the app is running, including with its window hidden. Restart after the daily deadline applies one item, without replaying every missed day.
- No Git repository was found in this workspace. There are two Rust tests and no frontend behavior tests.

## Authentic shlokas and English translations

Replace the hardcoded Quote model with an offline, versioned verse catalog containing chapter, verse number, Devanagari, optional transliteration, English translation, translator, edition, source URL, reuse terms, and themes. Do not relabel the existing paraphrases as translations. Preserve theological meaning, including verses such as 18.66.

Start with a verified collection rather than importing hundreds of wallpapers. Offer Sanskrit + English, English only, and Sanskrit only; put translator attribution and context in the app, with a compact reference on the wallpaper.

Source findings:

- [IIT Kanpur Gita Supersite acknowledgment](https://www.gitasupersite.iitk.ac.in/srimad/acknowledgement): contributor copyrights remain with their publishers. Public reading access is not sufficient evidence of redistribution rights.
- [SanskritDocuments](https://sanskritdocuments.org/doc_giitaa/bhagvadnew.html): useful proofreading reference, but the source file has restrictions on commercial/promotional copying.
- [Project Gutenberg, Edwin Arnold](https://www.gutenberg.org/ebooks/2388): identifies the edition as public domain in the USA; poetry complicates precise verse alignment. This does not establish worldwide reuse clearance.
- [Telang historical edition scan](https://upload.wikimedia.org/wikipedia/commons/f/f9/The_Sacred_Books_Of_The_East_Vol_VIII_%28IA_sacredbooksofthe015782mbp%29.pdf): candidate for independently verified prose transcription. Reuse status and exact alignment still need checking before selection.

Rendering must preserve Sanskrit line breaks, load a bundled Devanagari font before measuring, calculate combined text height, and fit portrait/ultrawide displays. Current Canvas text coordinates and 38% width were designed for short English phrases. The CSS preview and Canvas export currently use different layout rules; a shared renderer would make previews dependable.

## Display support and scheduling findings

The macOS setter already loops over `NSScreen::screens` and applies the same image to all currently connected screens. There is no screen picker, individual background profile, per-display resolution output, or connection-change handling. A report of only one screen updating needs reproduction; it is not explained by a single-screen setter.

The source reader examines all display records in Apple's wallpaper Index.plist, then selects the most recently used candidate globally. It does not preserve display identity. Its fallback reads `NSScreen::mainScreen`. Consequently, different screens' backgrounds can be mixed up. Index.plist and aerial manifests are internal macOS formats and should remain guarded fallbacks.

Physical monitors and macOS Spaces are separate requirements. The current code has no explicit Space targeting. Likewise, another computer or remote session is a separate OS instance and needs its own app or a future synchronization feature.

The public Apple APIs are screen-oriented: [NSScreen](https://developer.apple.com/documentation/AppKit/NSScreen), [desktopImageURL(for:)](https://developer.apple.com/documentation/appkit/nsworkspace/desktopimageurl%28for%3A%29), and [NSWorkspace](https://developer.apple.com/documentation/appkit/nsworkspace). These API references do not establish support for every Space. Verify multiple Spaces and physical monitors separately, including sleep/wake and reconnection.

Concrete reliability gaps from code review:

1. Missing schedule settings deserialize to Rust defaults of 00:00, replacing the UI's initial 08:00 value on startup. This was also visible in the existing native release.
2. Scheduler and save/pause commands read and write settings without shared synchronization. Concurrent updates can overwrite one another or contend for the same temporary file.
3. Saving after today's deadline resets `last_applied_day`, allowing an immediate rotation at the next poll; define and expose this behavior.
4. While enabled, the UI shows only Pause. Editing the time does not persist it until the schedule is paused and saved again.
5. Schedule status omits current verse, next run, last success, and last failure. Background errors go only to stderr.
6. Application stops the monitor loop on the first error; earlier displays may already have changed, with no per-screen results or recovery.
7. Re-reading an app-generated wallpaper can layer another quote, especially on fallback/non-macOS paths. Preserve original backgrounds explicitly and provide Restore original.

## Bun feasibility and measured builds

Both `npm run build` and `bun run --bun build` passed and produced identical frontend asset hashes. Bun is feasible for frontend tooling; migrating install scripts, lockfile, Tauri hooks and CI still needs a clean-install verification.

Five sequential warm samples per command on this machine:

| Tooling | Median elapsed | Range | Median reported maximum RSS |
| --- | ---: | ---: | ---: |
| Node 25.9.0 / npm 11.12.1 | 0.60 s | 0.59–0.68 s | 278.2 MiB |
| Bun 1.4.2 | 0.39 s | 0.38–0.50 s | 130.7 MiB |

Bun was approximately 35% faster for this small warm build. The reported RSS figures concern build commands, not the desktop app or the sum of all compiler processes. They do not establish cold-install performance. See [Bun runtime documentation](https://bun.com/docs/runtime) and [Tauri process model](https://v2.tauri.app/concept/process-model/).

Frontend output: JavaScript 232.94 kB / 73.10 kB gzip; CSS 9.91 kB / 3.01 kB gzip.

## Desktop memory baseline

The existing release bundle was built 1 October; these measurements do not verify a freshly rebuilt current-source binary. No app process was running before launch, and no schedule.json existed. The app was started for inspection and terminated afterwards; its WebKit helpers also exited. No wallpaper was applied and no schedule was saved.

`ps` RSS samples in KiB, with current background loaded:

| Observation | Rust process | GPU | WebContent | Networking | Combined MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial idle | 104976 | 45440 | 86000 | 4816 | 235.6 |
| Later visible idle | 104240 | 31936 | 80560 | 4848 | 216.4 |
| After hiding window | 101808 | 45056 | 54112 | 4896 | 201.0 |

WebKit helpers had parent PID 1; attribution here uses their creation immediately after launch, absence before launch, and disappearance after termination. RSS totals can count shared pages more than once and differ from macOS physical footprint. These are three observations, not a peak/load benchmark or continuous monitoring.

For useful tracking, record native plus attributed WebKit physical footprint/RSS, CPU, operation duration, and generated disk size at launch, visible idle, tray idle, rendering, schedule save, and after repeated operations. Keep diagnostics local and optional. Measure a newly built release rather than a Vite development session.

## Performance priorities

1. Decode the background once per rendering batch. Currently each quote reloads the same image.
2. Stream rendered images to native storage one at a time rather than retaining every base64 string in one IPC request. The 32-image cap and 24 MiB per-image limit are unsuitable for a full Gita catalog.
3. Prefer file/blob-backed images and bounded caches over long-lived data URLs. A 4096×2304 RGBA canvas alone uses 36 MiB; a 4096 square canvas uses 64 MiB. Decoded originals, JPEG encoding, base64 and IPC copies add to this.
4. Bound source dimensions before expensive decoding where possible. The existing 4096 output clamp occurs after decoding the original. Rust checks the decoded 24 MiB limit after allocating base64 output; add an encoded-size preflight and total-operation limits.
5. Clean obsolete previews, applied images and replaced schedule directories, retaining files still referenced by the OS or an active schedule. Current timestamped files accumulate.
6. Use one synchronized scheduler state and wake near the next deadline, with resume/clock-change handling, rather than rereading JSON every 30 seconds.
7. If tray memory remains too high, benchmark destroying/recreating the editor window while keeping the Rust scheduler and tray alive. Hiding currently retains the webview.

## Prioritized feature ideas

| Priority | Idea | User benefit |
| --- | --- | --- |
| First | Authentic offline verse catalog, attribution and context | Trustworthy text without network dependence |
| First | Display picker, per-screen originals, restore action | Correct wallpaper on each connected monitor |
| First | Screen-aware bilingual rendering with an accurate preview | Readable text without clipping or stretching |
| First | Schedule status, editable time, error recovery, regression tests | Predictable daily rotation |
| Next | Favorites and chapter/theme collections | Personal rotation without repeats |
| Next | Ordered, shuffled, daily or interval rotation | More flexible habits |
| Next | Tray actions for Next verse, Pause and Restore | Control without opening the editor |
| Next | Contrast controls, icon-safe zones, portrait/ultrawide profiles | Legible wallpapers on varied setups |
| Next | Local memory/storage diagnostics and cache limits | Understand and control resource use |
| Later | Transliteration, additional licensed languages, context reading | Broader accessibility |
| Later | Optional preference sync across separately installed apps | Consistent choices across computers |

## Verification completed and remaining

Passed: frontend TypeScript/Vite build with npm; Bun build; Rust tests (2 passed); Rust formatting check. Existing native release loaded the current Mac wallpaper and rendered the interface successfully.

The two Rust tests depend on Golden Gate being installed and test only catalog listing/resolution. They do not verify display changes, schedule races, offline verse integrity, image limits or layout. Actual wallpaper changes, external monitors/Spaces, Windows/Linux, schedule execution, peak render RAM, and clean Bun installation were not exercised.

Required follow-up verification: injectable-clock scheduler tests for before/after deadline, once per day, restart, pause/save races, clock changes and failures; source/catalog validation; exported-image checks with long bilingual verses at 75–135% scale on 16:9, ultrawide and portrait outputs; two-monitor apply/restore/disconnect/reconnect checks; bounded-memory stress measurements using large photos and the selected rotation collection.
