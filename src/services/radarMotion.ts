/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rain motion (optical flow) from a short sequence of radar intensity images, and the back-trajectories used to
 * advect the latest radar image forward. Pure maths, no DOM: see radarNowcast.ts for tile loading and drawing.
 *
 * Method: multi-frame pyramidal Lucas–Kanade. One velocity field v(x) is fitted so every older frame k, moved
 * forward by v · (t_last − t_k), lines up with the latest frame; the per-pixel normal equations of all frame pairs
 * are summed, so long baselines (30 min) dominate and give sub-pixel precision. After each iteration the field is
 * smoothed by normalised convolution weighted by the local structure tensor's smaller eigenvalue, so dry or
 * featureless areas take their motion from nearby rain, then from the domain-wide mean.
 */

/** A grayscale image: intensity 0 (dry) to ~1 (very heavy), row-major, rows north to south. */
export interface IntensityImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** Rain velocity on a regular grid in normalised Web Mercator world coordinates ([0, 1) on both axes). */
export interface MotionField {
  /** World coordinates of node (0, 0) and the node spacing. */
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Velocity at each node, world units per second; index row * cols + col, rows north to south. */
  u: Float32Array;
  v: Float32Array;
  /** World-coordinate box the radar images covered (motion is only trusted inside it). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Confidence-weighted mean speed, km/h (at the domain's middle latitude), for diagnostics. */
  meanSpeedKmh: number;
  /** 1 − SSD(advected oldest frame vs latest) / SSD(unmoved oldest vs latest): > 0 means motion beats persistence. */
  skill: number;
  /** Share of domain pixels with rain in the latest frame. */
  rainFraction: number;
}

export interface MotionInput {
  frames: IntensityImage[];
  /** Unix seconds for each frame, oldest first; the last is the frame being advected. */
  times: number[];
  /** World coordinates of pixel (0, 0)'s top-left corner and the pixel size, in world units. */
  originX: number;
  originY: number;
  pixel: number;
}

const LEVELS = 3;
const ITERATIONS = [3, 4, 4]; // per level, finest first
const WINDOW_RADIUS = 4; // Lucas–Kanade window: (2r + 1)² pixels at every pyramid level
const SMOOTH_SIGMA = 2.5; // field smoothing per level, pixels
const GRID_CELL_PX = 8;
/** Faster than this (km/h) is treated as an estimation failure rather than real rain motion. */
export const MAX_SPEED_KMH = 160;
const RAIN_THRESHOLD = 0.08;
const EARTH_CIRCUMFERENCE_KM = 40075.016686;

function downsample(img: IntensityImage): IntensityImage {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = new Float32Array(w * h);
  const src = img.data;
  const sw = img.width;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * sw;
    const r1 = Math.min(2 * y + 1, img.height - 1) * sw;
    for (let x = 0; x < w; x++) {
      const c0 = 2 * x;
      const c1 = Math.min(2 * x + 1, sw - 1);
      out[y * w + x] = 0.25 * (src[r0 + c0] + src[r0 + c1] + src[r1 + c0] + src[r1 + c1]);
    }
  }
  return { width: w, height: h, data: out };
}

