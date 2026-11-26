/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { ForecastGridResponse, RainViewerFrame } from '../types/weather';

interface WeatherTileOverlayProps {
  rainViewerHost?: string;
  rainViewerFrame?: RainViewerFrame | null;
  /** Open-Meteo model rain grid, drawn for frames of kind 'model'. */
  forecastGrid?: ForecastGridResponse | null;
  opacity: number;
  visible: boolean;
}

const RAINVIEWER_MAX_NATIVE_ZOOM = 7;

/** Model tiles are drawn at low resolution and upscaled smoothly: the grid is ~80 km, so more is wasted work. */
const MODEL_TILE_PX = 128;

/**
 * Full overlay alpha for model rain, close to RainViewer's near-opaque radar pixels so the handover doesn't
 * visibly dim; the lightest band still fades in so ~0.1 mm drizzle doesn't wash over the map.
 */
const MODEL_ALPHA = 235;
const MODEL_FADE_FROM_MM = 0.1;
const MODEL_FADE_TO_MM = 0.6;

/** Hourly rain (mm) → colour, matching the radar legend bands in RadarControlBar. */
const MODEL_RAIN_RAMP: Array<{ minMm: number; rgb: [number, number, number] }> = [
  { minMm: 40, rgb: [179, 0, 119] },
  { minMm: 15, rgb: [255, 0, 0] },
  { minMm: 6, rgb: [255, 126, 0] },
  { minMm: 2, rgb: [255, 255, 0] },
  { minMm: 0.5, rgb: [0, 204, 102] },
  { minMm: 0.1, rgb: [136, 221, 238] },
];

function rainColour(mm: number): [number, number, number] | null {
  for (const band of MODEL_RAIN_RAMP) if (mm >= band.minMm) return band.rgb;
  return null;
}

/**
 * Grid nodes are splatted with a Gaussian (σ in grid cells) rather than bilinearly interpolated: at ~80 km spacing,
 * bilinear contours follow the grid lines and draw square blobs. σ = 0.5 keeps a uniform field unchanged
 * (the summed weights ripple by ~1%) and fades rain out within a cell or so past the grid edge.
 */
const SPLAT_SIGMA_CELLS = 0.5;
const SPLAT_NORM = 1 / (2 * Math.PI * SPLAT_SIGMA_CELLS * SPLAT_SIGMA_CELLS);
/** How far past the outermost nodes to keep drawing (cells); by 1.5 cells (3σ) a splat is ~1% of its peak. */
const SPLAT_MARGIN_CELLS = 1.5;

/** For each pixel along one axis: the 4 nearest grid indices (-1 when off the grid) and their 1-D weights. */
function axisTaps(coords: Float64Array, count: number) {
  const idx = new Int32Array(coords.length * 4);
  const w = new Float64Array(coords.length * 4);
  for (let i = 0; i < coords.length; i++) {
    const f = coords[i];
    const base = Math.floor(f) - 1;
    for (let k = 0; k < 4; k++) {
      const g = base + k;
      const d = f - g;
      idx[i * 4 + k] = g >= 0 && g < count ? g : -1;
      w[i * 4 + k] = Math.exp(-(d * d) / (2 * SPLAT_SIGMA_CELLS * SPLAT_SIGMA_CELLS));
    }
  }
  return { idx, w };
}

