/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { BarChart3, AlertTriangle, RefreshCw, Layers, Wind } from 'lucide-react';
import {
  GeminiCycloneSynthesis,
  MultiModelBundle,
  WeatherNext3Bundle,
  WeatherNext3DailyMetrics,
  WeatherUnitSystem,
} from '../types/weather';

interface MultiModelComparisonProps {
  bundle: MultiModelBundle | null;
  isLoading: boolean;
  unitSystem: WeatherUnitSystem;
  onRefresh: () => void;
  cycloneMode?: boolean;
  wn3Bundle?: WeatherNext3Bundle | null;
  cycloneSynthesis?: GeminiCycloneSynthesis | null;
}

type HourlyMetric = 'temp' | 'rain' | 'wind';

export function MultiModelComparison({
  bundle,
  isLoading,
  unitSystem,
  onRefresh,
  cycloneMode = false,
  wn3Bundle = null,
  cycloneSynthesis = null,
}: MultiModelComparisonProps) {
  const [hourlyMetric, setHourlyMetric] = useState<HourlyMetric>('rain');
  const isMetric = unitSystem === 'METRIC';

  const fmtTemp = (c: number | null | undefined): string => {
    if (c === null || c === undefined || !Number.isFinite(c)) return '—';
    const val = isMetric ? c : (c * 9) / 5 + 32;
    return `${Math.round(val)}°`;
  };

  const fmtTempDelta = (c: number | null | undefined): string => {
    if (c === null || c === undefined || !Number.isFinite(c)) return '—';
    const val = isMetric ? c : (c * 9) / 5;
    return `${val.toFixed(1)}°`;
  };

  const fmtRain = (mm: number | null | undefined): string => {
    if (mm === null || mm === undefined || !Number.isFinite(mm)) return '—';
    if (isMetric) return `${mm < 10 ? mm.toFixed(1) : Math.round(mm)}`;
    return `${(mm / 25.4).toFixed(2)}`;
  };

  const fmtWind = (kmh: number | null | undefined): string => {
    if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return '—';
    const val = isMetric ? kmh : kmh * 0.621371;
    return `${Math.round(val)}`;
  };

  if (isLoading && !bundle) {
    return (
      <div className="space-y-3 py-2">
        <div className="h-24 rounded-[20px] bg-white/[0.08] animate-pulse" />
        <div className="h-44 rounded-[20px] bg-white/[0.08] animate-pulse" />
        <div className="h-56 rounded-[20px] bg-white/[0.08] animate-pulse" />
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="ios-bento-card p-4 text-xs text-white/75 flex items-center justify-between">
        <span>Multi-model forecast data unavailable.</span>
        <button
          type="button"
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-[10px] bg-[#32ADE6] text-[#111113] font-semibold hover:bg-[#4cbdf0] cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const { hourly3h, daily7d, spreadOverview, bomLocation, bomWarnings, sourcesAvailable } = bundle;
  const showWn3Column = cycloneMode && (!!wn3Bundle || !!cycloneSynthesis);

  const getWn3ForRow = (timeIso: string) => {
    if (!wn3Bundle || wn3Bundle.hourly120h.length === 0) return null;
    const targetMs = new Date(timeIso).getTime();
    if (!Number.isFinite(targetMs)) return null;

    const windowSamples = wn3Bundle.hourly120h.filter((h) => {
      const t = new Date(h.timeIso).getTime();
      return Number.isFinite(t) && t >= targetMs - 30 * 60000 && t < targetMs + 2.5 * 3600000;
    });

    if (windowSamples.length === 0) return null;
    const temps = windowSamples.map((s) => s.tempC).filter((v): v is number => v !== null);
    const rains = windowSamples.map((s) => s.precipMm).filter((v): v is number => v !== null);
    const gusts = windowSamples.map((s) => s.windGustKmh ?? s.windSpeedKmh).filter((v): v is number => v !== null);
    const winds = windowSamples.map((s) => s.windSpeedKmh).filter((v): v is number => v !== null);
    const pressures = windowSamples.map((s) => s.pressureMb).filter((v): v is number => v !== null);

    return {
      temp: temps.length > 0 ? temps[0] : null,
      precipMm: rains.length > 0 ? rains.reduce((a, b) => a + b, 0) : null,
      windKmh: gusts.length > 0 ? Math.max(...gusts) : winds.length > 0 ? winds[0] : null,
      pressureMb: pressures.length > 0 ? Math.min(...pressures) : null,
    };
  };

  const wn3HourlyAligned = hourly3h.map((row) => getWn3ForRow(row.timeIso));

  const chartW = 360;
  const chartH = 110;
  const padX = 16;
  const padY = 14;
  const usableW = chartW - padX * 2;
  const usableH = chartH - padY * 2;

  const getVal = (sample: { temp: number | null; precipMm: number | null; windKmh: number | null } | null): number | null => {
    if (!sample) return null;
    if (hourlyMetric === 'temp') return sample.temp === null ? null : isMetric ? sample.temp : (sample.temp * 9) / 5 + 32;
    if (hourlyMetric === 'rain') return sample.precipMm === null ? null : isMetric ? sample.precipMm : sample.precipMm / 25.4;
    return sample.windKmh === null ? null : isMetric ? sample.windKmh : sample.windKmh * 0.621371;
  };

  const allSeriesVals: number[] = [];
  hourly3h.forEach((row, idx) => {
    [row.weatherNext2, row.ecmwf, row.gfs, wn3Bundle ? wn3HourlyAligned[idx] : null].forEach((s) => {
      const v = getVal(s);
      if (v !== null && Number.isFinite(v)) allSeriesVals.push(v);
    });
  });

  const rawMin = allSeriesVals.length > 0 ? Math.min(...allSeriesVals) : 0;
  const rawMax = allSeriesVals.length > 0 ? Math.max(...allSeriesVals) : 10;
  const yMin = hourlyMetric === 'rain' ? 0 : Math.floor(rawMin - 1);
  const yMax =
    hourlyMetric === 'rain'
      ? Math.max(isMetric ? 5 : 0.5, isMetric ? Math.ceil(rawMax * 1.15) : Math.ceil(rawMax * 11.5) / 10)
      : Math.ceil(rawMax + 1);
  const ySpan = Math.max(0.1, yMax - yMin);

  const buildPath = (extractor: (idx: number) => number | null): string => {
    const pts: Array<{ x: number; y: number }> = [];
    hourly3h.forEach((_, i) => {
      const val = extractor(i);
      if (val === null || !Number.isFinite(val)) return;
      const x = hourly3h.length > 1 ? padX + (i / (hourly3h.length - 1)) * usableW : chartW / 2;
      const y = padY + (1 - (val - yMin) / ySpan) * usableH;
      pts.push({ x, y });
    });
    if (pts.length === 0) return '';
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  };

  const wn3Path = wn3Bundle ? buildPath((i) => getVal(wn3HourlyAligned[i])) : '';
  const wn2Path = buildPath((i) => getVal(hourly3h[i].weatherNext2));
  const ecmwfPath = buildPath((i) => getVal(hourly3h[i].ecmwf));
  const gfsPath = buildPath((i) => getVal(hourly3h[i].gfs));

  const wn3ByDate: Record<string, WeatherNext3DailyMetrics> = {};
  (wn3Bundle?.daily10d || []).forEach((d) => {
    if (d.dateKey) wn3ByDate[d.dateKey] = d;
  });

  const existingDateSet = new Set(daily7d.map((d) => d.dateKey));
  const extraWn3Days = wn3Bundle
    ? wn3Bundle.daily10d.filter((d) => d.dateKey && !existingDateSet.has(d.dateKey)).slice(0, 3)
    : [];

  const agreementAccent =
    spreadOverview.agreementLabel === 'High Agreement'
      ? 'text-[#34c759]'
      : spreadOverview.agreementLabel === 'Moderate Spread'
      ? 'text-[#ff9500]'
      : 'text-[#ff3b30]';

  return (
    <div className="space-y-3.5 text-white">
      {/* Consensus Spread Summary Bento */}
      <div className="ios-bento-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/60 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-[#32ADE6] shrink-0" />
              <span>Consensus Spread</span>
            </div>
            <div className={`text-sm font-semibold mt-1 ${agreementAccent}`}>
              {spreadOverview.agreementLabel}
            </div>
            <p className="text-[11px] mt-1 leading-relaxed text-white/70">
              {spreadOverview.agreementDetail}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white/80 cursor-pointer shrink-0 transition-colors"
            aria-label="Refresh ensemble"
            title="Refresh ensemble"
          >
            <RefreshCw aria-hidden="true" className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-white/10 text-xs tabular-nums">
          <div>
            <div className="text-[10px] text-white/60">Avg Max Δ</div>
            <div className="font-mono font-semibold text-sm text-white mt-0.5">
              {fmtTempDelta(spreadOverview.avgTempSpreadC)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-white/60">Peak 7d Rain Δ</div>
            <div className="font-mono font-semibold text-sm text-white mt-0.5">
              {spreadOverview.maxRainSpreadMm !== null
                ? `${fmtRain(spreadOverview.maxRainSpreadMm)} ${isMetric ? 'mm' : 'in'}`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-white/60">24h Mean Rain</div>
            <div className="font-mono font-semibold text-sm text-[#32ADE6] mt-0.5">
              {spreadOverview.peak24hRainConsensusMm !== null
                ? `${fmtRain(spreadOverview.peak24hRainConsensusMm)} ${isMetric ? 'mm' : 'in'}`
                : '—'}
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-white/10 text-[10px] flex flex-wrap items-center gap-x-2 gap-y-1 text-white/60">
          {cycloneMode && (
            <>
              <span className="font-semibold text-[#ff3b30]">
                {wn3Bundle ? 'WeatherNext 3 (10d) ✓' : cycloneSynthesis ? 'WN3/BOM/JTWC AI ✓' : 'WN3 Loading…'}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{sourcesAvailable.weatherNext2 ? 'WeatherNext 2 ✓' : 'WeatherNext 2 —'}</span>
          <span aria-hidden="true">·</span>
          <span>{sourcesAvailable.ecmwf ? 'ECMWF IFS ✓' : 'ECMWF IFS —'}</span>
          <span aria-hidden="true">·</span>
          <span>{sourcesAvailable.gfs ? 'NOAA GFS ✓' : 'NOAA GFS —'}</span>
          <span aria-hidden="true">·</span>
          <span>{sourcesAvailable.bom ? `BOM (${bomLocation?.name || 'QLD'}) ✓` : 'BOM —'}</span>
        </div>
      </div>

      {/* BOM Official Warnings */}
      {bomWarnings.length > 0 && (
        <div className="rounded-[20px] border border-[#ff3b30]/40 bg-[#ff3b30]/15 p-3.5 space-y-1.5 backdrop-blur-xl">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-[#ff3b30] shrink-0" />
            <span>BOM Official Warnings ({bomWarnings.length})</span>
          </div>
          <ul className="space-y-1 text-[11px] text-white/85">
            {bomWarnings.map((w) => (
              <li key={w.id} className="leading-snug">
                <span className="font-semibold text-white">{w.shortTitle || w.title}</span>
                {w.phase && <span className="text-rose-200"> · {w.phase}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next 24h 3-Hourly Chart & Table */}
      <div className="ios-bento-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
              Next 24h · 3-Hourly
            </div>
            <p className="text-[11px] text-white/65 mt-0.5">
              Australia/Brisbane · {wn3Bundle ? 'WN3 vs ' : ''}WN2 vs ECMWF vs GFS
            </p>
          </div>

          <div className="flex items-center gap-0.5 bg-white/[0.08] p-0.5 rounded-lg border border-white/10 text-[11px]">
            {(['rain', 'temp', 'wind'] as HourlyMetric[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setHourlyMetric(m)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  hourlyMetric === m ? 'bg-[#32ADE6] text-[#111113] font-semibold' : 'text-white/65 hover:text-white'
                }`}
              >
                {m === 'rain' ? 'Rain' : m === 'temp' ? 'Temp' : 'Wind'}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Line Chart */}
        <div className="bg-black/25 border border-white/10 rounded-xl p-2.5">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-28 overflow-visible">
            <line x1={padX} y1={padY} x2={chartW - padX} y2={padY} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <line x1={padX} y1={padY + usableH / 2} x2={chartW - padX} y2={padY + usableH / 2} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <line x1={padX} y1={chartH - padY} x2={chartW - padX} y2={chartH - padY} stroke="rgba(255,255,255,0.2)" />

            <text x={2} y={padY + 3} fontSize="8" fill="rgba(255,255,255,0.5)" fontFamily="JetBrains Mono, monospace">
              {hourlyMetric === 'rain'
                ? `${yMax}${isMetric ? 'mm' : 'in'}`
                : hourlyMetric === 'wind'
                ? `${yMax}${isMetric ? 'km/h' : 'mph'}`
                : `${yMax}°`}
            </text>
            <text x={2} y={chartH - padY + 3} fontSize="8" fill="rgba(255,255,255,0.5)" fontFamily="JetBrains Mono, monospace">
              {yMin}
            </text>

            {gfsPath && <path d={gfsPath} fill="none" stroke="#ff9500" strokeWidth="2" strokeDasharray="4 2" />}
            {ecmwfPath && <path d={ecmwfPath} fill="none" stroke="#5856d6" strokeWidth="2" />}
            {wn2Path && <path d={wn2Path} fill="none" stroke="#32ADE6" strokeWidth="2.5" />}
            {wn3Path && <path d={wn3Path} fill="none" stroke="#ff3b30" strokeWidth="2.5" />}

            {hourly3h.map((row, idx) => {
              const x = hourly3h.length > 1 ? padX + (idx / (hourly3h.length - 1)) * usableW : chartW / 2;
              return (
                <text
                  key={row.timeIso}
                  x={x}
                  y={chartH - 1}
                  textAnchor="middle"
                  fontSize="8.5"
                  fill="rgba(255,255,255,0.55)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {row.label}
                </text>
              );
            })}
          </svg>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-[10px] text-white/70">
            {wn3Bundle && (
              <span className="flex items-center gap-1.5 font-semibold text-[#ff3b30]">
                <span className="w-3 h-0.5 bg-[#ff3b30] inline-block" /> WN3
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#32ADE6] inline-block" /> WN2
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#5856d6] inline-block" /> ECMWF
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#ff9500] inline-block" /> GFS
            </span>
          </div>
        </div>

        {/* 3-Hourly Compact Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-white/60 text-left">
                <th className="py-1.5 pr-1.5 font-medium">Time</th>
                {wn3Bundle && (
                  <th className="py-1.5 px-1 font-semibold text-right text-[#ff3b30]">WN3</th>
                )}
                <th className="py-1.5 px-1 font-semibold text-right text-[#32ADE6]">WN2</th>
                <th className="py-1.5 px-1 font-semibold text-right text-indigo-400">ECMWF</th>
                <th className="py-1.5 px-1 font-semibold text-right text-[#ff9500]">GFS</th>
                <th className="py-1.5 pl-1 font-medium text-right">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] font-mono">
              {hourly3h.map((row, idx) => {
                const wn3Sample = wn3Bundle ? wn3HourlyAligned[idx] : null;
                const renderCell = (s: { temp: number | null; precipMm: number | null; windKmh: number | null } | null) => {
                  if (!s) return '—';
                  if (hourlyMetric === 'temp') return fmtTemp(s.temp);
                  if (hourlyMetric === 'rain') return `${fmtRain(s.precipMm)}${isMetric ? 'mm' : 'in'}`;
                  return `${fmtWind(s.windKmh)}${isMetric ? 'km/h' : 'mph'}`;
                };
                const winds = [row.weatherNext2.windKmh, row.ecmwf.windKmh, row.gfs.windKmh].filter(
                  (v): v is number => typeof v === 'number' && Number.isFinite(v)
                );
                const windSpreadKmh = winds.length >= 2 ? Math.max(...winds) - Math.min(...winds) : null;
                const spreadStr =
                  hourlyMetric === 'temp'
                    ? fmtTempDelta(row.tempSpreadC)
                    : hourlyMetric === 'rain'
                    ? `${fmtRain(row.rainSpreadMm)}${isMetric ? 'mm' : 'in'}`
                    : windSpreadKmh !== null
                    ? `${fmtWind(windSpreadKmh)}${isMetric ? 'km/h' : 'mph'}`
                    : '—';

                return (
                  <tr key={row.timeIso} className="hover:bg-white/[0.04]">
                    <td className="py-1.5 pr-1.5 font-sans font-medium text-white/85">{row.label}</td>
                    {wn3Bundle && (
                      <td className="py-1.5 px-1 text-right font-semibold text-rose-300 bg-[#ff3b30]/10">
                        {renderCell(wn3Sample)}
                      </td>
                    )}
                    <td className="py-1.5 px-1 text-right text-white">{renderCell(row.weatherNext2)}</td>
                    <td className="py-1.5 px-1 text-right text-white/80">{renderCell(row.ecmwf)}</td>
                    <td className="py-1.5 px-1 text-right text-white/80">{renderCell(row.gfs)}</td>
                    <td className="py-1.5 pl-1 text-right text-white/60">{spreadStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Multi-Model Matrix */}
      <div className="ios-bento-card p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/60 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#32ADE6]" />
              <span>{wn3Bundle ? '10-Day 5-System Matrix' : '7-Day 4-System Matrix'}</span>
            </div>
            <p className="text-[11px] text-white/60 mt-0.5">
              Min/Max · Rain ({isMetric ? 'mm' : 'in'}){wn3Bundle ? ' · Gust & hPa' : ''}
            </p>
          </div>
          {cycloneMode && (
            <span className="text-[10px] font-semibold text-[#ff3b30] flex items-center gap-1 shrink-0">
              <Wind className="w-3 h-3" />
              WN3 Active
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-white/60 text-left">
                <th className="py-1.5 pr-1.5 font-medium">Day</th>
                {showWn3Column && (
                  <th className="py-1.5 px-1 font-semibold text-right text-[#ff3b30] bg-[#ff3b30]/10">
                    WN3
                  </th>
                )}
                <th className="py-1.5 px-1 font-semibold text-right text-[#32ADE6]">WN2</th>
                <th className="py-1.5 px-1 font-semibold text-right text-[#34c759]">BOM</th>
                <th className="py-1.5 px-1 font-semibold text-right text-indigo-400">ECMWF</th>
                <th className="py-1.5 px-1 font-semibold text-right text-[#ff9500]">GFS</th>
                <th className="py-1.5 pl-1 font-medium text-right">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {daily7d.map((day) => {
                const wn3Day = wn3ByDate[day.dateKey] || null;
                const renderModelCol = (m: typeof day.bom) => {
                  if (!m) return <span className="text-white/30">—</span>;
                  return (
                    <div className="flex flex-col items-end leading-tight font-mono">
                      <span className="text-white font-medium">
                        {fmtTemp(m.minTemp)}/{fmtTemp(m.maxTemp)}
                      </span>
                      <span className={`text-[10px] ${(m.rainMm ?? 0) >= 5 ? 'text-[#32ADE6] font-semibold' : 'text-white/65'}`}>
                        {m.rainMm !== null && m.rainMm !== undefined ? `${fmtRain(m.rainMm)}${isMetric ? 'mm' : 'in'}` : '—'}
                      </span>
                    </div>
                  );
                };

                const maxCandidates = [
                  day.weatherNext2.maxTemp,
                  day.bom?.maxTemp,
                  day.ecmwf.maxTemp,
                  day.gfs.maxTemp,
                  wn3Day?.maxTemp,
                ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
                const rainCandidates = [
                  day.weatherNext2.rainMm,
                  day.bom?.rainMm,
                  day.ecmwf.rainMm,
                  day.gfs.rainMm,
                  wn3Day?.rainMm,
                ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

                const effectiveDeltaT =
                  maxCandidates.length >= 2 ? Math.round((Math.max(...maxCandidates) - Math.min(...maxCandidates)) * 10) / 10 : day.deltaMaxTemp;
                const effectiveDeltaR =
                  rainCandidates.length >= 2 ? Math.round((Math.max(...rainCandidates) - Math.min(...rainCandidates)) * 10) / 10 : day.deltaRainMm;

                return (
                  <tr key={day.dateKey} className="hover:bg-white/[0.04] align-top">
                    <td className="py-2 pr-1.5">
                      <div className="font-semibold text-white whitespace-nowrap">{day.dayLabel}</div>
                      {(wn3Day?.shortText || day.bom?.shortText) && (
                        <div className="text-[10px] text-white/60 line-clamp-1 max-w-[85px]" title={wn3Day?.shortText || day.bom?.shortText}>
                          {wn3Day?.shortText || day.bom?.shortText}
                        </div>
                      )}
                    </td>

                    {showWn3Column && (
                      <td className="py-2 px-1 text-right bg-[#ff3b30]/10 font-mono">
                        {wn3Day ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-white font-semibold">
                              {fmtTemp(wn3Day.minTemp)}/{fmtTemp(wn3Day.maxTemp)}
                            </span>
                            <span className={`text-[10px] ${(wn3Day.rainMm ?? 0) >= 5 ? 'text-[#32ADE6] font-semibold' : 'text-white/60'}`}>
                              {wn3Day.rainMm !== null ? `${fmtRain(wn3Day.rainMm)}${isMetric ? 'mm' : 'in'}` : '—'}
                            </span>
                            {wn3Day.peakGustKmh !== null && (
                              <span className={`text-[9px] ${wn3Day.peakGustKmh >= 65 ? 'text-[#ff3b30] font-semibold' : 'text-white/60'}`}>
                                G {fmtWind(wn3Day.peakGustKmh)}{isMetric ? 'km/h' : 'mph'}
                              </span>
                            )}
                            {wn3Day.minPressureMb !== null && (
                              <span className="text-[9px] text-indigo-300">
                                {Math.round(wn3Day.minPressureMb)}hPa
                              </span>
                            )}
                            {wn3Day.peakThunderstormPct !== null && wn3Day.peakThunderstormPct > 0 && (
                              <span className="text-[9px] text-[#ff9500] font-semibold">
                                ⚡ {wn3Day.peakThunderstormPct}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-rose-300 font-sans">AI Synth</span>
                        )}
                      </td>
                    )}

                    <td className="py-2 px-1 text-right">{renderModelCol(day.weatherNext2)}</td>
                    <td className="py-2 px-1 text-right">{renderModelCol(day.bom)}</td>
                    <td className="py-2 px-1 text-right">{renderModelCol(day.ecmwf)}</td>
                    <td className="py-2 px-1 text-right">{renderModelCol(day.gfs)}</td>
                    <td className="py-2 pl-1 text-right font-mono">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-white/75">ΔT {fmtTempDelta(effectiveDeltaT)}</span>
                        <span
                          className={`text-[10px] font-semibold ${
                            (effectiveDeltaR ?? 0) >= 15
                              ? 'text-[#ff3b30]'
                              : (effectiveDeltaR ?? 0) >= 5
                              ? 'text-[#ff9500]'
                              : 'text-[#34c759]'
                          }`}
                        >
                          ΔR {effectiveDeltaR !== null ? `${fmtRain(effectiveDeltaR)}${isMetric ? 'mm' : 'in'}` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {showWn3Column &&
                extraWn3Days.map((wn3Day) => (
                  <tr key={wn3Day.dateKey} className="hover:bg-white/[0.04] align-top">
                    <td className="py-2 pr-1.5">
                      <div className="font-semibold text-white/85 whitespace-nowrap">{wn3Day.dayLabel}</div>
                      <div className="text-[9px] text-white/60">WN3 Ext</div>
                    </td>
                    <td className="py-2 px-1 text-right bg-[#ff3b30]/10 font-mono">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-white font-semibold">
                          {fmtTemp(wn3Day.minTemp)}/{fmtTemp(wn3Day.maxTemp)}
                        </span>
                        <span className={`text-[10px] ${(wn3Day.rainMm ?? 0) >= 5 ? 'text-[#32ADE6] font-semibold' : 'text-white/60'}`}>
                          {wn3Day.rainMm !== null ? `${fmtRain(wn3Day.rainMm)}${isMetric ? 'mm' : 'in'}` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-1 text-right text-white/25">—</td>
                    <td className="py-2 px-1 text-right text-white/25">—</td>
                    <td className="py-2 px-1 text-right text-white/25">—</td>
                    <td className="py-2 px-1 text-right text-white/25">—</td>
                    <td className="py-2 pl-1 text-right text-white/25">—</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