/** Separable Gaussian blur, clamped edges. */
function gaussianBlur(data: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = new Float32Array(2 * radius + 1);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    ksum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        s += data[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        s += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

/** In-place box sum over a (2r + 1)² window via running sums, clamped edges. */
function boxFilter(data: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += data[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s;
      s += data[row + Math.min(w - 1, x + r + 1)] - data[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      data[y * w + x] = s;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

function sampleBilinear(data: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0;
  else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0;
  else if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Upsample a per-pixel field to the next finer pyramid level (bilinear). */
function upsampleField(f: Float32Array, w: number, h: number, W: number, H: number, scale: number): Float32Array {
  const out = new Float32Array(W * H);
  const sx = w / W;
  const sy = h / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[y * W + x] = scale * sampleBilinear(f, w, h, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
    }
  }
  return out;
}

interface LevelResult {
  u: Float32Array;
  v: Float32Array;
  weight: Float32Array;
}

/**
 * Iterate Lucas–Kanade at one pyramid level. u, v are pixels per second at this level and are refined in place.
 */
function refineLevel(
  imgs: Float32Array[],
  lags: number[],
  w: number,
  h: number,
  u: Float32Array,
  v: Float32Array,
  iterations: number,
  maxSpeedPx: number,
): Float32Array {
  const n = w * h;
  const last = imgs[imgs.length - 1];
  const a11 = new Float32Array(n);
  const a12 = new Float32Array(n);
  const a22 = new Float32Array(n);
  const b1 = new Float32Array(n);
  const b2 = new Float32Array(n);
  const warped = new Float32Array(n);
  const tmp = new Float32Array(n);
  let weight = new Float32Array(n);

  for (let it = 0; it < iterations; it++) {
    a11.fill(0);
    a12.fill(0);
    a22.fill(0);
    b1.fill(0);
    b2.fill(0);
    for (let k = 0; k < imgs.length - 1; k++) {
      const src = imgs[k];
      const dt = lags[k];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          warped[i] = sampleBilinear(src, w, h, x - u[i] * dt, y - v[i] * dt);
        }
      }
      for (let y = 0; y < h; y++) {
        const ym = y > 0 ? y - 1 : y;
        const yp = y < h - 1 ? y + 1 : y;
        for (let x = 0; x < w; x++) {
          const xm = x > 0 ? x - 1 : x;
          const xp = x < w - 1 ? x + 1 : x;
          const i = y * w + x;
          const gx = 0.25 * (warped[y * w + xp] - warped[y * w + xm] + last[y * w + xp] - last[y * w + xm]) * (2 / (xp - xm || 1));
          const gy = 0.25 * (warped[yp * w + x] - warped[ym * w + x] + last[yp * w + x] - last[ym * w + x]) * (2 / (yp - ym || 1));
          const diff = warped[i] - last[i]; // = −I_t
          const gxd = gx * dt;
          const gyd = gy * dt;
          a11[i] += gxd * gxd;
          a12[i] += gxd * gyd;
          a22[i] += gyd * gyd;
          b1[i] += gxd * diff;
          b2[i] += gyd * diff;
        }
      }
    }
    boxFilter(a11, w, h, WINDOW_RADIUS, tmp);
    boxFilter(a12, w, h, WINDOW_RADIUS, tmp);
    boxFilter(a22, w, h, WINDOW_RADIUS, tmp);
    boxFilter(b1, w, h, WINDOW_RADIUS, tmp);
    boxFilter(b2, w, h, WINDOW_RADIUS, tmp);

    // Tikhonov term: a small fraction of the strongest structure, so flat areas get ~0 update and edges get
    // their normal-flow component instead of blowing up (aperture problem).
    let maxTrace = 0;
    for (let i = 0; i < n; i++) maxTrace = Math.max(maxTrace, a11[i] + a22[i]);
    if (maxTrace <= 0) return weight;
    const lambda = maxTrace * 1e-3;

    const du = tmp; // reuse
    const dv = warped;
    for (let i = 0; i < n; i++) {
      const p = a11[i] + lambda;
      const q = a12[i];
      const r = a22[i] + lambda;
      const det = p * r - q * q;
      du[i] = (r * b1[i] - q * b2[i]) / det;
      dv[i] = (p * b2[i] - q * b1[i]) / det;
      const tr = a11[i] + a22[i];
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * (a11[i] * a22[i] - q * q)));
      weight[i] = Math.max(0, (tr - disc) / 2) / maxTrace; // smaller eigenvalue, normalised
    }
    for (let i = 0; i < n; i++) {
      u[i] += du[i];
      v[i] += dv[i];
    }
    weight = smoothField(u, v, weight, w, h, maxSpeedPx);
  }
  return weight;
}

/**
 * Normalised convolution: u ← G∗(w·u) / (G∗w + ε) with ε pulling toward the confidence-weighted mean, so
 * areas with no trackable rain inherit motion from their surroundings. Returns the smoothed weight map.
 */
function smoothField(
  u: Float32Array,
  v: Float32Array,
  weight: Float32Array,
  w: number,
  h: number,
  maxSpeedPx: number,
): Float32Array {
  const n = w * h;
  const wu = new Float32Array(n);
  const wv = new Float32Array(n);
  let sw = 0;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < n; i++) {
    wu[i] = weight[i] * u[i];
    wv[i] = weight[i] * v[i];
    sw += weight[i];
    su += wu[i];
    sv += wv[i];
  }
  const meanU = sw > 0 ? su / sw : 0;
  const meanV = sw > 0 ? sv / sw : 0;
  const gw = gaussianBlur(weight, w, h, SMOOTH_SIGMA);
  const gu = gaussianBlur(wu, w, h, SMOOTH_SIGMA);
  const gv = gaussianBlur(wv, w, h, SMOOTH_SIGMA);
  // ε relative to typical confidence where there is rain, so dry areas lean on the mean.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, gw[i]);
  const eps = peak * 0.02 + 1e-12;
  for (let i = 0; i < n; i++) {
    let uu = (gu[i] + eps * meanU) / (gw[i] + eps);
    let vv = (gv[i] + eps * meanV) / (gw[i] + eps);
    const s = Math.hypot(uu, vv);
    if (s > maxSpeedPx) {
      uu *= maxSpeedPx / s;
      vv *= maxSpeedPx / s;
    }
    u[i] = uu;
    v[i] = vv;
  }
  return gw;
}

