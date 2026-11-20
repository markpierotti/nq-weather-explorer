/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { RainViewerFrame } from '../types/weather';

interface WeatherTileOverlayProps {
  rainViewerHost?: string;
  rainViewerFrame?: RainViewerFrame | null;
  opacity: number;
  visible: boolean;
}

const RAINVIEWER_MAX_NATIVE_ZOOM = 7;

export function WeatherTileOverlay({
  rainViewerHost,
  rainViewerFrame,
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
  }, [map, rainViewerHost, rainViewerFrame?.path, rainViewerFrame?.time, visible]);

  // Dynamically update opacity without rebuilding the layer
  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, opacity));
    tileNodesRef.current.forEach((node) => {
      node.style.opacity = String(clamped);
    });
  }, [opacity]);

  return null;
}
