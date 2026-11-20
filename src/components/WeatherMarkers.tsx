/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { AdvancedMarker, InfoWindow, Pin, useMap } from '@vis.gl/react-google-maps';
import { CloudRain } from 'lucide-react';
import { LocationWeatherBundle, MultiModelBundle, WeatherLocation, WeatherUnitSystem } from '../types/weather';
import { PRESET_LOCATIONS } from '../utils/mockWeatherData';
import { panToWithVerticalOffset } from '../utils/mapUtils';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useAppData } from '../state/AppDataContext';

interface WeatherMarkersProps {
  selectedLocation: WeatherLocation;
  savedLocations?: WeatherLocation[];
  currentBundle: LocationWeatherBundle | null;
  multiModelBundle: MultiModelBundle | null;
  unitSystem: WeatherUnitSystem;
  onSelectLocation: (loc: WeatherLocation) => void;
  showStations: boolean;
  onRefreshWeather?: () => void;
}

export function WeatherMarkers({
  selectedLocation,
  savedLocations = [],
  currentBundle,
  multiModelBundle,
  unitSystem,
  onSelectLocation,
  showStations,
  onRefreshWeather,
}: WeatherMarkersProps) {
  const map = useMap();
  const [showInfoWindow, setShowInfoWindow] = useState(true);
  // Below 1024px the bottom sheet already shows this summary, so skip the InfoWindow clutter.
  const isMobile = !useIsDesktop();
  const { onChangeSheetSnap } = useAppData();

  useEffect(() => {
    setShowInfoWindow(true);
  }, [selectedLocation.id]);

  const isMetric = unitSystem === 'METRIC';
  const current = currentBundle?.current;
  const hasGoogleLive = !!current && !currentBundle?.isUnsupportedLocation;

  // Derive fallback current temperature & wind from Open-Meteo WeatherNext 2 / ECMWF when Google Weather API is not enabled
  const firstHourly = multiModelBundle?.hourly3h?.[0];
  const todayRow = multiModelBundle?.daily7d?.[0];
  const rawTempVal = hasGoogleLive
    ? current?.temperature?.degrees
    : firstHourly?.weatherNext2.temp ?? firstHourly?.ecmwf.temp ?? firstHourly?.gfs.temp;

  const tempUnit = hasGoogleLive ? current?.temperature?.unit : 'CELSIUS';

  const displayTemp =
    rawTempVal !== null && rawTempVal !== undefined
      ? tempUnit === 'FAHRENHEIT'
        ? Math.round(isMetric ? ((rawTempVal - 32) * 5) / 9 : rawTempVal)
        : tempUnit === 'CELSIUS' || !hasGoogleLive
        ? Math.round(isMetric ? rawTempVal : (rawTempVal * 9) / 5 + 32)
        : Math.round(rawTempVal)
      : undefined;

  const conditionText = hasGoogleLive
    ? current?.weatherCondition?.description?.text || 'Clear'
    : todayRow?.bom?.shortText ||
      (firstHourly?.weatherNext2.precipMm && firstHourly.weatherNext2.precipMm > 0.5
        ? 'Showers Forecast'
        : 'Open-Meteo + BOM');

  const stationDots = useMemo(
    () =>
      [...PRESET_LOCATIONS, ...savedLocations].filter(
        (loc) =>
          loc.id !== selectedLocation.id &&
          (Math.abs(loc.lat - selectedLocation.lat) > 0.03 || Math.abs(loc.lng - selectedLocation.lng) > 0.03)
      ),
    [selectedLocation, savedLocations]
  );

  return (
    <>
      {/* Selected Location AdvancedMarker */}
      <AdvancedMarker
        position={{ lat: selectedLocation.lat, lng: selectedLocation.lng }}
        title={`${selectedLocation.name}${displayTemp !== undefined ? ` ${displayTemp}°` : ''}`}
        zIndex={100}
        onClick={() => {
          if (isMobile) {
            // Mobile: the sheet is the "info window".
            onChangeSheetSnap('half');
            return;
          }
          setShowInfoWindow((prev) => {
            const next = !prev;
            if (next && map) {
              panToWithVerticalOffset(map, selectedLocation.lat, selectedLocation.lng);
            }
            return next;
          });
        }}
      >
        <Pin
          background={selectedLocation.isManual ? '#ff3b30' : '#32ADE6'}
          borderColor="#ffffff"
          glyphColor="#ffffff"
          scale={1.15}
        />
      </AdvancedMarker>

      {/* Desktop InfoWindow */}
      {showInfoWindow && !isMobile && (
        <InfoWindow
          position={{ lat: selectedLocation.lat, lng: selectedLocation.lng }}
          pixelOffset={[0, -44]}
          disableAutoPan={true}
          onCloseClick={() => setShowInfoWindow(false)}
        >
          <div className="w-[290px] p-0.5 text-slate-800 font-sans text-xs space-y-2">
            <div className="border-b border-slate-100 pb-2">
              <div className="text-[10px] font-semibold text-sky-700">
                {selectedLocation.region ? `${selectedLocation.region}, ` : ''}
                {selectedLocation.country || 'North Queensland'}
                {' · '}
                {hasGoogleLive ? 'Google Weather + Multi-Model' : 'WeatherNext 2 · BOM · ECMWF · GFS'}
              </div>

              <div className="flex items-baseline justify-between gap-2 mt-1">
                <h4 className="text-sm font-bold text-slate-900 truncate">{selectedLocation.name}</h4>
                <span className="text-base font-extrabold font-mono tabular-nums text-slate-900">
                  {displayTemp !== undefined ? `${displayTemp}°${isMetric ? 'C' : 'F'}` : '--'}
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">{conditionText}</div>
            </div>

            {/* 4-Model Consensus Snapshot */}
            {multiModelBundle && (
              <div className="space-y-1.5 text-[11px] tabular-nums">
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                  <span>Today Consensus</span>
                  <span className="text-slate-700">{multiModelBundle.spreadOverview.agreementLabel}</span>
                </div>
                {todayRow && (
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-[10px]">
                    <div>
                      <span className="text-slate-500 font-sans">WN2:</span>{' '}
                      <span className="font-bold text-slate-900">
                        {todayRow.weatherNext2.minTemp ?? '—'}°/{todayRow.weatherNext2.maxTemp ?? '—'}°
                      </span>{' '}
                      <span className="text-sky-700">{todayRow.weatherNext2.rainMm ?? 0}mm</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans">BOM:</span>{' '}
                      <span className="font-bold text-slate-900">
                        {todayRow.bom?.minTemp ?? '—'}°/{todayRow.bom?.maxTemp ?? '—'}°
                      </span>{' '}
                      <span className="text-emerald-700">{todayRow.bom?.rainMm ?? '—'}mm</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans">ECMWF:</span>{' '}
                      <span className="font-bold text-slate-900">
                        {todayRow.ecmwf.minTemp ?? '—'}°/{todayRow.ecmwf.maxTemp ?? '—'}°
                      </span>{' '}
                      <span className="text-indigo-700">{todayRow.ecmwf.rainMm ?? 0}mm</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans">GFS:</span>{' '}
                      <span className="font-bold text-slate-900">
                        {todayRow.gfs.minTemp ?? '—'}°/{todayRow.gfs.maxTemp ?? '—'}°
                      </span>{' '}
                      <span className="text-amber-700">{todayRow.gfs.rainMm ?? 0}mm</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                  <span>
                    24h Rain Mean: <strong className="text-slate-800">{multiModelBundle.spreadOverview.peak24hRainConsensusMm ?? 0} mm</strong>
                  </span>
                  {onRefreshWeather && (
                    <button
                      type="button"
                      onClick={onRefreshWeather}
                      className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </InfoWindow>
      )}

      {/* NQ Preset Town Pins */}
      {showStations &&
        stationDots.map((station) => (
          <AdvancedMarker
            key={station.id}
            position={{ lat: station.lat, lng: station.lng }}
            title={station.name}
            zIndex={25}
            onClick={() => {
              onSelectLocation(station);
              setShowInfoWindow(true);
            }}
          >
            <div className="px-2.5 py-1 rounded-lg bg-[#141416]/90 backdrop-blur-md border border-white/15 shadow-lg text-[10px] font-semibold text-white hover:bg-[#1d334a] hover:border-[#32ADE6]/60 transition-colors cursor-pointer flex items-center gap-1.5">
              <CloudRain className="w-2.5 h-2.5 text-[#32ADE6]" />
              <span>{station.name.split('/')[0].trim()}</span>
            </div>
          </AdvancedMarker>
        ))}
    </>
  );
}
