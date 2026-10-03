import { useEffect, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import "./App.css";
import { WallpaperBrowser } from "./WallpaperBrowser";

import { quotes } from "./quotes";
import { analyzeBackground, prepareBackground, renderWallpaper, placements, rotationLength, workAreaInsets } from "./wallpaper";
import type { Analysis, PlacementMode } from "./wallpaper";

type WallpaperDisplay = { id: string; name: string; width: number; height: number; insets: { top: number; right: number; bottom: number; left: number } };

type TranslationStatus = { available: boolean; languages: string[]; text?: string | null; error?: string | null };

type Photo = { id: string; name: string; source: string; placement: PlacementMode };

type Background = "current" | "photo" | "builtin" | "studio";
type BuiltInWallpaper = { id: string; name: string };

const quotationLanguages = [["en", "English"], ["sa", "Sanskrit"], ["hi", "Hindi"], ["te", "Telugu"], ["ta", "Tamil"], ["kn", "Kannada"], ["ml", "Malayalam"], ["mr", "Marathi"], ["bn", "Bengali"], ["gu", "Gujarati"], ["pa", "Punjabi"], ["ur", "Urdu"], ["ar", "Arabic"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["ja", "Japanese"], ["zh", "Chinese"], ["und", "Another language"]];

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("stillpoint-theme") === "dark"; }
    catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "ivory";
    try { localStorage.setItem("stillpoint-theme", darkMode ? "dark" : "ivory"); }
    catch { /* Theme still works when preference storage is unavailable. */ }
  }, [darkMode]);
  const [quotationLanguage, setQuotationLanguage] = useState(() => {
    try { const saved = localStorage.getItem("stillpoint-quote-language"); return quotationLanguages.some(([code]) => code === saved) ? saved! : "en"; }
    catch { return "en"; }
  });
  useEffect(() => {
    try { localStorage.setItem("stillpoint-quote-language", quotationLanguage); } catch { /* Optional preference storage. */ }
  }, [quotationLanguage]);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [background, setBackground] = useState<Background>("studio");
  const [imageData, setImageData] = useState<string | null>(null);
  const [builtInWallpapers, setBuiltInWallpapers] = useState<BuiltInWallpaper[]>([]);
  const [, setSelectedBuiltInWallpaper] = useState("");
  const [placement, setPlacement] = useState<PlacementMode>("bottom-left");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState("");
  const [rotateQuotes, setRotateQuotes] = useState(true);
  const [renderedPreview, setRenderedPreview] = useState("");
  const [analysisLabel, setAnalysisLabel] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translationMessage, setTranslationMessage] = useState("");
  const [customText, setCustomText] = useState(() => {
    try { return localStorage.getItem("stillpoint-custom-text") ?? ""; } catch { return ""; }
  });
  const [customReference, setCustomReference] = useState(() => {
    try { return localStorage.getItem("stillpoint-custom-reference") ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    try {
      localStorage.setItem("stillpoint-custom-text", customText);
      localStorage.setItem("stillpoint-custom-reference", customReference);
    } catch { /* The preview works even if local preference storage is unavailable. */ }
  }, [customText, customReference]);
  const [operation, setOperation] = useState<"apply" | "schedule" | null>(null);
  const [contentMode, setContentMode] = useState<"short" | "custom">(quotationLanguage === "en" ? "short" : "custom");
  const [desktopSize, setDesktopSize] = useState({ width: window.screen.width * window.devicePixelRatio, height: window.screen.height * window.devicePixelRatio });
  const [desktopInsets, setDesktopInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const insetsKey = JSON.stringify(desktopInsets);
  const targetKey = `${desktopSize.width}x${desktopSize.height}`;
  const analysisCache = useRef(new Map<string | null, { key: string; analysis: Analysis }>());
  const prepared = useRef<{ source: string | null; key: string; canvas: HTMLCanvasElement } | null>(null);
  const [quoteScale, setQuoteScale] = useState(100);
  const [scheduleInterval, setScheduleInterval] = useState("daily");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wallpaperLoading, setWallpaperLoading] = useState(false);
  const [wallpaperError, setWallpaperError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const wallpaperSelectionVersion = useRef(0);
  const quote = contentMode === "custom"
    ? { ...quotes[quoteIndex], text: customText.trim(), reference: customReference.trim() || "YOUR DAILY INSPIRATION" }
    : quotes[quoteIndex];
  const activePhoto = background === "photo" ? photos.find(photo => photo.id === selectedPhoto) : undefined;
  const activePlacement = activePhoto?.placement ?? placement;
  const desktopMode = isTauri();

  useEffect(() => {
    if (!desktopMode) return;
    let active = true;
    invoke<TranslationStatus>("translate_quotation", { text: null, language: null })
      .then(status => { if (active) setTranslationStatus(status); })
      .catch(error => { if (active) setTranslationStatus({ available: false, languages: [], error: String(error) }); });
    return () => { active = false; };
  }, [desktopMode]);

  async function translateSelectedQuote() {
    setTranslating(true);
    setTranslationMessage("Translating on this Mac…");
    try {
      const result = await invoke<TranslationStatus>("translate_quotation", { text: quotes[quoteIndex].text, language: quotationLanguage });
      if (result.error || !result.text) throw new Error(result.error || "No translation was returned.");
      setCustomText(result.text);
      setCustomReference(quotes[quoteIndex].reference);
      setContentMode("custom");
      setTranslationMessage("Machine translation of the English paraphrase. Review or edit it before applying.");
    } catch (error) { setTranslationMessage(String(error)); }
    finally { setTranslating(false); }
  }

  useEffect(() => {
    if (!desktopMode) return;
    let active = true;
    const initialSelectionVersion = wallpaperSelectionVersion.current;
    setBackground("current");
    setWallpaperLoading(true);
    setWallpaperError("");
    invoke<BuiltInWallpaper[]>("list_builtin_wallpapers")
      .then((wallpapers) => {
        if (!active) return;
        setBuiltInWallpapers(wallpapers);
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Could not list built-in wallpapers: ${String(error)}`);
      });

    invoke<string>("get_current_wallpaper")
      .then((data) => {
        if (!active || wallpaperSelectionVersion.current !== initialSelectionVersion) return;
        setImageData(data);
        setBackground("current");
        setWallpaperLoading(false);
        setNotice("Loaded your current desktop wallpaper.");
      })
      .catch((error: unknown) => {
        if (!active || wallpaperSelectionVersion.current !== initialSelectionVersion) return;
        setWallpaperLoading(false);
        setWallpaperError(String(error));
        setNotice(`Could not load the current wallpaper: ${String(error)}`);
      });

    invoke<{ enabled: boolean; hour: number; minute: number; interval_minutes?: number | null }>("get_schedule_status")
      .then((status) => {
        if (!active) return;
        setScheduleEnabled(status.enabled);
        setScheduleInterval(status.interval_minutes ? String(status.interval_minutes) : "daily");
        setScheduleTime(
          `${String(status.hour).padStart(2, "0")}:${String(status.minute).padStart(2, "0")}`,
        );
      })
      .catch((error: unknown) => {
        if (active) setNotice(String(error));
      });
    isEnabled()
      .then((enabled) => {
        if (active) setLaunchAtLogin(enabled);
      })
      .catch((error: unknown) => {
        if (active) setNotice(String(error));
      });
    return () => {
      active = false;
    };
  }, [desktopMode]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    let request = 0;
    async function refreshDisplay() {
      const version = ++request;
      try {
        if (desktopMode) {
          const monitor = await currentMonitor();
          if (!active || version !== request || !monitor) return;
          setDesktopSize({ width: monitor.size.width, height: monitor.size.height });
          setDesktopInsets(workAreaInsets(monitor.size, monitor.position, monitor.workArea));
        } else {
          const screen = window.screen;
          setDesktopSize({ width: screen.width * window.devicePixelRatio, height: screen.height * window.devicePixelRatio });
          const available = screen as Screen & { availLeft?: number; availTop?: number; left?: number; top?: number };
          setDesktopInsets(workAreaInsets({ width: screen.width, height: screen.height },
            { x: available.left ?? 0, y: available.top ?? 0 },
            { position: { x: available.availLeft ?? available.left ?? 0, y: available.availTop ?? available.top ?? 0 },
              size: { width: screen.availWidth, height: screen.availHeight } }));
        }
      } catch { /* Retain the last known screen geometry if the OS cannot report it. */ }
    }
    void refreshDisplay();
    window.addEventListener("focus", refreshDisplay);
    window.addEventListener("resize", refreshDisplay);
    if (desktopMode) {
      getCurrentWindow().onMoved(() => { void refreshDisplay(); }).then(dispose => {
        if (active) unlisten = dispose; else dispose();
      }).catch(() => { /* Focus and resize still refresh display geometry. */ });
    }
    return () => {
      active = false;
      unlisten?.();
      window.removeEventListener("focus", refreshDisplay);
      window.removeEventListener("resize", refreshDisplay);
    };
  }, [desktopMode]);

  async function getBackground(source: string | null, mode: PlacementMode, display?: WallpaperDisplay) {
    const size = display ? { width: display.width, height: display.height } : desktopSize;
    const key = `${size.width}x${size.height}`;
    const aspect = size.width / size.height;
    let canvas = prepared.current?.source === source && prepared.current.key === key ? prepared.current.canvas : undefined;
    if (!canvas) {
      canvas = await prepareBackground(source, aspect, size);
      prepared.current = { source, key: key, canvas };
    }
    const cached = analysisCache.current.get(source);
    let analysis = cached?.key === key ? cached.analysis : undefined;
    if (mode === "auto" && !analysis) {
      analysis = await analyzeBackground(canvas);
      if (analysisCache.current.size >= 10) analysisCache.current.clear();
      analysisCache.current.set(source, { key: key, analysis });
    }
    return { canvas, analysis };
  }

  useEffect(() => {
    let active = true;
    if (!imageData && background !== "studio") {
      setRenderedPreview("");
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    getBackground(imageData, activePlacement)
      .then(({ canvas, analysis }) => renderWallpaper(canvas, quote, activePlacement, quoteScale, analysis, 1200, desktopInsets))
      .then(result => {
        if (!active) return;
        setRenderedPreview(result.url);
        setAnalysisLabel(activePlacement === "auto"
          ? `${result.engine} · ${result.position.replace(/-/g, " ")}` : "Manual placement");
      })
      .catch(error => { if (active) { setRenderedPreview(""); setNotice(String(error)); } })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [imageData, background, activePlacement, quoteIndex, quoteScale, customText, customReference, contentMode, targetKey, insetsKey]);

  function updatePlacement(mode: PlacementMode) {
    if (activePhoto) setPhotos(items => items.map(item => item.id === activePhoto.id ? { ...item, placement: mode } : item));
    else setPlacement(mode);
  }

  async function handlePhotos(files: File[]) {
    if (!files.length) return;
    if (files.length > 8 || files.reduce((sum, file) => sum + file.size, 0) > 80 * 1024 * 1024) {
      setNotice("Choose up to 8 photos, totaling no more than 80 MB."); return;
    }
    if (files.some(file => !file.type.startsWith("image/") || file.size > 40 * 1024 * 1024)) {
      setNotice("Choose image files smaller than 40 MB each."); return;
    }
    const version = ++wallpaperSelectionVersion.current;
    setWallpaperLoading(true);
    setNotice("Preparing your photo playlist…");
    try {
      const loaded: Photo[] = [];
      for (const file of files) {
        const temporary = URL.createObjectURL(file);
        try {
          // Normalize uploads before retaining them; never store the original full-size file as base64.
          const canvas = await prepareBackground(temporary);
          loaded.push({ id: crypto.randomUUID(), name: file.name,
            source: canvas.toDataURL("image/jpeg", 0.94), placement: files.length > 1 ? "auto" : placement });
          canvas.width = canvas.height = 1;
        } finally { URL.revokeObjectURL(temporary); }
      }
      if (version !== wallpaperSelectionVersion.current) return;
      analysisCache.current.clear();
      setPhotos(loaded); setSelectedPhoto(loaded[0].id);
      setImageData(loaded[0].source); setBackground("photo"); setWallpaperError("");
      setNotice(`${loaded.length} photo${loaded.length === 1 ? "" : "s"} ready. Each photo remembers its placement.`);
    } catch (error) { if (version === wallpaperSelectionVersion.current) setNotice(String(error)); }
    finally { if (version === wallpaperSelectionVersion.current) setWallpaperLoading(false); }
  }

  async function applyNow() {
    if (!imageData && background !== "studio") {
      setNotice("Load a wallpaper before applying a quote.");
      return;
    }
    setBusy(true);
    setOperation("apply");
    setNotice("");
    try {
      if (!desktopMode) {
        setNotice("Preview ready. Open the desktop app to apply it as your wallpaper.");
        return;
      }
      const displays = await invoke<WallpaperDisplay[]>("list_wallpaper_displays");
      if (displays.length) {
        for (const display of displays) {
          const { canvas, analysis } = await getBackground(imageData, activePlacement, display);
          const rendered = await renderWallpaper(canvas, quote, activePlacement, quoteScale, analysis, Infinity, display.insets);
          await invoke("apply_display_wallpaper", { displayId: display.id, imageDataUrl: rendered.url });
        }
      } else {
        const { canvas, analysis } = await getBackground(imageData, activePlacement);
        const rendered = await renderWallpaper(canvas, quote, activePlacement, quoteScale, analysis, Infinity, desktopInsets);
        await invoke("apply_wallpaper", { imageDataUrl: rendered.url });
      }
      setNotice("Wallpaper updated.");
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
      setOperation(null);
    }
  }

  async function saveSchedule() {
    if (!imageData && background !== "studio") {
      setNotice("Load a wallpaper before scheduling quote wallpapers.");
      return;
    }
    if (!desktopMode) {
      setNotice("Scheduling is available in the desktop app.");
      return;
    }
    setBusy(true);
    setOperation("schedule");
    setNotice("");
    let draftId: string | undefined;
    try {
      const playlist = background === "photo" && photos.length
        ? photos : [{ source: imageData, placement }];
      const count = rotationLength(playlist.length, quotes.length, rotateQuotes && contentMode !== "custom");
      const displays = await invoke<WallpaperDisplay[]>("list_wallpaper_displays");
      draftId = await invoke<string>("begin_schedule");
      for (let index = 0; index < count; index++) {
        const photo = playlist[index % playlist.length];
        const item = rotateQuotes && contentMode !== "custom" ? quotes[(quoteIndex + index) % quotes.length] : quote;
        setNotice(`Preparing wallpaper ${index + 1} of ${count}…`);
        for (const display of displays.length ? displays : [undefined]) {
          const { canvas, analysis } = await getBackground(photo.source, photo.placement, display);
          const rendered = await renderWallpaper(canvas, item, photo.placement, quoteScale, analysis, Infinity, display?.insets ?? desktopInsets);
          await invoke("append_schedule_image", { draftId, index, displayId: display?.id ?? null, imageDataUrl: rendered.url });
        }
      }
      const [hourText, minuteText] = scheduleTime.split(":");
      if (!hourText || !minuteText) throw new Error("Choose a valid schedule time.");
      await invoke("commit_schedule", { draftId, count, hour: Number(hourText), minute: Number(minuteText), intervalMinutes: scheduleInterval === "daily" ? null : Number(scheduleInterval), displayIds: displays.map(display => display.id) });
      draftId = undefined;
      setScheduleEnabled(true);
      setNotice(`Rotation saved (${count} wallpapers). Keep Verseglade running in the tray.`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      if (draftId) {
        try { await invoke("cancel_schedule", { draftId }); }
        catch (error) { setNotice(previous => `${previous} Could not clean up the unfinished rotation: ${String(error)}`); }
      }
      setBusy(false);
      setOperation(null);
    }
  }

  async function pauseSchedule() {
    if (!desktopMode) return;
    setBusy(true);
    try {
      await invoke("disable_daily_schedule");
      setScheduleEnabled(false);
      setNotice("Daily rotation paused.");
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateLaunchAtLogin(enabled: boolean) {
    setNotice("");
    try {
      if (enabled) await enable();
      else await disable();
      setLaunchAtLogin(enabled);
    } catch (error) {
      setNotice(`Could not update launch-at-login: ${String(error)}`);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Verseglade home">
          <img className="brand-mark" src="/verseglade-mark.svg" alt="" />
          <span>still<span className="brand-light">point</span></span>
        </a>
        <div className="topbar-actions">
          <div className="topbar-meta"><span className="status-dot" /> PERSONAL DESKTOP RITUAL</div>
          <button className="theme-toggle" onClick={() => setDarkMode(value => !value)} aria-pressed={darkMode}
            aria-label="Dark mode">{darkMode ? "☀ Ivory" : "☾ Dark"}</button>
        </div>
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">A DAILY MOMENT OF CLARITY</p>
          <h1>Let wisdom meet you<br />where you work.</h1>
          <p className="intro-text">Keep the wallpaper you love. Add a quiet moment of inspiration, exactly where it belongs.</p>
        </div>
        <div className="verse-count"><span>{String(quotes.length).padStart(2, "0")}</span><small>ORIGINAL<br />PARAPHRASES</small></div>
      </section>

      <section className="workspace">
        <div className="preview-column">
          <div className="section-heading">
            <div><span className="step">01</span><h2>Your desktop, reframed</h2></div>
            <span className="preview-label">LIVE PREVIEW</span>
          </div>
          <div className="wallpaper-preview" aria-busy={previewLoading || wallpaperLoading}>
            {renderedPreview && <img className="rendered-wallpaper" src={renderedPreview} alt={quote.text ? `Wallpaper preview: ${quote.text}` : "Wallpaper preview"} />}
            {!renderedPreview && <div className="wallpaper-placeholder">
              <span>{wallpaperLoading || previewLoading ? "Preparing wallpaper…" : "Enter a quotation and choose a wallpaper to preview"}</span>
              {wallpaperError && <small>{wallpaperError}</small>}
            </div>}
            {(previewLoading || wallpaperLoading) && <span className="source-indicator">UPDATING PREVIEW…</span>}
          </div>
          <div className="quote-controls">
            <fieldset className="placement-control" disabled={busy}>
              <legend>QUOTE PLACEMENT</legend>
              <button className={`auto-placement ${activePlacement === "auto" ? "selected" : ""}`}
                onClick={() => updatePlacement("auto")} aria-pressed={activePlacement === "auto"}>✧ Auto · find quiet space</button>
              <div className="placement-options placement-grid">
                {placements.map(position => (
                  <button className={activePlacement === position ? "placement-option selected" : "placement-option"}
                    key={position} onClick={() => updatePlacement(position)} aria-pressed={activePlacement === position}
                    aria-label={position.replace(/-/g, " ")}>{position.replace(/-/g, " ")}</button>
                ))}
              </div>
            </fieldset>
            <label className="scale-control">
              <span>QUOTE SIZE <output>{quoteScale}%</output></span>
              <input type="range" min="75" max="135" step="5" value={quoteScale} disabled={busy}
                onChange={event => setQuoteScale(Number(event.currentTarget.value))} aria-label="Quote size" />
              <small>{analysisLabel}</small>
            </label>
          </div>
          {background === "photo" && photos.length > 0 && <section className="photo-playlist" aria-label="Photo playlist">
            <div className="playlist-heading"><span>{photos.length} photo{photos.length > 1 ? "s" : ""} · ordered daily rotation</span>
              <button className="source-button" disabled={busy} onClick={() => fileInput.current?.click()}>Replace photos</button></div>
            <div className="photo-thumbnails">{photos.map((photo, index) => <button key={photo.id}
              className={`photo-thumbnail ${selectedPhoto === photo.id ? "selected" : ""}`} disabled={busy || wallpaperLoading}
              aria-pressed={selectedPhoto === photo.id} aria-label={`Preview photo ${index + 1}: ${photo.name}`}
              onClick={() => { wallpaperSelectionVersion.current++; setSelectedPhoto(photo.id); setImageData(photo.source); }}>
              <img src={photo.source} alt="" /><span>{index + 1} · {photo.placement === "auto" ? "Auto" : photo.placement.replace(/-/g, " ")}</span>
            </button>)}</div>
          </section>}
          <div className="source-row">
            <span className="source-label">BACKGROUND</span>
            <div className="source-options">
              <button disabled={busy} className={background === "current" ? "source-button selected" : "source-button"} onClick={async () => {
                if (!desktopMode) {
                  setNotice("Reading the current wallpaper is available in the desktop app.");
                  return;
                }
                const selectionVersion = ++wallpaperSelectionVersion.current;
                setWallpaperLoading(true);
                setWallpaperError("");
                setImageData(null);
                setBackground("current");
                try {
                  const data = await invoke<string>("get_current_wallpaper");
                  if (wallpaperSelectionVersion.current !== selectionVersion) return;
                  setImageData(data);
                  setBackground("current");
                  setWallpaperLoading(false);
                  setNotice("Loaded your current desktop wallpaper.");
                } catch (error) {
                  if (wallpaperSelectionVersion.current !== selectionVersion) return;
                  setWallpaperLoading(false);
                  setImageData(null);
                  setWallpaperError(String(error));
                  setNotice(String(error));
                }
              }}>Current wallpaper</button>
              {desktopMode && <WallpaperBrowser wallpapers={builtInWallpapers} onSelect={(id, data) => {
                wallpaperSelectionVersion.current += 1;
                setSelectedBuiltInWallpaper(id);
                setImageData(data);
                setBackground("builtin");
                setWallpaperLoading(false);
                setWallpaperError("");
                setNotice("Wallpaper selected. Review your quote in the live preview before applying.");
              }} />}
              <button className={background === "photo" ? "source-button selected" : "source-button"} disabled={busy || wallpaperLoading} onClick={() => fileInput.current?.click()}>Choose photos</button>
              <button disabled={busy} className={background === "studio" ? "source-button selected" : "source-button"} onClick={() => {
                wallpaperSelectionVersion.current += 1;
                setWallpaperLoading(false);
                setBackground("studio");
                setImageData(null);
                setWallpaperError("");
              }}>Create a quote card</button>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={event => { void handlePhotos(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
            </div>
          </div>
          <p className="privacy-note"><span>◈</span> Your source image stays untouched. Dynamic Apple wallpapers become still images when a quote is applied.</p>
        </div>

        <aside className="quote-panel">
          <div className="section-heading">
            <div><span className="step">02</span><h2>Choose a thought</h2></div>
          </div>
          <p className="panel-description">{contentMode === "short" ? "Short English paraphrases inspired by the Bhagavad Gita." : "Use your own quotation in the language you prefer."}</p>
          <label className="content-picker">What language would you like your quotations in?
            <select value={quotationLanguage} disabled={busy || translating} onChange={event => {
              const language = event.currentTarget.value;
              setQuotationLanguage(language);
              setTranslationMessage("");
              setContentMode(language === "en" ? "short" : "custom");
            }}>
              {quotationLanguages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          {quotationLanguage !== "en" && <div className="translation-controls">
            <button className="button button-secondary full-width" disabled={busy || translating || !translationStatus?.available || !translationStatus.languages.includes(quotationLanguage)}
              onClick={() => void translateSelectedQuote()}>{translating ? "Translating…" : "Translate selected quote on this Mac"}</button>
            <p className="language-note">{translationMessage || (!desktopMode ? "On-device translation requires the Mac app. You can paste your own text here."
              : !translationStatus ? "Checking Apple's on-device model…" : !translationStatus.available ? translationStatus.error
              : !translationStatus.languages.includes(quotationLanguage) ? "Apple's model does not support this language. Paste your own translation."
              : "Translate the selected English paraphrase locally, then review it. This is not a scholarly translation of the Sanskrit shloka.")}</p>
          </div>}
          <label className="content-picker">QUOTATION
            <select value={contentMode} disabled={busy} onChange={event => setContentMode(event.currentTarget.value as "short" | "custom")}>
              {quotationLanguage === "en" && <option value="short">Short inspiration · English</option>}
              <option value="custom">My quotation · any language</option>
            </select>
          </label>
          {contentMode === "custom" && <label className="custom-quote-label">Your text
            <textarea dir="auto" lang={quotationLanguage} value={customText} maxLength={1200} disabled={busy || translating} placeholder="Paste a quotation in your preferred language…"
              onChange={event => setCustomText(event.currentTarget.value)} />
            <small>Your text is rendered as entered. For a quick daily glance, choose one or two short lines.</small>
          </label>}
          {contentMode === "custom" && <label className="content-picker">SOURCE / VERSE (OPTIONAL)
            <input value={customReference} maxLength={80} disabled={busy} placeholder="For example, Bhagavad Gita · 2.47"
              onChange={event => setCustomReference(event.currentTarget.value)} />
          </label>}
          {contentMode === "short" && <div className="quote-list" role="region" aria-label="Choose a quotation" tabIndex={0}>
            {quotes.map((item, index) => (
              <button className={`quote-option ${index === quoteIndex ? "active" : ""}`} key={item.reference} disabled={busy} onClick={() => { setQuoteIndex(index); setContentMode("short"); }}>
                <span className="quote-option-top"><span>{item.theme}</span><span>{item.reference.split("· ")[1]}</span></span>
                <span className="quote-option-text">{item.text}</span>
                <span className="radio-indicator" />
              </button>
            ))}
          </div>}
          <div className="schedule-card">
            <div className="schedule-title-row">
              <div><span className="step">03</span><h2>Make it a ritual</h2></div>
              <span className={`schedule-status ${scheduleEnabled ? "is-on" : ""}`}><span />{scheduleEnabled ? "ON" : scheduleInterval === "daily" ? "DAILY" : "INTERVAL"}</span>
            </div>
            <p className="panel-description">Choose how often your wallpapers change.</p>
            <label className="rotation-toggle"><input type="checkbox" checked={rotateQuotes} disabled={busy || contentMode === "custom"}
              onChange={event => setRotateQuotes(event.currentTarget.checked)} />Change the quotation too</label>
            <label className="content-picker schedule-frequency">Change wallpaper
              <select aria-label="Rotation frequency" value={scheduleInterval} disabled={busy} onChange={event => setScheduleInterval(event.currentTarget.value)}>
                <option value="1">Every minute</option><option value="5">Every 5 minutes</option>
                <option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option>
                <option value="60">Every hour</option><option value="120">Every 2 hours</option>
                <option value="daily">Daily at a set time</option>
              </select>
            </label>
            {scheduleInterval === "daily" && <div className="schedule-controls">
              <label htmlFor="schedule-time">Change wallpaper at</label>
              <input id="schedule-time" type="time" disabled={busy} value={scheduleTime} onChange={(event) => setScheduleTime(event.currentTarget.value)} />
            </div>}
            <button className="button button-dark full-width" onClick={() => void saveSchedule()}
              disabled={busy || wallpaperLoading || previewLoading || !quote.text || (!imageData && background !== "studio")}>
              {busy ? operation === "schedule" ? "Preparing your wallpapers…" : "Working…" : scheduleEnabled ? "Update schedule" : "Save schedule"}<span>↗</span></button>
            {scheduleEnabled && <button className="button button-secondary full-width pause-button" onClick={() => void pauseSchedule()} disabled={busy}>Pause rotation</button>}
            <label className="login-toggle">
              <input type="checkbox" checked={launchAtLogin} disabled={!desktopMode || busy} onChange={(event) => void updateLaunchAtLogin(event.currentTarget.checked)} />
              <span className="toggle-ui" />
              <span>Start Verseglade when I log in</span>
            </label>
          </div>
        </aside>
      </section>

      <footer className="action-bar">
        <div className="notice" role="status">{notice || (desktopMode ? "Close the window to keep Verseglade running in your menu bar." : "A desktop preview. Apply and scheduling work in the native app.")}</div>
        <button className="button button-gold" onClick={() => void applyNow()} disabled={busy || wallpaperLoading || previewLoading || !quote.text || (!imageData && background !== "studio")}>{busy ? operation === "apply" ? "Applying…" : "Working…" : "Set as wallpaper"}<span>↗</span></button>
      </footer>
    </main>
  );
}

export default App;
