import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Wallpaper = { id: string; name: string };
export function WallpaperBrowser({ wallpapers, onSelect }: { wallpapers: Wallpaper[]; onSelect: (id: string, data: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Wallpaper | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const visible = wallpapers.slice(page * 6, page * 6 + 6);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setThumbnails({});
    async function load() {
      for (const item of visible) {
        try {
          const data = await invoke<string>("get_builtin_wallpaper", { id: item.id, thumbnail: true });
          if (!active) return;
          setThumbnails(previous => ({ ...previous, [item.id]: data }));
        } catch {
          if (!active) return;
          setThumbnails(previous => ({ ...previous, [item.id]: null }));
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [open, page, wallpapers]);
  useEffect(() => {
    if (!open || !selected) return;
    let active = true;
    setPreview(""); setError(""); setLoading(true);
    invoke<string>("get_builtin_wallpaper", { id: selected.id, thumbnail: false })
      .then(data => { if (active) setPreview(data); })
      .catch(reason => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, selected]);
  function close() { dialog.current?.close(); setOpen(false); setPreview(""); setThumbnails({}); }
  return <>
    <button className="source-button" onClick={() => { setOpen(true); dialog.current?.showModal(); }}>Browse built-in wallpapers</button>
    <dialog className="wallpaper-browser" ref={dialog} onClose={() => setOpen(false)} aria-labelledby="wallpaper-browser-title">
      <div className="wallpaper-browser-heading"><h2 id="wallpaper-browser-title">Choose a wallpaper</h2><button className="source-button" onClick={close} aria-label="Close wallpaper browser">Close</button></div>
      <p>Preview locally installed system wallpapers before choosing. Your desktop changes only when you set it as wallpaper.</p>
      {wallpapers.length === 0 ? <p role="status">No built-in images were found in the system wallpaper folders. Use Choose photos to browse another folder.</p> : <>
        <div className="wallpaper-thumbnails">{visible.map(item => <button className="wallpaper-thumbnail" key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}>
          {thumbnails[item.id] ? <img src={thumbnails[item.id]!} alt="" /> : <span>{thumbnails[item.id] === null ? "Preview unavailable · try opening" : "Loading preview…"}</span>}
          <span>{item.name}</span>
        </button>)}</div>
        <div className="wallpaper-browser-pages"><button className="source-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(wallpapers.length / 6)}</span><button className="source-button" disabled={(page + 1) * 6 >= wallpapers.length} onClick={() => setPage(page + 1)}>Next</button></div>
        {selected && <div className="wallpaper-detail"><h3>{selected.name}</h3>{loading && <p role="status">Loading wallpaper…</p>}{error && <p role="alert">{error}</p>}{preview && <img src={preview} alt={`Preview of ${selected.name}`} />}<button className="button button-gold" disabled={loading || !preview} onClick={() => { onSelect(selected.id, preview); close(); }}>Use this wallpaper</button></div>}
      </>}
    </dialog>
  </>;
}
