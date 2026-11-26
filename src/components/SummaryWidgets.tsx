/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sun, Droplets, Wind, Navigation } from 'lucide-react';
import { LocationWeatherBundle, WeatherUnitSystem } from '../types/weather';

interface SummaryWidgetsProps {
  weatherBundle: LocationWeatherBundle | null;
  unitSystem: WeatherUnitSystem;
  isLoading?: boolean;
}

function getUvMeta(uv: number): { label: string; colorClass: string } {
  if (uv <= 2) return { label: 'Low', colorClass: 'text-[#34c759]' };
  if (uv <= 5) return { label: 'Moderate', colorClass: 'text-[#ffcc00]' };
  if (uv <= 7) return { label: 'High', colorClass: 'text-[#ff9500]' };
  if (uv <= 10) return { label: 'Very High', colorClass: 'text-[#ff3b30]' };
  return { label: 'Extreme', colorClass: 'text-[#bf5af2]' };
}

function getHumidityLabel(humidity: number): string {
  if (humidity < 35) return 'Dry air';
  if (humidity <= 65) return 'Comfortable';
  if (humidity <= 80) return 'Humid';
  return 'Very humid';
}

export function SummaryWidgets({
  weatherBundle,
  unitSystem,
  isLoading = false,
}: SummaryWidgetsProps) {
  const isMetric = unitSystem === 'METRIC';
  // Never present the offline simulated estimate as live conditions.
  const current = weatherBundle?.isSimulated ? undefined : weatherBundle?.current;
  const fallbackHour = weatherBundle?.isSimulated ? undefined : weatherBundle?.hourly?.[0];

  if (isLoading && !current && !fallbackHour) {
    return (
      <section aria-label="Summary Widgets" className="grid grid-cols-3 gap-2.5">
        <div className="h-[104px] rounded-[20px] bg-white/[0.08] animate-pulse" />
        <div className="h-[104px] rounded-[20px] bg-white/[0.08] animate-pulse" />
        <div className="h-[104px] rounded-[20px] bg-white/[0.08] animate-pulse" />
      </section>
    );
  }

  // 1. UV Index
  const rawUv = current?.uvIndex ?? fallbackHour?.uvIndex;
  const hasUv = typeof rawUv === 'number' && Number.isFinite(rawUv);
  const uvVal = hasUv ? Math.max(0, rawUv) : null;
  const uvDisplay =
    uvVal !== null ? (Number.isInteger(uvVal) ? String(uvVal) : uvVal.toFixed(1)) : '—';
  const uvMeta = uvVal !== null ? getUvMeta(uvVal) : { label: 'Unavailable', colorClass: 'text-white/45' };
  const uvPct = uvVal !== null ? Math.min(100, Math.max(4, (uvVal / 12) * 100)) : 0;

  // 2. Humidity & Dew Point
  const rawHumidity = current?.relativeHumidity ?? fallbackHour?.relativeHumidity;
  const hasHumidity = typeof rawHumidity === 'number' && Number.isFinite(rawHumidity);
  const humidityVal = hasHumidity ? Math.min(100, Math.max(0, Math.round(rawHumidity))) : null;

  const rawDew = current?.dewPoint?.degrees;
  const dewUnit = current?.dewPoint?.unit;
  let dewDisplay: string | null = null;
  if (typeof rawDew === 'number' && Number.isFinite(rawDew)) {
    const dewInTarget =
      dewUnit === 'FAHRENHEIT'
        ? isMetric
          ? ((rawDew - 32) * 5) / 9
          : rawDew
        : isMetric
        ? rawDew
        : (rawDew * 9) / 5 + 32;
    dewDisplay = `Dew ${Math.round(dewInTarget)}°`;
  }

  // 3. Wind Speed, Direction & Gusts
  const windSource = current?.windSpeed ?? fallbackHour?.windSpeed;
  const rawWind = windSource?.value;
  const windUnit = windSource?.unit;
  const hasWind = typeof rawWind === 'number' && Number.isFinite(rawWind);

  const convertSpeed = (val: number, unit?: string): number => {
    if (unit === 'MILES_PER_HOUR') {
      return isMetric ? val / 0.621371 : val;
    }
    // Default KILOMETERS_PER_HOUR
    return isMetric ? val : val * 0.621371;
  };

  const windVal = hasWind ? Math.round(convertSpeed(rawWind, windUnit)) : null;
  const speedUnitLabel = isMetric ? 'km/h' : 'mph';

  const windDirObj = current?.windDirection ?? fallbackHour?.windDirection;
  const windCardinal = windDirObj?.cardinal || null;
  const windDegrees = typeof windDirObj?.degrees === 'number' ? windDirObj.degrees : null;

  const rawGust = current?.windGust?.value;
  const gustVal =
    typeof rawGust === 'number' && Number.isFinite(rawGust)
      ? Math.round(convertSpeed(rawGust, current?.windGust?.unit || windUnit))
      : null;

  return (
    <section aria-label="Summary Widgets" className="grid grid-cols-3 gap-2.5 tabular-nums">
      {/* Quick-Access Card 1: UV Index */}
      <div className="ios-bento-card p-3 flex flex-col justify-between min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/50 flex items-center gap-1 whitespace-nowrap">
          <Sun className="w-3.5 h-3.5 text-[#ff9500] shrink-0" />
          <span className="truncate">UV Index</span>
        </div>

        <div className="mt-2">
          <div className="text-2xl font-semibold leading-none text-white">{uvDisplay}</div>
          <div className={`text-[11px] font-medium mt-1 truncate ${uvMeta.colorClass}`}>
            {uvMeta.label}
          </div>
        </div>

        <div className="mt-2 w-full h-1.5 rounded-full bg-gradient-to-r from-[#34c759] via-[#ffcc00] via-[#ff9500] to-[#ff3b30] relative">
          {uvVal !== null && (
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white border border-black/40 shadow-xs"
              style={{ left: `${uvPct}%` }}
            />
          )}
        </div>
      </div>

      {/* Quick-Access Card 2: Humidity */}
      <div className="ios-bento-card p-3 flex flex-col justify-between min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/50 flex items-center gap-1 whitespace-nowrap">
          <Droplets className="w-3.5 h-3.5 text-[#32ADE6] shrink-0" />
          <span className="truncate">Humidity</span>
        </div>

        <div className="mt-2">
          <div className="text-2xl font-semibold leading-none text-white">
            {humidityVal !== null ? `${humidityVal}%` : '—'}
          </div>
          <div className="text-[11px] text-white/60 mt-1 truncate">
            {dewDisplay || (humidityVal !== null ? getHumidityLabel(humidityVal) : 'Unavailable')}
          </div>
        </div>

        <div className="mt-2 w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#32ADE6] transition-opacity duration-200"
            style={{ width: `${humidityVal !== null ? Math.max(6, humidityVal) : 0}%` }}
          />
        </div>
      </div>

      {/* Quick-Access Card 3: Wind Speed */}
      <div className="ios-bento-card p-3 flex flex-col justify-between min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/50 flex items-center gap-1 whitespace-nowrap">
          <Wind className="w-3.5 h-3.5 text-[#32ADE6] shrink-0" />
          <span className="truncate">Wind Speed</span>
        </div>

        <div className="mt-2">
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-2xl font-semibold leading-none text-white">
              {windVal !== null ? windVal : '—'}
            </span>
            {windVal !== null && (
              <span className="text-[11px] font-normal text-white/60 shrink-0">
                {speedUnitLabel}
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/60 mt-1 truncate">
            {gustVal !== null && gustVal > (windVal ?? 0)
              ? `Gusts ${gustVal} ${speedUnitLabel}`
              : windCardinal
              ? `From ${windCardinal}`
              : 'Unavailable'}
          </div>
        </div>

        <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] font-mono text-white/65">
          <span>{windCardinal || 'CALM'}</span>
          {windDegrees !== null && (
            <span className="inline-flex items-center gap-1 text-white/50">
              <Navigation
                className="w-2.5 h-2.5 text-[#32ADE6]"
                style={{ transform: `rotate(${(windDegrees + 180) % 360}deg)` }}
              />
              <span>{Math.round(windDegrees)}°</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
