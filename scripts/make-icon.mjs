// Draws Git Status.app's icon and packs it into Contents/Resources/AppIcon.icns.
//
//   node scripts/make-icon.mjs      (or: npm run icon)
//
// The icon is defined as vector shapes below and rasterised here, at every size the
// iconset needs, with real alpha. It is done by hand because the obvious shortcut —
// letting QuickLook rasterise an SVG — flattens the transparency onto white, which
// puts a white box behind the icon everywhere macOS draws it.
//
// No dependencies: signed-distance fields for the shapes, node:zlib for the PNGs,
// and /usr/bin/iconutil to pack them. Also writes assets/icon.svg as a preview,
// from the same constants, so the two cannot drift.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const CANVAS = 1024;

// ── The icon ──────────────────────────────────────────────────────────────────
// Three repo cards threaded on a commit rail. The dots are the dashboard's own
// status colours: diverged, behind, in sync.
const BODY = { x: 100, y: 100, w: 824, h: 824, r: 185 };
const BODY_STOPS = [
  [0, '#3a3934'],
  [0.55, '#24231f'],
  [1, '#141413'],
];
const RAIL = { x: 270, y1: 330, y2: 694, w: 12, color: '#57554f' };
const CARDS = [
  { y: 298, dot: '#f28b82', bar: 404 },
  { y: 454, dot: '#e0a458', bar: 300 },
  { y: 610, dot: '#6cc08b', bar: 356 },
];
const CARD = { x: 196, w: 632, h: 116, r: 34, fill: [255, 255, 255, 0.07] };
const DOT_R = 32;
const BAR = { x: 344, h: 24, fill: [255, 255, 255, 0.3] };
const SHADOW = { dy: 24, blur: 34, alpha: 0.25 };

// ── Geometry ──────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Signed distance to a rounded rectangle: negative inside, in the same units as the inputs. */
function sdRoundedRect(px, py, { x, y, w, h, r }) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

/** Signed distance to a vertical capsule — the commit rail, with its round caps. */
function sdVerticalCapsule(px, py, x, y1, y2, r) {
  const cy = Math.min(Math.max(py, y1), y2);
  return Math.hypot(px - x, py - cy) - r;
}

// ── Rasteriser ────────────────────────────────────────────────────────────────
// One premultiplied RGBA float canvas, painted back to front. Anti-aliasing comes
// from the distance field: a pixel one unit outside an edge is empty, one unit
// inside is full, and the boundary is linear across that.
function createCanvas(size) {
  return { size, scale: size / CANVAS, data: new Float64Array(size * size * 4) };
}

function paint(canvas, { sd, color }) {
  const { size, scale, data } = canvas;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sample at the pixel centre, in design units.
      const x = (px + 0.5) / scale;
      const y = (py + 0.5) / scale;
      const coverage = clamp01(0.5 - sd(x, y) * scale);
      if (coverage <= 0) continue;

      const [r, g, b, a] = color(x, y);
      const alpha = a * coverage;
      if (alpha <= 0) continue;

      const i = (py * size + px) * 4;
      const keep = 1 - alpha;
      data[i] = (r / 255) * alpha + data[i] * keep;
      data[i + 1] = (g / 255) * alpha + data[i + 1] * keep;
      data[i + 2] = (b / 255) * alpha + data[i + 2] * keep;
      data[i + 3] = alpha + data[i + 3] * keep;
    }
  }
}

const solid = (r, g, b, a = 1) => () => [r, g, b, a];

/** Vertical gradient across the body, interpolated between stops. */
function verticalGradient(stops, { y, h }) {
  const parsed = stops.map(([at, hex]) => [at, rgb(hex)]);
  return (_x, py) => {
    const t = clamp01((py - y) / h);
    let i = 1;
    while (i < parsed.length - 1 && parsed[i][0] < t) i++;
    const [t0, c0] = parsed[i - 1];
    const [t1, c1] = parsed[i];
    const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    return [...c0.map((c, j) => c + (c1[j] - c) * k), 1];
  };
}

function toRgbaBytes({ size, data }) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = data[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      // Un-premultiply, so the PNG keeps its colour where the icon is translucent.
      out[i * 4 + c] = a === 0 ? 0 : Math.round(clamp01(data[i * 4 + c] / a) * 255);
    }
    out[i * 4 + 3] = Math.round(clamp01(a) * 255);
  }
  return out;
}

