/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CloudRain, Wind, Droplets, Sun, Cloud, Gauge, Eye } from 'lucide-react';
import { CurrentWeather, WeatherUnitSystem } from '../types/weather';

interface AtmosphericMetricsGridProps {
  current: CurrentWeather;
  unitSystem: WeatherUnitSystem;
}

export function AtmosphericMetricsGrid({ current, unitSystem }: AtmosphericMetricsGridProps) {
  const isMetric = unitSystem === 'METRIC';

  const uv = current.uvIndex ?? 0;
  const getUvCategory = (val: number) => {
    if (val <= 2) return { label: 'Low', color: 'text-[#34c759]' };
    if (val <= 5) return { label: 'Moderate', color: 'text-[#ff9500]' };
    if (val <= 7) return { label: 'High', color: 'text-[#ff9500]' };
    if (val <= 10) return { label: 'Very High', color: 'text-[#ff3b30]' };
    return { label: 'Extreme', color: 'text-purple-400' };
  };
  const uvCat = getUvCategory(uv);

  const windSpeed = current.windSpeed?.value ?? 0;
  const windCardinal = current.windDirection?.cardinal ?? 'N';
  const windGust = current.windGust?.value;
  const precipProb = current.precipitation?.probability?.percent ?? 0;
  const precipQpf = current.precipitation?.qpf?.quantity ?? 0;
  const humidity = current.relativeHumidity ?? 0;
  const dewPoint = current.dewPoint?.degrees;
  const cloudCover = current.cloudCover ?? 0;
  const pressure = current.airPressure?.meanSeaLevelMillibars ?? 1013;
  const visibility = current.visibility?.distance ?? (isMetric ? 10 : 6.2);

  return (
    <div className="grid grid-cols-2 gap-3 tabular-nums">
      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
          <span className="flex items-center gap-1.5">
            <CloudRain className="w-3.5 h-3.5 text-[#32ADE6]" /> Precip
          </span>
          <span className="text-[#32ADE6] font-semibold">{precipProb}%</span>
        </div>
        <div className="mt-2.5">
          <div className="text-xl font-semibold text-white">
            {precipQpf > 0 ? `${precipQpf}` : '0'}{' '}
            <span className="text-xs font-normal text-white/60">{isMetric ? 'mm/h' : 'in/h'}</span>
          </div>
          <div className="w-full bg-white/15 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-[#32ADE6] h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(5, precipProb))}%` }}
            />
          </div>
        </div>
      </div>

      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
          <span className="flex items-center gap-1.5">
            <Wind className="w-3.5 h-3.5 text-[#32ADE6]" /> Wind
          </span>
          <span className="text-white/70">{windCardinal}</span>
        </div>
        <div className="mt-2.5">
          <div className="text-xl font-semibold text-white">
            {windSpeed}
            <span className="text-xs font-normal text-white/60 ml-1">{isMetric ? 'km/h' : 'mph'}</span>
          </div>
          <div className="text-[11px] text-white/65 mt-1">
            {windGust ? `Gusts ${windGust} ${isMetric ? 'km/h' : 'mph'}` : 'Steady flow'}
          </div>
        </div>
      </div>

      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
          <span className="flex items-center gap-1.5">
            <Droplets className="w-3.5 h-3.5 text-[#32ADE6]" /> Humidity
          </span>
        </div>
        <div className="mt-2.5">
          <div className="text-xl font-semibold text-white">{humidity}%</div>
          <div className="text-[11px] text-white/65 mt-1">
            {dewPoint !== undefined ? `Dew point ${dewPoint}°${isMetric ? 'C' : 'F'}` : 'Normal moisture'}
          </div>
        </div>
      </div>

      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
          <span className="flex items-center gap-1.5">
            <Sun className="w-3.5 h-3.5 text-[#ff9500]" /> UV Index
          </span>
          <span className={`font-sans normal-case tracking-normal text-[11px] font-semibold ${uvCat.color}`}>
            {uvCat.label}
          </span>
        </div>
        <div className="mt-2.5 flex items-baseline gap-1">
          <span className="text-xl font-semibold text-white">{uv}</span>
          <span className="text-xs text-white/60">/ 11+</span>
        </div>
      </div>

      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
          <span className="flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-indigo-400" /> Cloud
          </span>
          <span className="text-white/75">{cloudCover}%</span>
        </div>
        <div className="mt-3">
          <div className="w-full bg-white/15 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#5856d6] h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(5, cloudCover)}%` }}
            />
          </div>
          <div className="text-[11px] text-white/65 mt-1.5">Sky coverage</div>
        </div>
      </div>

      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
          <span className="flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-[#34c759]" /> Pressure
          </span>
        </div>
        <div className="mt-2.5">
          <div className="text-xl font-semibold text-white">
            {pressure} <span className="text-xs font-normal text-white/60">hPa</span>
          </div>
          <div className="text-[11px] text-white/65 mt-1 flex items-center gap-1">
            <Eye className="w-3 h-3 text-white/60" /> Vis: {visibility} {isMetric ? 'km' : 'mi'}
          </div>
        </div>
      </div>
    </div>
  );
}
