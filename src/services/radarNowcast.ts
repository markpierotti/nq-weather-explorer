/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Short-range radar nowcast: estimate rain motion from the last few RainViewer frames, then draw the latest
 * radar frame moved along that motion. Browser side: tile fetching, the worker hand-off, and tile warping.
 *
 * Request budget: motion uses 2 low-zoom 512 px tiles per frame × 4 frames = 8 extra RainViewer requests per
 * timeline load. Drawing re-uses the latest radar frame's own map tiles (already in the browser cache), plus the
 * odd neighbouring tile that rain is moving in from.
 */

import type { RainViewerFrame } from '../types/weather';
import {
  displacementAt,
  displacementGrid,
  domainWeight,
  motionFromRgba,
  type DisplacementGrid,
  type MotionField,
  type MotionRequest,
  type MotionResult,
} from './radarMotion';

/** Motion tiles: zoom 4, 512 px, x = 14 (135°E–157.5°E), y = 8–9 (0° to 41°S): all of QLD and the east coast. */
const MOTION_ZOOM = 4;
const MOTION_TILE_PX = 512;
const MOTION_TILE_X = 14;
const MOTION_TILE_YS = [8, 9];
/** Crop the open ocean north of here (no radar coverage) to save work. */
const MOTION_NORTH_LAT = -8.5;
const MOTION_FRAMES = 4;
/** Frames must be roughly RainViewer's 10-minute cadence; anything else and the frame list is odd, so skip. */
const MIN_GAP_S = 300;
const MAX_GAP_S = 1200;
const MOTION_TIMEOUT_MS = 12000;

/** Mercator world y (0–1) for a latitude. */
function worldY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

async function loadTileRgba(url: string, signal: AbortSignal): Promise<Uint8ClampedArray> {
  const res = await fetch(url, { signal, mode: 'cors' });
  if (!res.ok) throw new Error('RainViewer tile HTTP ' + res.status);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = MOTION_TILE_PX;
  canvas.height = MOTION_TILE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, MOTION_TILE_PX, MOTION_TILE_PX);
  bitmap.close();
  return ctx.getImageData(0, 0, MOTION_TILE_PX, MOTION_TILE_PX).data;
}

function runMotion(req: MotionRequest): Promise<MotionResult> {
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./radarMotion.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) {
      resolve(motionFromRgba(req));
      return;
    }
    const w = worker;
    const timer = window.setTimeout(() => {
      w.terminate();
      resolve({ ok: false, reason: 'timed out', ms: MOTION_TIMEOUT_MS });
    }, MOTION_TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<MotionResult>) => {
      window.clearTimeout(timer);
      w.terminate();
      resolve(e.data);
    };
    w.onerror = () => {
      window.clearTimeout(timer);
      w.terminate();
      resolve({ ok: false, reason: 'worker failed', ms: 0 });
    };
    w.postMessage(req, req.rgba);
  });
}

/**
 * Estimate rain motion from the last few observed radar frames. Null (→ model-only timeline) when there are too
 * few evenly spaced frames, a tile fails, there's too little rain, or the motion doesn't beat persistence.
 */
