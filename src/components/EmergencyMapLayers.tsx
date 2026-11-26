/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import { AdvancedMarker, InfoWindow, Pin, useMap } from '@vis.gl/react-google-maps';
import { Waves } from 'lucide-react';
import { EmergencyFeatureItem, EmergencyLayerToggles } from '../types/weather';
import { BRUCE_HWY_CORRIDOR_PATH } from '../utils/mockWeatherData';
import { FLOOD_CLASS_COLOR, GaugeDetail, formatGaugeTime } from './emergency/GaugeDetail';

interface EmergencyMapLayersProps {
  items: EmergencyFeatureItem[];
  layerToggles: EmergencyLayerToggles;
  selectedItem: EmergencyFeatureItem | null;
  onSelectItem: (item: EmergencyFeatureItem | null) => void;
}

function getPinStyle(item: EmergencyFeatureItem): {
  background: string;
  borderColor: string;
  glyphColor: string;
  glyphText: string;
} {
  switch (item.category) {
    case 'road':
      return {
        background: item.isCorridorPriority ? '#dc2626' : '#d97706',
        borderColor: '#7f1d1d',
        glyphColor: '#ffffff',
        glyphText: 'R',
      };
    case 'outage':
      return {
        background: '#7c3aed',
        borderColor: '#4c1d95',
        glyphColor: '#ffffff',
        glyphText: '⚡',
      };
    case 'cyclone':
    case 'warning':
      return {
        background: '#e11d48',
        borderColor: '#881337',
        glyphColor: '#ffffff',
        glyphText: '!',
      };
    case 'qfd':
    case 'fire_danger':
      return {
        background: '#ea580c',
        borderColor: '#7c2d12',
        glyphColor: '#ffffff',
        glyphText: 'F',
      };
    case 'fuel':
      return {
        background: '#059669',
        borderColor: '#064e3b',
        glyphColor: '#ffffff',
        glyphText: '⛽',
      };
    case 'evac':
    case 'sandbag':
      return {
        background: '#0284c7',
        borderColor: '#0c4a6e',
        glyphColor: '#ffffff',
        glyphText: 'S',
      };
    case 'traffic': {
      const closed = item.traffic?.isClosure;
      const flood = /flood/i.test(item.traffic?.eventType ?? '');
      return {
        background: closed ? '#dc2626' : flood ? '#0369a1' : '#d97706',
        borderColor: closed ? '#7f1d1d' : flood ? '#0c4a6e' : '#78350f',
        glyphColor: '#ffffff',
        glyphText: closed ? '✕' : flood ? '≈' : 'T',
      };
    }
    case 'bom_warning':
      return {
        background: item.severity === 'critical' ? '#be123c' : item.severity === 'high' ? '#e11d48' : '#f59e0b',
        borderColor: '#881337',
        glyphColor: '#ffffff',
        glyphText: 'W',
      };
    default:
      return {
        background: '#475569',
        borderColor: '#1e293b',
        glyphColor: '#ffffff',
        glyphText: 'i',
      };
  }
}