/** Mercator world y → latitude (degrees). */
function latAtWorldY(wy: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
}

/**
 * Estimate the rain motion field. Returns null when there are too few frames or too little rain to track.
 */
export function estimateMotion(input: MotionInput): MotionField | null {
  const { frames, times, originX, originY, pixel } = input;
  if (frames.length < 2 || frames.length !== times.length) return null;
  const W = frames[0].width;
  const H = frames[0].height;
  if (frames.some((f) => f.width !== W || f.height !== H)) return null;
  const lastT = times[times.length - 1];
  const lags = times.map((t) => lastT - t);
  if (lags.slice(0, -1).some((l) => !(l > 0))) return null;

  const midLat = latAtWorldY(originY + (H * pixel) / 2);
  const kmPerPx = EARTH_CIRCUMFERENCE_KM * pixel * Math.cos((midLat * Math.PI) / 180);

  // Rain coverage in the latest frame: nothing to track → no nowcast.
  const latest = frames[frames.length - 1].data;
  let rainy = 0;
  for (let i = 0; i < latest.length; i++) if (latest[i] > RAIN_THRESHOLD) rainy++;
  const rainFraction = rainy / latest.length;

  // Light smoothing suppresses speckle and makes gradients meaningful on 1–2 px cells.
  let pyr: Float32Array[][] = [frames.map((f) => gaussianBlur(f.data, W, H, 1))];
  const sizes: Array<[number, number]> = [[W, H]];
  for (let l = 1; l < LEVELS; l++) {
    const [pw, ph] = sizes[l - 1];
    const next = pyr[l - 1].map((d) => downsample({ width: pw, height: ph, data: d }));
    sizes.push([next[0].width, next[0].height]);
    pyr.push(next.map((n) => n.data));
  }

  let u = new Float32Array(sizes[LEVELS - 1][0] * sizes[LEVELS - 1][1]);
  let v = new Float32Array(u.length);
  let weight: Float32Array = new Float32Array(u.length);
  for (let l = LEVELS - 1; l >= 0; l--) {
    const [w, h] = sizes[l];
    if (l < LEVELS - 1) {
      const [pw, ph] = sizes[l + 1];
      u = upsampleField(u, pw, ph, w, h, w / pw);
      v = upsampleField(v, pw, ph, w, h, h / ph);
    }
    const maxSpeedPx = MAX_SPEED_KMH / 3600 / (kmPerPx * (W / w));
    weight = refineLevel(pyr[l], lags, w, h, u, v, ITERATIONS[l], maxSpeedPx);
  }
  pyr = [];

  // Skill: does moving the oldest frame along the field match the latest better than leaving it in place?
  const oldest = gaussianBlur(frames[0].data, W, H, 1);
  const newest = gaussianBlur(latest, W, H, 1);
  let ssdAdv = 0;
  let ssdPers = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const moved = sampleBilinear(oldest, W, H, x - u[i] * lags[0], y - v[i] * lags[0]);
      const da = newest[i] - moved;
      const dp = newest[i] - oldest[i];
      ssdAdv += da * da;
      ssdPers += dp * dp;
    }
  }
  const skill = ssdPers > 0 ? 1 - ssdAdv / ssdPers : 0;

  // Resample to a coarse grid (the field is smooth at this scale) and convert to world units per second.
  const cols = Math.ceil(W / GRID_CELL_PX) + 1;
  const rows = Math.ceil(H / GRID_CELL_PX) + 1;
  const gu = new Float32Array(cols * rows);
  const gv = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = Math.min(W - 1, c * GRID_CELL_PX) - 0.5;
      const py = Math.min(H - 1, r * GRID_CELL_PX) - 0.5;
      gu[r * cols + c] = sampleBilinear(u, W, H, px, py) * pixel;
      gv[r * cols + c] = sampleBilinear(v, W, H, px, py) * pixel;
    }
  }

  let sw = 0;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < weight.length; i++) {
    sw += weight[i];
    su += weight[i] * u[i];
    sv += weight[i] * v[i];
  }
  const meanSpeedKmh = sw > 0 ? (Math.hypot(su / sw, sv / sw) * kmPerPx * 3600) : 0;

  return {
    x0: originX,
    y0: originY,
    cell: GRID_CELL_PX * pixel,
    cols,
    rows,
    u: gu,
    v: gv,
    bounds: { x0: originX, y0: originY, x1: originX + W * pixel, y1: originY + H * pixel },
    meanSpeedKmh,
    skill,
    rainFraction,
  };
}

