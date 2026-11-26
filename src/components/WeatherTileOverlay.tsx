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
const MODEL_TILE_PX = 64;

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

/** Bilinearly sample one forecast hour (mm) at a lat/lon; null outside the grid. */
function sampleGrid(grid: ForecastGridResponse, values: number[], lat: number, lon: number): number | null {
  const { north, south, west, east } = grid.bbox;
  if (lat > north || lat < south || lon < west || lon > east) return null;
  const fr = ((north - lat) / (north - south)) * (grid.rows - 1);
  const fc = ((lon - west) / (east - west)) * (grid.cols - 1);
  const r0 = Math.min(grid.rows - 2, Math.floor(fr));
  const c0 = Math.min(grid.cols - 2, Math.floor(fc));
  const tr = fr - r0;
  const tc = fc - c0;
  const at = (r: number, c: number) => (values[r * grid.cols + c] ?? 0) / 10;
  const top = at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc;
  const bottom = at(r0 + 1, c0) * (1 - tc) + at(r0 + 1, c0 + 1) * tc;
  return top * (1 - tr) + bottom * tr;
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
  // Skip tiles that don't intersect the grid bbox.
  const lonW = (x / n) * 360 - 180;
  const lonE = ((x + 1) / n) * 360 - 180;
  const latAt = (wy: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
  const latN = latAt(y / n);
  const latS = latAt((y + 1) / n);
  const { north, south, west, east } = grid.bbox;
  if (lonE < west || lonW > east || latS > north || latN < south) return null;

  const canvas = ownerDocument.createElement('canvas');
  canvas.width = MODEL_TILE_PX;
  canvas.height = MODEL_TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(MODEL_TILE_PX, MODEL_TILE_PX);
  let painted = false;
  for (let py = 0; py < MODEL_TILE_PX; py++) {
    const lat = latAt((y + (py + 0.5) / MODEL_TILE_PX) / n);
    for (let px = 0; px < MODEL_TILE_PX; px++) {
      const lon = ((x + (px + 0.5) / MODEL_TILE_PX) / n) * 360 - 180;
      const mm = sampleGrid(grid, values, lat, lon);
      const rgb = mm == null ? null : rainColour(mm);
      if (!rgb) continue;
      const o = (py * MODEL_TILE_PX + px) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 190;
      painted = true;
    }
  }
  if (!painted) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function WeatherTileOverlay({
  rainViewerHost,
  rainViewerFrame,
  forecastGrid,
  opacity,
  visible,
}: WeatherTileOverlayProps) {
  const map = useMap();
  const overlayRef = useRef<google.maps.MapType | null>(null);
  const opacityRef = useRef<number>(opacity);
  const tileNodesRef = useRef<Set<HTMLDivElement>>(new Set());

  opacityRef.current = Math.max(0, Math.min(1, opacity));

  useEffect(() => {
    if (!map) return;

    const removeCurrentLayer = () => {
      if (overlayRef.current) {
        // getArray() can be undefined if the Maps API failed (e.g. invalid key); don't crash the app tree.
        const index = map.overlayMapTypes?.getArray?.()?.indexOf(overlayRef.current) ?? -1;
        if (index !== -1) {
          map.overlayMapTypes.removeAt(index);
        }
        overlayRef.current = null;
      }
      tileNodesRef.current.clear();
    };

    removeCurrentLayer();

    if (!visible) return;

    const modelValues =
      rainViewerFrame?.kind === 'model' && forecastGrid && rainViewerFrame.gridIndex != null
        ? forecastGrid.precip[rainViewerFrame.gridIndex]
        : undefined;

    if (forecastGrid && modelValues) {
      const grid = forecastGrid;
      const nodesSet = tileNodesRef.current;
      const modelMapType: google.maps.MapType = {
        tileSize: new google.maps.Size(256, 256),
        maxZoom: 18,
        minZoom: 0,
        name: 'Open-Meteo model rain forecast',
        alt: 'Model rain forecast (Open-Meteo)',
        projection: null,
        radius: 6378137,
        getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): Element {
          const div = ownerDocument.createElement('div');
          div.style.width = '256px';
          div.style.height = '256px';
          div.style.pointerEvents = 'none';
          div.style.opacity = String(opacityRef.current);
          const n = 1 << zoom;
          if (coord.y < 0 || coord.y >= n) return div;
          const normX = ((coord.x % n) + n) % n;
          const canvas = drawModelTile(ownerDocument, grid, modelValues, normX, coord.y, zoom);
          if (canvas) {
            canvas.style.width = '256px';
            canvas.style.height = '256px';
            canvas.style.imageRendering = 'auto';
            div.appendChild(canvas);
          }
          nodesSet.add(div);
          return div;
        },
        releaseTile(tile: Element) {
          nodesSet.delete(tile as HTMLDivElement);
        },
      };
      overlayRef.current = modelMapType;
      map.overlayMapTypes.push(modelMapType);
      return removeCurrentLayer;
    }

    if (rainViewerHost && rainViewerFrame?.path) {
      const host = rainViewerHost.replace(/\/$/, '');
      const framePath = rainViewerFrame.path;
      const nodesSet = tileNodesRef.current;

      // Custom MapType with maxNativeZoom=7 upscaling so zoom > 7 in Ayr/Townsville scales cleanly
      const rainViewerMapType: google.maps.MapType = {
        tileSize: new google.maps.Size(256, 256),
        maxZoom: 18,
        minZoom: 0,
        name: `RainViewer ${rainViewerFrame.kind}`,
        alt: 'RainViewer Precipitation Radar',
        projection: null,
        radius: 6378137,
        getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): Element {
          const div = ownerDocument.createElement('div');
          div.style.width = '256px';
          div.style.height = '256px';
          div.style.overflow = 'hidden';
          div.style.position = 'relative';
          div.style.pointerEvents = 'none';
          div.style.opacity = String(opacityRef.current);

          const maxTiles = 1 << zoom;
          const normX = ((coord.x % maxTiles) + maxTiles) % maxTiles;
          const y = coord.y;

          if (y < 0 || y >= maxTiles) {
            return div;
          }

          const nativeZoom = Math.min(zoom, RAINVIEWER_MAX_NATIVE_ZOOM);
          const scaleDiff = zoom - nativeZoom;
          const factor = 1 << scaleDiff;
          const srcX = Math.floor(normX / factor);
          const srcY = Math.floor(y / factor);
          const subX = normX % factor;
          const subY = y % factor;

          const tileUrl = `${host}${framePath}/256/${nativeZoom}/${srcX}/${srcY}/1/1_1.png`;

          const img = ownerDocument.createElement('img');
          img.src = tileUrl;
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
          nodesSet.add(div);
          return div;
        },
        releaseTile(tile: Element) {
          nodesSet.delete(tile as HTMLDivElement);
        },
      };

      overlayRef.current = rainViewerMapType;
      map.overlayMapTypes.push(rainViewerMapType);

      return removeCurrentLayer;
    }

    return removeCurrentLayer;
  }, [map, rainViewerHost, rainViewerFrame?.path, rainViewerFrame?.time, rainViewerFrame?.kind, forecastGrid, visible]);

  // Dynamically update opacity without rebuilding the layer
  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, opacity));
    tileNodesRef.current.forEach((node) => {
      node.style.opacity = String(clamped);
    });
  }, [opacity]);

  return null;
}