export function EmergencyMapLayers({
  items,
  layerToggles,
  selectedItem,
  onSelectItem,
}: EmergencyMapLayersProps) {
  const map = useMap();

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (item.category === 'road') return layerToggles.roads;
      if (item.category === 'outage') return layerToggles.outages;
      if (item.category === 'warning' || item.category === 'cyclone') return layerToggles.warnings;
      if (item.category === 'qfd' || item.category === 'fire_danger') return layerToggles.qfd;
      if (item.category === 'fuel' || item.category === 'evac' || item.category === 'sandbag' || item.category === 'bulletin') {
        return layerToggles.support;
      }
      if (item.category === 'river_gauge') return layerToggles.gauges;
      if (item.category === 'traffic') return layerToggles.traffic;
      if (item.category === 'bom_warning') return layerToggles.bomWarnings;
      return true;
    });
  }, [items, layerToggles]);

  // Draw Bruce Highway (A1) Ayr <-> Giru <-> Townsville Corridor Polyline
  useEffect(() => {
    if (!map || !layerToggles.corridor) return;

    const outerGlow = new google.maps.Polyline({
      path: BRUCE_HWY_CORRIDOR_PATH,
      strokeColor: '#32ADE6',
      strokeOpacity: 0.35,
      strokeWeight: 12,
      zIndex: 5,
      map,
    });

    const coreLine = new google.maps.Polyline({
      path: BRUCE_HWY_CORRIDOR_PATH,
      strokeColor: '#38bdf8',
      strokeOpacity: 0.95,
      strokeWeight: 4.5,
      zIndex: 6,
      map,
    });

    return () => {
      outerGlow.setMap(null);
      coreLine.setMap(null);
    };
  }, [map, layerToggles.corridor]);

  // Draw Polylines / Polygons for Cyclone tracks, road closures, or warning zones
  useEffect(() => {
    if (!map) return;
    const shapes: Array<google.maps.Polyline | google.maps.Polygon> = [];

    visibleItems.forEach((item) => {
      if (!item.pathCoords || item.pathCoords.length === 0) return;

      const isPolygon = item.geometryType === 'Polygon' || item.geometryType === 'MultiPolygon';
      const color =
        item.category === 'cyclone'
          ? '#e11d48'
          : item.category === 'traffic'
          ? item.traffic?.isClosure
            ? '#dc2626'
            : '#d97706'
          : item.category === 'road'
          ? '#d97706'
          : '#0284c7';

      item.pathCoords.forEach((path) => {
        if (path.length < 2) return;
        if (isPolygon && path.length >= 3) {
          const poly = new google.maps.Polygon({
            paths: path,
            strokeColor: color,
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: 0.14,
            zIndex: 12,
            map,
          });
          poly.addListener('click', () => onSelectItem(item));
          shapes.push(poly);
        } else {
          const line = new google.maps.Polyline({
            path,
            strokeColor: color,
            strokeOpacity: 0.9,
            strokeWeight: item.category === 'cyclone' ? 4 : 3.5,
            zIndex: 14,
            map,
          });
          line.addListener('click', () => onSelectItem(item));
          shapes.push(line);
        }
      });
    });

    return () => {
      shapes.forEach((s) => s.setMap(null));
    };
  }, [map, visibleItems, onSelectItem]);

  return (
    <>
      {visibleItems
        .filter((item) => item.lat !== null && item.lng !== null)
        .map((item) => {
          if (item.category === 'river_gauge' && item.gauge) {
            const g = item.gauge;
            const flooding = g.floodClass === 'minor' || g.floodClass === 'moderate' || g.floodClass === 'major';
            return (
              <AdvancedMarker
                key={item.id}
                position={{ lat: item.lat as number, lng: item.lng as number }}
                title={`${item.title}: ${g.heightM !== null ? `${g.heightM.toFixed(2)} m` : 'no reading'}`}
                zIndex={flooding ? 70 : 35}
                onClick={() => onSelectItem(item)}
              >
                <div
                  className="flex items-center justify-center rounded-full border-2 border-white shadow-md"
                  style={{
                    background: FLOOD_CLASS_COLOR[g.floodClass],
                    width: flooding ? 30 : 22,
                    height: flooding ? 30 : 22,
                  }}
                >
                  <Waves className={flooding ? 'w-4 h-4 text-white' : 'w-3 h-3 text-white'} aria-hidden="true" />
                </div>
              </AdvancedMarker>
            );
          }
          const pin = getPinStyle(item);
          return (
            <AdvancedMarker
              key={item.id}
              position={{ lat: item.lat as number, lng: item.lng as number }}
              title={item.title}
              zIndex={item.isCorridorPriority ? 65 : 40}
              onClick={() => onSelectItem(item)}
            >
              <Pin
                background={pin.background}
                borderColor={pin.borderColor}
                glyphColor={pin.glyphColor}
                glyphText={pin.glyphText}
                scale={item.isCorridorPriority ? 1.05 : 0.85}
              />
            </AdvancedMarker>
          );
        })}

      {selectedItem && selectedItem.lat !== null && selectedItem.lng !== null && (
        <InfoWindow
          position={{ lat: selectedItem.lat, lng: selectedItem.lng }}
          pixelOffset={[0, -34]}
          onCloseClick={() => onSelectItem(null)}
        >
          <div className="max-w-[260px] text-xs font-sans text-slate-800 space-y-1.5 p-0.5">
            <div className="text-[11px] font-semibold text-slate-500">
              {selectedItem.sourceLabel}
              {selectedItem.isCorridorPriority && ` · ${selectedItem.corridorTags.join(', ')}`}
            </div>
            <h4 className="font-bold text-slate-900 leading-snug">{selectedItem.title}</h4>
            {selectedItem.subtitle && selectedItem.subtitle !== selectedItem.title && (
              <div className="text-[11px] font-medium text-slate-700">{selectedItem.subtitle}</div>
            )}
            {selectedItem.gauge ? (
              <GaugeDetail gauge={selectedItem.gauge} tone="light" />
            ) : (
              selectedItem.description && (
                <p className="text-[11px] text-slate-600 leading-relaxed max-h-28 overflow-y-auto">
                  {selectedItem.description}
                </p>
              )
            )}
            {selectedItem.bomWarning && (
              <div className="text-[11px] text-slate-500 space-y-0.5">
                {selectedItem.bomWarning.areas.length > 0 && <div>Areas: {selectedItem.bomWarning.areas.join(', ')}</div>}
                {formatGaugeTime(selectedItem.bomWarning.issuedAt) && (
                  <div>Issued {formatGaugeTime(selectedItem.bomWarning.issuedAt)}</div>
                )}
                {selectedItem.bomWarning.url && (
                  <a
                    href={selectedItem.bomWarning.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sky-700 underline"
                  >
                    Full warning on bom.gov.au
                  </a>
                )}
              </div>
            )}
            {selectedItem.updatedAt && !selectedItem.gauge && (
              <div className="text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-100">
                Updated: {selectedItem.updatedAt}
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}
