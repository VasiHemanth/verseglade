import { invoke, isTauri } from '@tauri-apps/api/core';

export const placements = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;
export type Placement = typeof placements[number];
export type PlacementMode = Placement | 'auto';
export type Region = { x: number; y: number; width: number; height: number; weight?: number };
export type Quote = { reference: string; text: string; theme: string };
export type Analysis = { pixels: Uint8ClampedArray; width: number; height: number; regions: Region[]; engine: string };

export type Insets = { top: number; right: number; bottom: number; left: number };
const defaultInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function workAreaInsets(size: { width: number; height: number }, position: { x: number; y: number },
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } }): Insets {
  const clamp = (value: number) => Math.max(0, Math.min(0.4, Number.isFinite(value) ? value : 0));
  return {
    left: clamp((workArea.position.x - position.x) / size.width),
    top: clamp((workArea.position.y - position.y) / size.height),
    right: clamp((position.x + size.width - workArea.position.x - workArea.size.width) / size.width),
    bottom: clamp((position.y + size.height - workArea.position.y - workArea.size.height) / size.height),
  };
}

function safeMargins(insets: Insets) {
  return { left: Math.max(0.065, insets.left + 0.025), right: Math.max(0.065, insets.right + 0.025),
    top: Math.max(0.065, insets.top + 0.025), bottom: Math.max(0.15, insets.bottom + 0.025) };
}

export function regionForPlacement(position: Placement, width: number, height: number, insets = defaultInsets): Region {
  const index = placements.indexOf(position);
  const column = index % 3, row = Math.floor(index / 3);
  const margin = safeMargins(insets);
  width = Math.min(width, 1 - margin.left - margin.right);
  height = Math.min(height, 1 - margin.top - margin.bottom);
  return {
    x: column === 0 ? margin.left : column === 1 ? Math.max(margin.left, Math.min((1 - width) / 2, 1 - margin.right - width)) : 1 - margin.right - width,
    y: row === 0 ? margin.top : row === 1 ? Math.max(margin.top, Math.min((1 - height) / 2, 1 - margin.bottom - height)) : 1 - margin.bottom - height,
    width, height,
  };
}

export function choosePlacement(pixels: Uint8ClampedArray, width: number, height: number,
  boxWidth: number, boxHeight: number, regions: Region[], insets = defaultInsets): Placement {
  let best: Placement = 'bottom-left', bestScore = Infinity;
  const luminance = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
  };
  for (const position of placements) {
    const box = regionForPlacement(position, boxWidth, boxHeight, insets);
    let sum = 0, squared = 0, edges = 0, count = 0;
    for (let y = Math.floor(box.y * height); y < Math.min(height - 1, (box.y + box.height) * height); y++) {
      for (let x = Math.floor(box.x * width); x < Math.min(width - 1, (box.x + box.width) * width); x++) {
        const value = luminance(x, y);
        sum += value; squared += value * value;
        edges += Math.abs(value - luminance(x + 1, y)) + Math.abs(value - luminance(x, y + 1));
        count++;
      }
    }
    const mean = sum / Math.max(1, count);
    let score = edges / Math.max(1, count) * 3 + Math.max(0, squared / Math.max(1, count) - mean * mean) + mean * 0.2;
    for (const region of regions) {
      const overlap = Math.max(0, Math.min(box.x + box.width, region.x + region.width) - Math.max(box.x, region.x))
        * Math.max(0, Math.min(box.y + box.height, region.y + region.height) - Math.max(box.y, region.y));
      score += overlap / (box.width * box.height) * (region.weight ?? 3);
    }
    // Prefer a familiar lower placement when image evidence is equal.
    score += position.startsWith('bottom') ? 0 : 0.015;
    if (score < bestScore) { bestScore = score; best = position; }
  }
  return best;
}

export function rotationLength(photoCount: number, quoteCount: number, rotateQuotes: boolean) {
  if (photoCount < 1 || quoteCount < 1) throw new Error('Choose at least one photo and quotation.');
  if (!rotateQuotes) return photoCount;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  return photoCount * quoteCount / gcd(photoCount, quoteCount);
}

export async function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened. Try a JPEG or PNG.'));
    image.src = source;
  });
}