export async function estimateRadarMotion(host: string, frames: RainViewerFrame[]): Promise<MotionField | null> {
  const past = frames.filter((f) => f.kind === 'past' && f.path);
  const recent = past.slice(-MOTION_FRAMES);
  if (recent.length < 3 || !host) return null;
  for (let i = 1; i < recent.length; i++) {
    const gap = recent[i].time - recent[i - 1].time;
    if (gap < MIN_GAP_S || gap > MAX_GAP_S) return null;
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), MOTION_TIMEOUT_MS);
  try {
    const tilesWorld = 1 << MOTION_ZOOM;
    const pixel = 1 / (tilesWorld * MOTION_TILE_PX);
    const top = MOTION_TILE_YS[0] / tilesWorld;
    const cropRows = Math.max(0, Math.floor((worldY(MOTION_NORTH_LAT) - top) / pixel));
    const width = MOTION_TILE_PX;
    const height = MOTION_TILE_PX * MOTION_TILE_YS.length - cropRows;

    const rgba = await Promise.all(
      recent.map(async (frame) => {
        const tiles = await Promise.all(
          MOTION_TILE_YS.map((y) =>
            // Colour scheme 2, unsmoothed, no snow colours: exact palette colours for the dBZ lookup.
            loadTileRgba(`${host}${frame.path}/${MOTION_TILE_PX}/${MOTION_ZOOM}/${MOTION_TILE_X}/${y}/2/0_0.png`, ctrl.signal),
          ),
        );
        const mosaic = new Uint8ClampedArray(width * height * 4);
        tiles.forEach((tile, k) => {
          const firstRow = k * MOTION_TILE_PX - cropRows; // mosaic row of this tile's row 0
          const skip = Math.max(0, -firstRow);
          mosaic.set(tile.subarray(skip * width * 4), Math.max(0, firstRow) * width * 4);
        });
        return mosaic.buffer;
      }),
    );

    const result = await runMotion({
      rgba,
      width,
      height,
      times: recent.map((f) => f.time),
      originX: MOTION_TILE_X / tilesWorld,
      originY: top + cropRows * pixel,
      pixel,
    });
    if ('reason' in result) {
      console.info(`Radar nowcast skipped: ${result.reason}`);
      return null;
    }
    console.info(
      `Radar nowcast: mean motion ${result.field.meanSpeedKmh.toFixed(0)} km/h, skill ${result.field.skill.toFixed(2)}, ${result.ms.toFixed(0)} ms`,
    );
    return result.field;
  } catch (err) {
    console.warn('Radar nowcast skipped:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Drawing: warp the latest radar frame's map tiles along the back-trajectories.
// ---------------------------------------------------------------------------

/** Motion is extrapolated this far past the radar domain (world units, ~1.5°) before easing out. */
const DOMAIN_MARGIN = 1.5 / 360;
/** Outside the motion domain the last radar frame just stays put and fades out over this long. */
const PERSIST_FADE_S = 3600;
const RAINVIEWER_MAX_NATIVE_ZOOM = 7;
const SOURCE_CACHE_MAX = 64;

const displacementCache = new WeakMap<MotionField, Map<number, DisplacementGrid>>();

function getDisplacement(field: MotionField, seconds: number): DisplacementGrid {
  let byLead = displacementCache.get(field);
  if (!byLead) {
    byLead = new Map();
    displacementCache.set(field, byLead);
  }
  let grid = byLead.get(seconds);
  if (!grid) {
    grid = displacementGrid(field, seconds);
    byLead.set(seconds, grid);
  }
  return grid;
}

/** A decoded radar map tile, plus which 16 px blocks hold any rain (most don't, and are skipped). */
interface SourceTile {
  data: Uint8ClampedArray;
  occupied: Uint8Array;
}
const OCC_PX = 16;
const OCC_N = 256 / OCC_PX;

/** Decoded radar map tiles, shared across nowcast frames: every frame warps the same latest radar frame. */
const sourceCache = new Map<string, Promise<SourceTile | null>>();

/** Same URL as the radar layer's tiles, so these come straight from the browser cache. */
export function radarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/256/${z}/${x}/${y}/1/1_1.png`;
}

function decodeSource(img: HTMLImageElement): SourceTile | null {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 256, 256);
  const data = ctx.getImageData(0, 0, 256, 256).data;
  const occupied = new Uint8Array(OCC_N * OCC_N);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      if (data[(y * 256 + x) * 4 + 3]) occupied[((y / OCC_PX) | 0) * OCC_N + ((x / OCC_PX) | 0)] = 1;
    }
  }
  return { data, occupied };
}

function loadSource(url: string): Promise<SourceTile | null> {
  const hit = sourceCache.get(url);
  if (hit) {
    sourceCache.delete(url); // refresh LRU order
    sourceCache.set(url, hit);
    return hit;
  }
  const p = new Promise<SourceTile | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(decodeSource(img));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  sourceCache.set(url, p);
  while (sourceCache.size > SOURCE_CACHE_MAX) {
    const oldest = sourceCache.keys().next().value;
    if (oldest === undefined) break;
    sourceCache.delete(oldest);
  }
  return p;
}

export interface NowcastTileSpec {
  host: string;
  radarPath: string;
  field: MotionField;
  seconds: number;
}

/** Output pixels between back-trajectory samples; displacement is bilinear in between (the field is smooth). */
const LATTICE_PX = 16;

/**
 * Draw one map tile of the nowcast: each output pixel takes the latest radar colour from where its
 * back-trajectory started (bilinear, premultiplied). Returns the canvas at once and paints it when the source
 * tiles are ready (in the same task if they're cached). Null when nothing can show on this tile.
 */
export function drawNowcastTile(
  ownerDocument: Document,
  spec: NowcastTileSpec,
  x: number,
  y: number,
  zoom: number,
): HTMLCanvasElement | null {
  const { field, seconds } = spec;
  const persist = Math.max(0, 1 - seconds / PERSIST_FADE_S);
  const n = 1 << zoom;
  const b = field.bounds;
  const tx0 = x / n;
  const ty0 = y / n;
  const tw = 1 / n;
  const outside =
    tx0 + tw < b.x0 - DOMAIN_MARGIN || tx0 > b.x1 + DOMAIN_MARGIN || ty0 + tw < b.y0 - DOMAIN_MARGIN || ty0 > b.y1 + DOMAIN_MARGIN;
  if (outside && persist <= 0) return null;

  const nz = Math.min(zoom, RAINVIEWER_MAX_NATIVE_ZOOM);
  const nativeWorld = 256 * (1 << nz); // native pixels across the world
  // Output at the radar's native resolution (never below 32 px, so deep zooms still interpolate smoothly).
  const out = Math.max(32, Math.min(256, 256 >> (zoom - nz)));
  const disp = getDisplacement(field, seconds);

  // Lattice of source positions (native pixels) and alpha multipliers at block corners.
  const blocks = out / LATTICE_PX;
  const ln = blocks + 1;
  const lx = new Float32Array(ln * ln);
  const ly = new Float32Array(ln * ln);
  const lm = new Float32Array(ln * ln);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < ln; j++) {
    const wy = ty0 + ((j * LATTICE_PX) / out) * tw;
    for (let i = 0; i < ln; i++) {
      const wx = tx0 + ((i * LATTICE_PX) / out) * tw;
      const dw = domainWeight(field, wx, wy, DOMAIN_MARGIN);
      let sx = wx;
      let sy = wy;
      if (dw > 0) {
        const [dx, dy] = displacementAt(disp, wx, wy);
        sx -= dx * dw;
        sy -= dy * dw;
      }
      const k = j * ln + i;
      lx[k] = sx * nativeWorld - 0.5;
      ly[k] = sy * nativeWorld - 0.5;
      lm[k] = dw + (1 - dw) * persist;
      minX = Math.min(minX, lx[k]);
      maxX = Math.max(maxX, lx[k]);
      minY = Math.min(minY, ly[k]);
      maxY = Math.max(maxY, ly[k]);
    }
  }

  const nTiles = 1 << nz;
  const stx0 = Math.floor(minX / 256);
  const stx1 = Math.floor((maxX + 1) / 256);
  const sty0 = Math.max(0, Math.floor(minY / 256));
  const sty1 = Math.min(nTiles - 1, Math.floor((maxY + 1) / 256));
  const cols = stx1 - stx0 + 1;
  const rows = sty1 - sty0 + 1;
  if (cols <= 0 || rows <= 0 || cols * rows > 9) return null;

  const canvas = ownerDocument.createElement('canvas');
  canvas.width = out;
  canvas.height = out;

  const urls: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wrapX = (((stx0 + c) % nTiles) + nTiles) % nTiles;
      urls.push(radarTileUrl(spec.host, spec.radarPath, nz, wrapX, sty0 + r));
    }
  }

  const paint = (tiles: Array<SourceTile | null>) => {
    if (tiles.every((t) => !t)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let img: ImageData | null = null;

    /** Any rain in the source box [x0, x1] × [y0, y1] (native pixels)? */
    const anyRain = (x0: number, y0: number, x1: number, y1: number) => {
      const cx0 = Math.floor(x0 / OCC_PX);
      const cx1 = Math.floor(x1 / OCC_PX);
      const cy0 = Math.floor(y0 / OCC_PX);
      const cy1 = Math.floor(y1 / OCC_PX);
      for (let cy = cy0; cy <= cy1; cy++) {
        const rr = Math.floor(cy / OCC_N) - sty0;
        if (rr < 0 || rr >= rows) continue;
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = Math.floor(cx / OCC_N) - stx0;
          if (c < 0 || c >= cols) continue;
          const t = tiles[rr * cols + c];
          if (t && t.occupied[(cy & (OCC_N - 1)) * OCC_N + (cx & (OCC_N - 1))]) return true;
        }
      }
      return false;
    };

    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        const k00 = by * ln + bx;
        const k10 = k00 + 1;
        const k01 = k00 + ln;
        const k11 = k01 + 1;
        const m00 = lm[k00];
        const m10 = lm[k10];
        const m01 = lm[k01];
        const m11 = lm[k11];
        if (m00 <= 0 && m10 <= 0 && m01 <= 0 && m11 <= 0) continue;
        const x00 = lx[k00];
        const x10 = lx[k10];
        const x01 = lx[k01];
        const x11 = lx[k11];
        const y00 = ly[k00];
        const y10 = ly[k10];
        const y01 = ly[k01];
        const y11 = ly[k11];
        // Bilinear between corners: the block's source area is bounded by its corners.
        if (
          !anyRain(
            Math.min(x00, x10, x01, x11) - 1,
            Math.min(y00, y10, y01, y11) - 1,
            Math.max(x00, x10, x01, x11) + 1,
            Math.max(y00, y10, y01, y11) + 1,
          )
        ) {
          continue;
        }
        if (!img) img = ctx.createImageData(out, out);
        const dst = img.data;
        for (let pj = 0; pj < LATTICE_PX; pj++) {
          const v = (pj + 0.5) / LATTICE_PX;
          const xa = x00 + (x01 - x00) * v;
          const xb = x10 + (x11 - x10) * v;
          const ya = y00 + (y01 - y00) * v;
          const yb = y10 + (y11 - y10) * v;
          const ma = m00 + (m01 - m00) * v;
          const mb = m10 + (m11 - m10) * v;
          const rowOut = (by * LATTICE_PX + pj) * out + bx * LATTICE_PX;
          for (let pi = 0; pi < LATTICE_PX; pi++) {
            const u = (pi + 0.5) / LATTICE_PX;
            const mul = ma + (mb - ma) * u;
            if (mul <= 0) continue;
            const fx = xa + (xb - xa) * u;
            const fy = ya + (yb - ya) * u;
            const ix = Math.floor(fx);
            const iy = Math.floor(fy);
            const ax = fx - ix;
            const ay = fy - iy;
            let r = 0;
            let g = 0;
            let bl = 0;
            let a = 0;
            const c0 = Math.floor(ix / 256) - stx0;
            const r0 = Math.floor(iy / 256) - sty0;
            if ((ix & 255) < 255 && (iy & 255) < 255) {
              // Fast path: all four taps in one source tile.
              const t = c0 >= 0 && c0 < cols && r0 >= 0 && r0 < rows ? tiles[r0 * cols + c0] : null;
              if (!t) continue;
              const d = t.data;
              const o00 = (((iy & 255) << 8) | (ix & 255)) * 4;
              const o10 = o00 + 4;
              const o01 = o00 + 1024;
              const o11 = o01 + 4;
              const w00 = (1 - ax) * (1 - ay) * d[o00 + 3];
              const w10 = ax * (1 - ay) * d[o10 + 3];
              const w01 = (1 - ax) * ay * d[o01 + 3];
              const w11 = ax * ay * d[o11 + 3];
              a = w00 + w10 + w01 + w11;
              if (a < 0.5) continue;
              r = d[o00] * w00 + d[o10] * w10 + d[o01] * w01 + d[o11] * w11;
              g = d[o00 + 1] * w00 + d[o10 + 1] * w10 + d[o01 + 1] * w01 + d[o11 + 1] * w11;
              bl = d[o00 + 2] * w00 + d[o10 + 2] * w10 + d[o01 + 2] * w01 + d[o11 + 2] * w11;
            } else {
              for (let t = 0; t < 4; t++) {
                const px = ix + (t & 1);
                const py = iy + (t >> 1);
                const c = Math.floor(px / 256) - stx0;
                const rr = Math.floor(py / 256) - sty0;
                if (c < 0 || c >= cols || rr < 0 || rr >= rows) continue;
                const tile = tiles[rr * cols + c];
                if (!tile) continue;
                const o = (((py & 255) << 8) | (px & 255)) * 4;
                const wa = (t & 1 ? ax : 1 - ax) * (t >> 1 ? ay : 1 - ay) * tile.data[o + 3];
                r += tile.data[o] * wa;
                g += tile.data[o + 1] * wa;
                bl += tile.data[o + 2] * wa;
                a += wa;
              }
              if (a < 0.5) continue;
            }
            const o = (rowOut + pi) * 4;
            dst[o] = r / a;
            dst[o + 1] = g / a;
            dst[o + 2] = bl / a;
            dst[o + 3] = a * mul;
          }
        }
      }
    }
    if (img) ctx.putImageData(img, 0, 0);
  };

  Promise.all(urls.map(loadSource)).then(paint);
  return canvas;
}
