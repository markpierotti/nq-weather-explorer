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
    console.warn('Radar motion estimate failed:', err);
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

/** Decoded radar map tiles (RGBA), shared across nowcast frames: every frame warps the same latest radar frame. */
const sourceCache = new Map<string, Promise<Uint8ClampedArray | null>>();

/** Same URL as the radar layer's tiles, so these come straight from the browser cache. */
export function radarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/256/${z}/${x}/${y}/1/1_1.png`;
}

function loadSource(url: string): Promise<Uint8ClampedArray | null> {
  const hit = sourceCache.get(url);
  if (hit) {
    sourceCache.delete(url); // refresh LRU order
    sourceCache.set(url, hit);
    return hit;
  }
  const p = new Promise<Uint8ClampedArray | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 256, 256);
        resolve(ctx.getImageData(0, 0, 256, 256).data);
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

/**
 * Draw one map tile of the nowcast: each output pixel takes the latest radar colour from where its
 * back-trajectory started (bilinear, premultiplied). Returns the canvas at once and paints it when the source
 * tiles are ready (synchronously if they're cached). Null when nothing can show on this tile.
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
  const out = Math.max(32, Math.min(256, 256 >> (zoom - nz)));
  const disp = getDisplacement(field, seconds);

  // Per output pixel: source position in native pixels and an alpha multiplier.
  const srcX = new Float32Array(out * out);
  const srcY = new Float32Array(out * out);
  const mul = new Float32Array(out * out);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < out; j++) {
    const wy = ty0 + ((j + 0.5) / out) * tw;
    for (let i = 0; i < out; i++) {
      const wx = tx0 + ((i + 0.5) / out) * tw;
      const dw = domainWeight(field, wx, wy, DOMAIN_MARGIN);
      let sx = wx;
      let sy = wy;
      if (dw > 0) {
        const [dx, dy] = displacementAt(disp, wx, wy);
        sx -= dx * dw;
        sy -= dy * dw;
      }
      const k = j * out + i;
      srcX[k] = sx * nativeWorld - 0.5;
      srcY[k] = sy * nativeWorld - 0.5;
      mul[k] = dw + (1 - dw) * persist;
      if (srcX[k] < minX) minX = srcX[k];
      if (srcX[k] > maxX) maxX = srcX[k];
      if (srcY[k] < minY) minY = srcY[k];
      if (srcY[k] > maxY) maxY = srcY[k];
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

  const paint = (tiles: Array<Uint8ClampedArray | null>) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(out, out);
    const dst = img.data;
    // Premultiplied bilinear tap accumulation.
    for (let k = 0; k < out * out; k++) {
      if (mul[k] <= 0) continue;
      const fx = srcX[k];
      const fy = srcY[k];
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let t = 0; t < 4; t++) {
        const px = x0 + (t & 1);
        const py = y0 + (t >> 1);
        const wgt = (t & 1 ? ax : 1 - ax) * (t >> 1 ? ay : 1 - ay);
        if (wgt <= 0) continue;
        const c = Math.floor(px / 256) - stx0;
        const rr = Math.floor(py / 256) - sty0;
        if (c < 0 || c >= cols || rr < 0 || rr >= rows) continue;
        const tile = tiles[rr * cols + c];
        if (!tile) continue;
        const o = (((py & 255) << 8) | (px & 255)) * 4;
        const ta = tile[o + 3] * wgt;
        if (ta === 0) continue;
        r += tile[o] * ta;
        g += tile[o + 1] * ta;
        bl += tile[o + 2] * ta;
        a += ta;
      }
      if (a < 0.5) continue;
      const o = k * 4;
      dst[o] = r / a;
      dst[o + 1] = g / a;
      dst[o + 2] = bl / a;
      dst[o + 3] = a * mul[k];
    }
    ctx.putImageData(img, 0, 0);
  };

  Promise.all(urls.map(loadSource)).then(paint);
  return canvas;
}