function drawIcon(size) {
  const canvas = createCanvas(size);

  // Soft drop shadow, so the icon sits on a light background as well as a dark one.
  const shadowRect = { ...BODY, y: BODY.y + SHADOW.dy };
  paint(canvas, {
    sd: (x, y) => sdRoundedRect(x, y, shadowRect) - SHADOW.blur,
    color: (x, y) => {
      const d = sdRoundedRect(x, y, shadowRect);
      const falloff = d <= 0 ? 1 : clamp01(1 - d / SHADOW.blur) ** 2;
      return [0, 0, 0, SHADOW.alpha * falloff];
    },
  });

  paint(canvas, {
    sd: (x, y) => sdRoundedRect(x, y, BODY),
    color: verticalGradient(BODY_STOPS, BODY),
  });

  // Light catching the top of the body.
  paint(canvas, {
    sd: (x, y) => sdRoundedRect(x, y, BODY),
    color: (_x, y) => [255, 255, 255, 0.1 * (1 - clamp01((y - BODY.y) / BODY.h)) ** 2],
  });

  paint(canvas, {
    sd: (x, y) => sdVerticalCapsule(x, y, RAIL.x, RAIL.y1, RAIL.y2, RAIL.w / 2),
    color: solid(...rgb(RAIL.color)),
  });

  for (const card of CARDS) {
    const box = { x: CARD.x, y: card.y, w: CARD.w, h: CARD.h, r: CARD.r };
    const mid = card.y + CARD.h / 2;
    paint(canvas, { sd: (x, y) => sdRoundedRect(x, y, box), color: solid(...CARD.fill) });
    paint(canvas, {
      sd: (x, y) => sdCircle(x, y, RAIL.x, mid, DOT_R),
      color: solid(...rgb(card.dot)),
    });
    paint(canvas, {
      sd: (x, y) =>
        sdRoundedRect(x, y, {
          x: BAR.x,
          y: mid - BAR.h / 2,
          w: card.bar,
          h: BAR.h,
          r: BAR.h / 2,
        }),
      color: solid(...BAR.fill),
    });
  }

  return canvas;
}

// ── PNG ───────────────────────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── SVG preview, from the same constants ──────────────────────────────────────
function toSvg() {
  const rect = ({ x, y, w, h, r }, fill, opacity = '') =>
    `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${opacity}/>`;
  const alpha = (a) => ` fill-opacity="${a}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <!-- Preview only. Generated by scripts/make-icon.mjs, which also renders the real
       AppIcon.icns; edit the constants there, not this file. -->
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
${BODY_STOPS.map(([at, hex]) => `      <stop offset="${at}" stop-color="${hex}"/>`).join('\n')}
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${SHADOW.dy}" stdDeviation="${SHADOW.blur / 2.5}"
                    flood-color="#000000" flood-opacity="${SHADOW.alpha}"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
${rect(BODY, 'url(#body)')}
${rect(BODY, 'url(#gloss)')}
  </g>
  <path d="M${RAIL.x} ${RAIL.y1} V${RAIL.y2}" stroke="${RAIL.color}" stroke-width="${RAIL.w}" stroke-linecap="round" fill="none"/>
${CARDS.map((card) => {
  const mid = card.y + CARD.h / 2;
  return [
    rect({ x: CARD.x, y: card.y, w: CARD.w, h: CARD.h, r: CARD.r }, '#ffffff', alpha(CARD.fill[3])),
    `  <circle cx="${RAIL.x}" cy="${mid}" r="${DOT_R}" fill="${card.dot}"/>`,
    rect(
      { x: BAR.x, y: mid - BAR.h / 2, w: card.bar, h: BAR.h, r: BAR.h / 2 },
      '#ffffff',
      alpha(BAR.fill[3]),
    ),
  ].join('\n');
}).join('\n')}
</svg>
`;
}

// ── Build ─────────────────────────────────────────────────────────────────────
// name → pixel size. Sizes shared between two entries are drawn once.
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const work = mkdtempSync(join(tmpdir(), 'git-status-icon-'));
const iconset = join(work, 'AppIcon.iconset');
mkdirSync(iconset);

try {
  const rendered = new Map();
  for (const [name, size] of ICONSET) {
    if (!rendered.has(size)) {
      const canvas = drawIcon(size);
      const bytes = toRgbaBytes(canvas);
      // The corners must be transparent — an opaque one means a white box in the Dock.
      if (bytes[3] !== 0) throw new Error(`corner of the ${size}px icon is not transparent`);
      rendered.set(size, encodePng(size, bytes));
    }
    writeFileSync(join(iconset, name), rendered.get(size));
    process.stdout.write(`  ${name} (${size}px)\n`);
  }

  const icns = join(REPO, 'Git Status.app', 'Contents', 'Resources', 'AppIcon.icns');
  mkdirSync(dirname(icns), { recursive: true });
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', iconset, '--output', icns]);

  writeFileSync(join(REPO, 'assets', 'icon.svg'), toSvg());

  // Finder caches an app's icon against the bundle's mtime.
  execFileSync('/usr/bin/touch', [join(REPO, 'Git Status.app')]);
  console.log(`wrote ${icns}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