/** Field velocity at a world point (bilinear; clamped to the grid edge outside it). */
export function velocityAt(field: MotionField, wx: number, wy: number): [number, number] {
  const gx = (wx - field.x0) / field.cell;
  const gy = (wy - field.y0) / field.cell;
  return [
    sampleBilinear(field.u, field.cols, field.rows, gx, gy),
    sampleBilinear(field.v, field.cols, field.rows, gx, gy),
  ];
}

/** Back-trajectory displacement for one lead time, on the field's own grid. */
export interface DisplacementGrid {
  field: MotionField;
  seconds: number;
  /** Where rain at each node came from, as an offset: source = node − (dx, dy). World units. */
  dx: Float32Array;
  dy: Float32Array;
}

const TRAJECTORY_STEP_S = 300;

/**
 * Semi-Lagrangian back-trajectories: for each node, step backward in time along the (steady) field to find
 * where the rain now arriving there was at the latest radar frame.
 */
export function displacementGrid(field: MotionField, seconds: number): DisplacementGrid {
  const steps = Math.max(1, Math.ceil(seconds / TRAJECTORY_STEP_S));
  const dt = seconds / steps;
  const n = field.cols * field.rows;
  const dx = new Float32Array(n);
  const dy = new Float32Array(n);
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      const sx = field.x0 + c * field.cell;
      const sy = field.y0 + r * field.cell;
      let x = sx;
      let y = sy;
      for (let s = 0; s < steps; s++) {
        // Midpoint rule: sample the velocity half a step back.
        const [u1, v1] = velocityAt(field, x, y);
        const [u2, v2] = velocityAt(field, x - (u1 * dt) / 2, y - (v1 * dt) / 2);
        x -= u2 * dt;
        y -= v2 * dt;
      }
      dx[r * field.cols + c] = sx - x;
      dy[r * field.cols + c] = sy - y;
    }
  }
  return { field, seconds, dx, dy };
}