/** Paint one Web Mercator tile of the model rain grid into a small canvas. */
function drawModelTile(
  ownerDocument: Document,
  grid: ForecastGridResponse,
  values: number[],
  x: number,
  y: number,
  zoom: number,
): HTMLCanvasElement | null {
  const n = 1 << zoom;
  const { north, south, west, east } = grid.bbox;
  const cellLat = (north - south) / (grid.rows - 1);
  const cellLon = (east - west) / (grid.cols - 1);
  const latAt = (wy: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;

  // Skip tiles that don't come near the grid.
  const lonW = (x / n) * 360 - 180;
  const lonE = ((x + 1) / n) * 360 - 180;
  const latN = latAt(y / n);
  const latS = latAt((y + 1) / n);
  const mLat = SPLAT_MARGIN_CELLS * cellLat;
  const mLon = SPLAT_MARGIN_CELLS * cellLon;
  if (lonE < west - mLon || lonW > east + mLon || latS > north + mLat || latN < south - mLat) return null;

  // Fractional grid row/column for each pixel row/column (rows run north to south).
  const rowCoords = new Float64Array(MODEL_TILE_PX);
  const colCoords = new Float64Array(MODEL_TILE_PX);
  for (let p = 0; p < MODEL_TILE_PX; p++) {
    rowCoords[p] = (north - latAt((y + (p + 0.5) / MODEL_TILE_PX) / n)) / cellLat;
    colCoords[p] = (((x + (p + 0.5) / MODEL_TILE_PX) / n) * 360 - 180 - west) / cellLon;
  }
  const rows = axisTaps(rowCoords, grid.rows);
  const cols = axisTaps(colCoords, grid.cols);

  const canvas = ownerDocument.createElement('canvas');
  canvas.width = MODEL_TILE_PX;
  canvas.height = MODEL_TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(MODEL_TILE_PX, MODEL_TILE_PX);
  let painted = false;
  for (let py = 0; py < MODEL_TILE_PX; py++) {
    for (let px = 0; px < MODEL_TILE_PX; px++) {
      let sum = 0;
      for (let a = 0; a < 4; a++) {
        const r = rows.idx[py * 4 + a];
        if (r < 0) continue;
        const wr = rows.w[py * 4 + a];
        const rowBase = r * grid.cols;
        for (let b = 0; b < 4; b++) {
          const c = cols.idx[px * 4 + b];
          if (c < 0) continue;
          const v = values[rowBase + c];
          if (v) sum += v * wr * cols.w[px * 4 + b];
        }
      }
      if (sum === 0) continue;
      const mm = (sum * SPLAT_NORM) / 10; // values are tenths of a mm
      const rgb = rainColour(mm);
      if (!rgb) continue;
      const fade = Math.min(1, (mm - MODEL_FADE_FROM_MM) / (MODEL_FADE_TO_MM - MODEL_FADE_FROM_MM));
      if (fade <= 0) continue;
      const o = (py * MODEL_TILE_PX + px) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(MODEL_ALPHA * fade);
      painted = true;
    }
  }
  if (!painted) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Tile container shared by both layer kinds; mul scales the user's radar opacity (used by the handover crossfade). */
function makeTileDiv(ownerDocument: Document, nodes: Map<HTMLDivElement, number>, baseOpacity: number, mul: number) {
  const div = ownerDocument.createElement('div');
  div.style.width = '256px';
  div.style.height = '256px';
  div.style.overflow = 'hidden';
  div.style.position = 'relative';
  div.style.pointerEvents = 'none';
  div.style.opacity = String(baseOpacity * mul);
  nodes.set(div, mul);
  return div;
}

/** RainViewer radar frame, with maxNativeZoom=7 upscaling so zoom > 7 in Ayr/Townsville scales cleanly. */
function makeRadarLayer(
  host: string,
  framePath: string,
  nodes: Map<HTMLDivElement, number>,
  getOpacity: () => number,
  mul: number,
): google.maps.MapType {
  return {
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 18,
    minZoom: 0,
    name: 'RainViewer radar',
    alt: 'RainViewer Precipitation Radar',
    projection: null,
    radius: 6378137,
    getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): Element {
      const div = makeTileDiv(ownerDocument, nodes, getOpacity(), mul);
      const maxTiles = 1 << zoom;
      const normX = ((coord.x % maxTiles) + maxTiles) % maxTiles;
      const y = coord.y;
      if (y < 0 || y >= maxTiles) return div;

      const nativeZoom = Math.min(zoom, RAINVIEWER_MAX_NATIVE_ZOOM);
      const factor = 1 << (zoom - nativeZoom);
      const srcX = Math.floor(normX / factor);
      const srcY = Math.floor(y / factor);
      const subX = normX % factor;
      const subY = y % factor;

      const img = ownerDocument.createElement('img');
      img.src = `${host}${framePath}/256/${nativeZoom}/${srcX}/${srcY}/1/1_1.png`;
      img.alt = '';
      img.draggable = false;
      img.style.position = 'absolute';
      img.style.maxWidth = 'none';
      img.style.width = `${256 * factor}px`;
      img.style.height = `${256 * factor}px`;
      img.style.left = `${-subX * 256}px`;
      img.style.top = `${-subY * 256}px`;
      img.style.imageRendering = 'auto';
      img.onerror = () => {
        img.style.display = 'none';
      };
      div.appendChild(img);
      return div;
    },
    releaseTile(tile: Element) {
      nodes.delete(tile as HTMLDivElement);
    },
  };
}

/** Open-Meteo model rain for one (time-interpolated) frame, drawn client-side from the grid. */
function makeModelLayer(
  grid: ForecastGridResponse,
  values: number[],
  nodes: Map<HTMLDivElement, number>,
  getOpacity: () => number,
  mul: number,
): google.maps.MapType {
  return {
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 18,
    minZoom: 0,
    name: 'Open-Meteo model rain forecast',
    alt: 'Model rain forecast (Open-Meteo)',
    projection: null,
    radius: 6378137,
    getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): Element {
      const div = makeTileDiv(ownerDocument, nodes, getOpacity(), mul);
      const n = 1 << zoom;
      if (coord.y < 0 || coord.y >= n) return div;
      const normX = ((coord.x % n) + n) % n;
      const canvas = drawModelTile(ownerDocument, grid, values, normX, coord.y, zoom);
      if (canvas) {
        canvas.style.width = '256px';
        canvas.style.height = '256px';
        canvas.style.display = 'block';
        div.appendChild(canvas);
      }
      return div;
    },
    releaseTile(tile: Element) {
      nodes.delete(tile as HTMLDivElement);
    },
  };
}

