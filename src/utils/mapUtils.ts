/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DESKTOP_QUERY } from '../hooks/useIsDesktop';

function isDesktopViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/** Current mobile bottom-sheet height (incl. tab bar) published by BottomSheet as `--sheet-h`. */
function readSheetHeight(): number {
  if (typeof document === 'undefined') return 0;
  const raw = document.documentElement.style.getPropertyValue('--sheet-h');
  const px = parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

/**
 * Smoothly pans the Google Map camera to a target location with a vertical screen offset.
 *
 * - Desktop: offsets the camera north so the marker sits in the lower half of the viewport,
 *   leaving room for the upward-opening InfoWindow.
 * - Mobile (< 1024px): the map is full-screen behind a bottom sheet, so the camera is offset
 *   south instead, centring the marker in the visible map area above the sheet.
 *
 * An explicit `offsetYPixels` (positive = marker lower on screen) overrides both.
 */
export function panToWithVerticalOffset(
  map: google.maps.Map,
  lat: number,
  lng: number,
  offsetYPixels?: number
) {
  if (!map) return;

  if (offsetYPixels === undefined && !isDesktopViewport()) {
    // Defer one frame so a sheet snap change in the same commit has published its new --sheet-h.
    requestAnimationFrame(() => {
      // Clamp so a fully-open sheet doesn't push the marker off the top edge.
      const sheetH = Math.min(readSheetHeight(), window.innerHeight * 0.6);
      panWithOffset(map, lat, lng, -Math.round(sheetH / 2));
    });
    return;
  }

  // Calculate dynamic vertical offset based on current viewport height
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Offset ~18% of viewport height (between 110px and 160px)
  const offset = offsetYPixels ?? Math.max(110, Math.min(160, Math.round(vh * 0.18)));
  panWithOffset(map, lat, lng, offset);
}

/** Pans so the point lands `offset` px below the map centre (negative = above). */
function panWithOffset(map: google.maps.Map, lat: number, lng: number, offset: number) {
  const projection = map.getProjection();
  const zoom = map.getZoom() ?? 6;

  if (projection) {
    const scale = Math.pow(2, zoom);
    const worldPoint = projection.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
    if (worldPoint) {
      // In Mercator projection, lower y is North (upwards on screen).
      // Moving the camera center North makes the marker sit lower on screen by `offset` pixels.
      const targetPoint = new google.maps.Point(worldPoint.x, worldPoint.y - offset / scale);
      const targetLatLng = projection.fromPointToLatLng(targetPoint);
      if (targetLatLng) {
        map.panTo(targetLatLng);
        return;
      }
    }
  }

  // Fallback if projection is not ready yet: spherical Mercator approximation
  const latRad = (lat * Math.PI) / 180;
  const deltaLat = (offset * 360 * Math.cos(latRad)) / (256 * Math.pow(2, zoom));
  map.panTo({ lat: lat + deltaLat, lng });
}