/** Back-trajectory offset at a world point (bilinear on the displacement grid, clamped at its edge). */
export function displacementAt(grid: DisplacementGrid, wx: number, wy: number): [number, number] {
  const f = grid.field;
  const gx = (wx - f.x0) / f.cell;
  const gy = (wy - f.y0) / f.cell;
  return [sampleBilinear(grid.dx, f.cols, f.rows, gx, gy), sampleBilinear(grid.dy, f.cols, f.rows, gx, gy)];
}

/**
 * 1 inside the radar domain, easing to 0 over `margin` world units outside it: motion is extrapolated from the
 * domain edge only a little way.
 */
export function domainWeight(field: MotionField, wx: number, wy: number, margin: number): number {
  const b = field.bounds;
  const ox = wx < b.x0 ? b.x0 - wx : wx > b.x1 ? wx - b.x1 : 0;
  const oy = wy < b.y0 ? b.y0 - wy : wy > b.y1 ? wy - b.y1 : 0;
  const d = Math.hypot(ox, oy);
  if (d <= 0) return 1;
  if (d >= margin) return 0;
  const t = 1 - d / margin;
  return t * t * (3 - 2 * t);
}

/**
 * RainViewer's public tiles all use the "Universal Blue" scheme (the colour parameter is ignored). Rain colours for
 * -10 to 65 dBZ, RRGGBBAA, from https://www.rainviewer.com/files/rainviewer_api_colors_table.csv.
 */
const UNIVERSAL_BLUE_RAIN: string[] = [
  '63615914', '66635a19', '69665c1e', '6c685d24', '6f6b5f29', '726e612e', '75706234', '78736439',
  '7c75653e', '7f786744', '827b6949', '857d6a4e', '88806c54', '8b826d59', '8e856f5e', '92887164',
  '9e93756e', 'aa9e7978', 'b6a97e82', 'c2b4828c', 'cec08796', 'd2c48ba0', 'd6c88faa', 'dacc93b4',
  'ded097be', '88ddeeff', '6cd1ebff', '51c5e8ff', '36bae5ff', '1baee2ff', '00a3e0ff', '009ad5ff',
  '0091caff', '0088bfff', '007fb4ff', '0077aaff', '0070a3ff', '00699cff', '006295ff', '005b8eff',
  '005588ff', '005180ff', '004e78ff', '004a70ff', '004768ff', 'ffee00ff', 'ffe000ff', 'ffd200ff',
  'ffc500ff', 'ffb700ff', 'ffaa00ff', 'ff9f00ff', 'ff9500ff', 'ff8b00ff', 'ff8100ff', 'ff4400ff',
  'f23600ff', 'e62800ff', 'd91b00ff', 'cd0d00ff', 'c10000ff', 'a80000ff', '8f0000ff', '760000ff',
  '5d0000ff', 'ffaaffff', 'ff9fffff', 'ff95ffff', 'ff8bffff', 'ff81ffff', 'ff77ffff', 'ff6cffff',
  'ff62ffff', 'ff58ffff', 'ff4effff', 'ffffffff',
];
const PALETTE_MIN_DBZ = -10;

/** dBZ → tracking intensity: drizzle and clutter (< 10 dBZ) count for nothing, 60 dBZ and up for 1. */
function dbzToIntensity(dbz: number): number {
  return Math.max(0, Math.min(1, (dbz - 10) / 50));
}

const paletteRgba = UNIVERSAL_BLUE_RAIN.map((h) => [0, 2, 4, 6].map((o) => Number.parseInt(h.slice(o, o + 2), 16)));
/** Premultiplied palette entries, so faint low-alpha colours compare sensibly after canvas round-trips. */
const palettePremul = paletteRgba.map(([r, g, b, a]) => [(r * a) / 255, (g * a) / 255, (b * a) / 255, a]);
/** Squared premultiplied distance above which a colour is "not from this palette". */
const PALETTE_MISMATCH_D2 = 30 * 30;

/**
 * Convert RGBA radar tile pixels to tracking intensity by nearest palette colour. Also reports the share of
 * coloured pixels that matched no palette entry well, so a palette change can be detected and the nowcast skipped.
 */