export function WeatherTileOverlay({
  rainViewerHost,
  rainViewerFrame,
  forecastGrid,
  opacity,
  visible,
}: WeatherTileOverlayProps) {
  const map = useMap();
  const layersRef = useRef<google.maps.MapType[]>([]);
  const opacityRef = useRef<number>(opacity);
  /** Live tile containers → their opacity multiplier (1, or a handover crossfade weight). */
  const tileNodesRef = useRef<Map<HTMLDivElement, number>>(new Map());

  opacityRef.current = Math.max(0, Math.min(1, opacity));

  useEffect(() => {
    if (!map) return;

    const removeLayers = () => {
      for (const layer of layersRef.current) {
        // getArray() can be undefined if the Maps API failed (e.g. invalid key); don't crash the app tree.
        const index = map.overlayMapTypes?.getArray?.()?.indexOf(layer) ?? -1;
        if (index !== -1) map.overlayMapTypes.removeAt(index);
      }
      layersRef.current = [];
      tileNodesRef.current.clear();
    };

    removeLayers();
    if (!visible || !rainViewerFrame) return;

    const host = rainViewerHost ? rainViewerHost.replace(/\/$/, '') : '';
    const nodes = tileNodesRef.current;
    const getOpacity = () => opacityRef.current;
    const add = (layer: google.maps.MapType) => {
      layersRef.current.push(layer);
      map.overlayMapTypes.push(layer);
    };

    if (rainViewerFrame.kind === 'model') {
      const blend = rainViewerFrame.grid;
      const from = blend ? forecastGrid?.precip[blend.from] : undefined;
      const to = blend ? forecastGrid?.precip[blend.to] : undefined;
      if (!forecastGrid || !blend || !from || !to) return removeLayers;
      const values = blend.mix === 0 ? from : from.map((v, i) => v + ((to[i] ?? 0) - v) * blend.mix);
      const handover = rainViewerFrame.handover;
      // Last radar frame first so it sits beneath the model while it fades out.
      if (handover && host) add(makeRadarLayer(host, handover.radarPath, nodes, getOpacity, handover.radar));
      add(makeModelLayer(forecastGrid, values, nodes, getOpacity, handover?.model ?? 1));
    } else if (host && rainViewerFrame.path) {
      add(makeRadarLayer(host, rainViewerFrame.path, nodes, getOpacity, 1));
    }

    return removeLayers;
  }, [map, rainViewerHost, rainViewerFrame, forecastGrid, visible]);

  // Dynamically update opacity without rebuilding the layers
  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, opacity));
    tileNodesRef.current.forEach((mul, node) => {
      node.style.opacity = String(clamped * mul);
    });
  }, [opacity]);

  return null;
}