export function coverCrop(width: number, height: number, aspect: number): Region {
  if (width <= 0 || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid wallpaper dimensions.');
  const cropWidth = Math.min(width, height * aspect);
  const cropHeight = Math.min(height, width / aspect);
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

export async function prepareBackground(source: string | null, aspect: number | null = null, screenSize?: { width: number; height: number }): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare this wallpaper.');
  if (source) {
    const image = await loadImage(source);
    const crop = aspect ? coverCrop(image.naturalWidth, image.naturalHeight, aspect)
      : { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    const scale = Math.min(1, 4096 / Math.max(crop.width, crop.height));
    canvas.width = Math.max(1, Math.round(screenSize?.width ?? crop.width * scale));
    canvas.height = Math.max(1, Math.round(screenSize?.height ?? crop.height * scale));
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  } else {
    canvas.width = Math.round(screenSize?.width ?? 1920); canvas.height = Math.round(screenSize?.height ?? 1920 / (aspect ?? (16 / 9)));
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#252e40'); gradient.addColorStop(0.52, '#6d5749'); gradient.addColorStop(1, '#c89b68');
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export async function analyzeBackground(canvas: HTMLCanvasElement): Promise<Analysis> {
  const sample = document.createElement('canvas');
  const factor = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
  sample.width = Math.max(16, Math.round(canvas.width * factor));
  sample.height = Math.max(16, Math.round(canvas.height * factor));
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not analyze this wallpaper.');
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const result: Analysis = { pixels: context.getImageData(0, 0, sample.width, sample.height).data,
    width: sample.width, height: sample.height, regions: [], engine: 'Local texture & contrast' };
  if (isTauri()) {
    try {
      const native = await invoke<{ regions: Region[]; engine: string }>('analyze_wallpaper',
        { imageDataUrl: sample.toDataURL('image/jpeg', 0.85) });
      result.regions = native.regions;
      result.engine = native.engine;
    } catch {
      // Native Vision unavailable: the same offline pixel analysis still works.
      result.engine = 'Local texture & contrast (Vision unavailable)';
    }
  }
  return result;
}

export function wrapText(context: Pick<CanvasRenderingContext2D, "measureText">, text: string, maxWidth: number) {
  const lines: string[] = [];
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) =>
    { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
  const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : undefined;
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      if (context.measureText(word).width <= maxWidth) { line = word; continue; }
      const parts = segmenter ? Array.from(segmenter.segment(word), part => part.segment) : Array.from(word);
      for (const part of parts) {
        if (line && context.measureText(line + part).width > maxWidth) { lines.push(line); line = ''; }
        line += part;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function renderWallpaper(canvas: HTMLCanvasElement, quote: Quote,
  mode: PlacementMode, quoteScale: number, analysis?: Analysis, maxEdge = Infinity, insets = defaultInsets) {
  await document.fonts.ready;
  const output = document.createElement('canvas');
  const factor = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  output.width = Math.round(canvas.width * factor); output.height = Math.round(canvas.height * factor);
  const context = output.getContext('2d');
  if (!context) throw new Error('Could not render the quotation.');
  const width = output.width, height = output.height;
  context.direction = /^[^A-Za-z\u0900-\u097f]*[\u0590-\u08ff]/.test(quote.text) ? 'rtl' : 'ltr';
  context.drawImage(canvas, 0, 0, width, height);
  if (!quote.text.trim()) {
    const url = output.toDataURL('image/jpeg', 0.94);
    output.width = output.height = 1;
    return { url, position: mode === 'auto' ? 'bottom-left' as Placement : mode, engine: 'Choose a quotation' };
  }
  const margin = safeMargins(insets);
  const boxWidth = width * Math.min(width > height * 2 ? 0.32 : 0.52, 1 - margin.left - margin.right);
  let size = Math.min(width * 0.016, height * 0.036) * quoteScale / 100;
  let lines: string[] = [];
  // Fit the complete text; never truncate or silently replace the quote.
  while (size >= 3) {
    context.font = `${size}px Georgia, 'Noto Sans Devanagari', serif`;
    lines = wrapText(context, quote.text, boxWidth);
    if (lines.length * size * 1.4 + size * 1.6 <= height * 0.34
      && lines.every(line => context.measureText(line).width <= boxWidth)) break;
    size *= 0.94;
  }
  const referenceSize = Math.max(size * 0.52, width * 0.005);
  const blockHeight = lines.length * size * 1.4 + referenceSize * 2.3;
  const position = mode === 'auto' && analysis
    ? choosePlacement(analysis.pixels, analysis.width, analysis.height, boxWidth / width, blockHeight / height, analysis.regions, insets)
    : mode === 'auto' ? 'bottom-left' : mode;
  const region = regionForPlacement(position, boxWidth / width, blockHeight / height, insets);
  const column = placements.indexOf(position) % 3;
  const x = (region.x + (column === 0 ? 0 : column === 1 ? region.width / 2 : region.width)) * width;
  context.textAlign = column === 0 ? 'left' : column === 1 ? 'center' : 'right';
  context.textBaseline = 'top';
  context.fillStyle = '#f2cf92'; context.font = `600 ${referenceSize}px Arial, sans-serif`;
  context.fillText(quote.reference, x, region.y * height);
  context.fillStyle = '#fffaf0'; context.font = `${size}px Georgia, 'Noto Sans Devanagari', serif`;
  lines.forEach((line, i) => context.fillText(line, x, region.y * height + referenceSize * 2.3 + i * size * 1.4));
  const url = output.toDataURL('image/jpeg', 0.94);
  output.width = output.height = 1;
  return { url, position, engine: analysis?.engine ?? 'Manual placement' };
}