export function paletteToIntensity(
  rgba: Uint8ClampedArray | Uint8Array,
  out: Float32Array,
  cache: Map<number, number> = new Map(),
): { coloured: number; mismatched: number } {
  let coloured = 0;
  let mismatched = 0;
  for (let i = 0, p = 0; p < out.length; p++, i += 4) {
    const a = rgba[i + 3];
    if (a === 0) {
      out[p] = 0;
      continue;
    }
    coloured++;
    const key = ((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | a) >>> 0;
    let val = cache.get(key);
    if (val === undefined) {
      const pr = (rgba[i] * a) / 255;
      const pg = (rgba[i + 1] * a) / 255;
      const pb = (rgba[i + 2] * a) / 255;
      let best = Infinity;
      let bestIdx = 0;
      for (let k = 0; k < palettePremul.length; k++) {
        const e = palettePremul[k];
        const d2 = (pr - e[0]) ** 2 + (pg - e[1]) ** 2 + (pb - e[2]) ** 2 + (a - e[3]) ** 2;
        if (d2 < best) {
          best = d2;
          bestIdx = k;
        }
      }
      // Encode mismatch as a negative value so the cache remembers it.
      val = best > PALETTE_MISMATCH_D2 ? -1 : dbzToIntensity(PALETTE_MIN_DBZ + bestIdx);
      cache.set(key, val);
    }
    if (val < 0) {
      mismatched++;
      out[p] = 0;
    } else {
      out[p] = val;
    }
  }
  return { coloured, mismatched };
}

/** Radar frames as RGBA pixel mosaics (same size), handed to the worker. */
export interface MotionRequest {
  /** One RGBA buffer per frame, width × height × 4 bytes, oldest first. */
  rgba: ArrayBuffer[];
  width: number;
  height: number;
  times: number[];
  originX: number;
  originY: number;
  /** World units per mosaic pixel. */
  pixel: number;
}

export type MotionResult =
  | { ok: true; field: MotionField; ms: number }
  | { ok: false; reason: string; ms: number };

/** Below this share of mosaic pixels with rain in the latest frame there's nothing worth moving. */
const MIN_RAIN_FRACTION = 0.0005;
/** If more coloured pixels than this match no palette colour, RainViewer changed its palette: don't guess. */
const MAX_PALETTE_MISMATCH = 0.2;
/** The advected oldest frame must beat leaving it in place by this much, or the motion is noise. */
const MIN_SKILL = 0.05;

/**
 * Full pipeline from RGBA radar mosaics to a checked motion field: palette → intensity, 2× downsample,
 * Lucas–Kanade, then sanity checks. Runs in a worker (radarMotion.worker.ts) or on the main thread as a fallback.
 */
export function motionFromRgba(req: MotionRequest): MotionResult {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
  const cache = new Map<number, number>();
  let coloured = 0;
  let mismatched = 0;
  const frames: IntensityImage[] = req.rgba.map((buf) => {
    const data = new Float32Array(req.width * req.height);
    const r = paletteToIntensity(new Uint8ClampedArray(buf), data, cache);
    coloured += r.coloured;
    mismatched += r.mismatched;
    // 2× box downsample: ~10 km pixels are ~4× cheaper to track with the same skill (the field is smooth).
    return downsample({ width: req.width, height: req.height, data });
  });
  if (coloured > 0 && mismatched / coloured > MAX_PALETTE_MISMATCH) {
    return { ok: false, reason: 'unrecognised radar palette', ms: elapsed() };
  }
  const field = estimateMotion({
    frames,
    times: req.times,
    originX: req.originX,
    originY: req.originY,
    pixel: req.pixel * (req.width / frames[0].width),
  });
  if (!field) return { ok: false, reason: 'not enough frames', ms: elapsed() };
  if (field.rainFraction < MIN_RAIN_FRACTION) return { ok: false, reason: 'too little rain to track', ms: elapsed() };
  if (field.skill < MIN_SKILL) return { ok: false, reason: `motion no better than persistence (skill ${field.skill.toFixed(2)})`, ms: elapsed() };
  return { ok: true, field, ms: elapsed() };
}
