import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotes } from '../src/quotes.ts';
import { placements, regionForPlacement, choosePlacement, rotationLength } from '../src/wallpaper.ts';

test('all nine anchors keep text inside portrait and landscape safe margins', () => {
  assert.equal(placements.length, 9);
  for (const aspect of [0.5, 16 / 9, 3]) {
    for (const p of placements) {
      const r = regionForPlacement(p, 0.42, Math.min(0.32, 0.12 * aspect));
      assert.ok(r.x >= 0.06 && r.y >= 0.06);
      assert.ok(r.x + r.width <= 0.94 + 1e-8);
      assert.ok(r.y + r.height <= 0.94 + 1e-8);
    }
  }
});

test('automatic placement chooses a quiet dark region over noisy texture', () => {
  const w = 96, h = 96;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y > 55 && x > 55 ? 20 : ((x + y) % 2 ? 255 : 0);
    pixels.set([v, v, v, 255], (y * w + x) * 4);
  }
  assert.equal(choosePlacement(pixels, w, h, 0.32, 0.18, []), 'bottom-right');
});

test('automatic placement avoids native detected faces and salient subjects', () => {
  const pixels = new Uint8ClampedArray(96 * 96 * 4);
  const p = choosePlacement(pixels, 96, 96, 0.38, 0.18,
    [{ x: 0, y: 0.55, width: 1, height: 0.45, weight: 10 }]);
  assert.ok(p.startsWith('top') || p.startsWith('middle'));
});

test('rotation covers every photo and verse before repeating the sequence', () => {
  assert.equal(rotationLength(4, 6, true), 12);
  assert.equal(rotationLength(7, 6, true), 42);
  assert.equal(rotationLength(4, 6, false), 4);
  assert.equal(rotationLength(1, 6, true), 6);
});

test('long unspaced text wraps without losing characters', async () => {
  const { wrapText } = await import('../src/wallpaper.ts');
  const text = '每天努力保持平静专注行动不要执着结果';
  const lines = wrapText({ measureText: value => ({ width: [...value].length * 10 }) }, text, 50);
  assert.ok(lines.length > 1);
  assert.ok(lines.every(line => [...line].length <= 5));
  assert.equal(lines.join(''), text);
});

test('screen crops stay centered and exclude regions outside the visible wallpaper', async () => {
  const { coverCrop } = await import('../src/wallpaper.ts');
  const landscape = coverCrop(4000, 3000, 16 / 9);
  assert.equal(landscape.width, 4000);
  assert.equal(landscape.height, 2250);
  assert.equal(landscape.y, 375);
  const portrait = coverCrop(4000, 3000, 9 / 16);
  assert.equal(portrait.height, 3000);
  assert.equal(portrait.width, 1687.5);
  assert.equal(portrait.x, (4000 - 1687.5) / 2);
});

test('wallpaper canvas uses the screen pixel resolution without a 4096-pixel cap', async () => {
  const { prepareBackground } = await import('../src/wallpaper.ts');
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  try {
    for (const size of [{ width: 2560, height: 1440 }, { width: 2940, height: 1912 }, { width: 1440, height: 2560 }, { width: 5120, height: 2880 }]) {
      const canvas = await prepareBackground(null, size.width / size.height, size);
      assert.equal(canvas.width, size.width);
      assert.equal(canvas.height, size.height);
    }
  } finally { globalThis.document = previous; }
});

 test('bottom quotations leave a Dock-safe margin at every screen resolution', () => {
  for (const screenHeight of [900, 1080, 1440, 2880]) {
    for (const position of ['bottom-left', 'bottom-center', 'bottom-right']) {
      const box = regionForPlacement(position, 0.52, 0.1);
      const bottom = (box.y + box.height) * screenHeight;
      assert.ok(screenHeight - bottom >= screenHeight * 0.15 - 1e-8);
    }
  }
});

test('quotes avoid taskbars on every edge, including offset secondary displays', async () => {
  const { workAreaInsets } = await import('../src/wallpaper.ts');
  const insets = workAreaInsets({ width: 1920, height: 1080 }, { x: -1920, y: 200 },
    { position: { x: -1760, y: 280 }, size: { width: 1700, height: 950 } });
  for (const position of placements) {
    const box = regionForPlacement(position, 0.52, 0.12, insets);
    assert.ok(box.x * 1920 >= 160);
    assert.ok(box.y * 1080 >= 80);
    assert.ok((box.x + box.width) * 1920 <= 1860);
    assert.ok((box.y + box.height) * 1080 <= 1030);
  }
});

test('automatic placement and manual anchors use the same side taskbar clearance', async () => {
  const pixels = new Uint8ClampedArray(96 * 96 * 4);
  const insets = { left: 0.25, top: 0.12, right: 0, bottom: 0 };
  const placement = choosePlacement(pixels, 96, 96, 0.52, 0.12, [], insets);
  const box = regionForPlacement(placement, 0.52, 0.12, insets);
  assert.ok(box.x >= 0.275 && box.y >= 0.145);
  assert.ok(box.x + box.width <= 0.935 + 1e-8);
});


test('the expanded quote catalog fits the schedule image limit with every supported photo count', () => {
  assert.equal(quotes.length, 18);
  const cycles = Array.from({ length: 8 }, (_, index) => rotationLength(index + 1, quotes.length, true));
  assert.equal(Math.max(...cycles), 126);
  assert.ok(cycles.every(count => count <= 128));
  for (let photoCount = 1; photoCount <= 8; photoCount++) {
    const count = cycles[photoCount - 1];
    const seen = new Set(Array.from({ length: count }, (_, index) => `${index % photoCount}:${index % quotes.length}`));
    assert.equal(seen.size, count);
    assert.equal(count % photoCount, 0);
    assert.equal(count % quotes.length, 0);
  }
});

test('an empty quotation still renders the background preview without text', async () => {
  const { renderWallpaper } = await import('../src/wallpaper.ts');
  const previous = globalThis.document;
  let draws = 0;
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: () => ({
    width: 0, height: 0, toDataURL: () => 'data:image/jpeg;base64,preview',
    getContext: () => ({ drawImage() { draws++; }, fillText() { throw new Error('Empty quote must not draw text'); }, measureText: text => ({ width: text.length * 10 }) }),
  }) };
  try {
    const result = await renderWallpaper({width: 1920, height: 1080}, {text: '', reference: 'SOURCE', theme: ''}, 'bottom-left', 100);
    assert.equal(draws, 1);
    assert.equal(result.url, 'data:image/jpeg;base64,preview');
  } finally { globalThis.document = previous; }
});
