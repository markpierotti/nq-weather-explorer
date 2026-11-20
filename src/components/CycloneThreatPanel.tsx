/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import {
  Wind,
  Gauge,
  CloudRain,
  AlertTriangle,
  RefreshCw,
  Settings2,
  Sparkles,
  ExternalLink,
  Globe,
  Check,
  Trash2,
} from 'lucide-react';
import {
  CycloneThreatDetection,
  GeminiCycloneSynthesis,
  WeatherNext3Bundle,
  WeatherUnitSystem,
} from '../types/weather';

interface CycloneThreatPanelProps {
  cycloneMode: boolean;
  onToggleCycloneMode: () => void;
  threatDetection: CycloneThreatDetection;
  wn3ApiKey: string;
  onSaveWn3ApiKey: (key: string) => void;
  wn3Bundle: WeatherNext3Bundle | null;
  cycloneSynthesis: GeminiCycloneSynthesis | null;
  isLoading: boolean;
  error: string | null;
  unitSystem: WeatherUnitSystem;
  onRefresh: (forceNetwork?: boolean) => void;
  onFallbackToGemini: () => void;
}

export function CycloneThreatPanel({
  cycloneMode,
  threatDetection,
  wn3ApiKey,
  onSaveWn3ApiKey,
  wn3Bundle,
  cycloneSynthesis,
  isLoading,
  error,
  unitSystem,
  onRefresh,
  onFallbackToGemini,
}: CycloneThreatPanelProps) {
  const [showKeySettings, setShowKeySettings] = useState(false);
  const [draftKey, setDraftKey] = useState(wn3ApiKey);
  const isMetric = unitSystem === 'METRIC';

  if (!cycloneMode) return null;

  const fmtWind = (kmh: number | null | undefined) => {
    if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return '—';
    return isMetric ? `${Math.round(kmh)} km/h` : `${Math.round(kmh * 0.621371)} mph`;
  };

  const fmtRain = (mm: number | null | undefined) => {
    if (mm === null || mm === undefined || !Number.isFinite(mm)) return '—';
    return isMetric ? `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm` : `${(mm / 25.4).toFixed(2)} in`;
  };

  const riskBadgeStyle = (risk?: string) => {
    switch (risk) {
      case 'EXTREME':
        return 'bg-[#ff3b30] text-white border-[#ff3b30]';
      case 'HIGH':
        return 'bg-[#ff3b30]/20 text-rose-200 border-[#ff3b30]/40';
      case 'MODERATE':
        return 'bg-[#ff9500]/20 text-amber-200 border-[#ff9500]/40';
      case 'LOW':
        return 'bg-[#34c759]/20 text-emerald-200 border-[#34c759]/40';
      default:
        return 'bg-white/10 text-white/80 border-white/15';
    }
  };

  const cacheMinutesAgo = wn3Bundle
    ? Math.max(0, Math.round((Date.now() - wn3Bundle.fetchedAt) / 60000))
    : 0;

  return (
    <div className="rounded-[20px] border border-[#ff3b30]/35 bg-[#ff3b30]/10 backdrop-blur-xl p-4 space-y-3 text-white">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-rose-200/80 flex items-center gap-1.5">
            <Wind className="w-3.5 h-3.5 text-[#ff3b30] shrink-0" />
            <span>Cyclone Mode · WeatherNext 3</span>
          </div>
          <p className="text-[11px] text-white/65 mt-1">
            {wn3Bundle
              ? `Active via ${wn3Bundle.source === 'server-proxy' ? 'server proxy' : 'local key'} · 30m cache`
              : wn3ApiKey
              ? 'Direct WeatherNext 3 (120h / 10-day) · 30m cache'
              : 'Using backend Weather proxy (or Gemini Synthesis)'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setDraftKey(wn3ApiKey);
              setShowKeySettings((s) => !s);
            }}
            className={`p-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
              showKeySettings
                ? 'bg-[#ff3b30] border-[#ff3b30] text-white'
                : 'bg-white/10 border-white/10 text-white/80 hover:bg-white/15'
            }`}
            title="Optional local WeatherNext 3 key override"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRefresh(true)}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-white/10 border border-white/10 text-white/80 hover:bg-white/15 cursor-pointer disabled:opacity-50"
            title="Force refresh Cyclone / WeatherNext 3 data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Auto-detected threat reasons if present */}
      {threatDetection.isThreatDetected && (
        <div className="rounded-xl bg-[#ff3b30]/20 border border-[#ff3b30]/35 px-3 py-2 text-[11px] text-white flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-[#ff3b30] shrink-0 mt-0.5" />
          <span>{threatDetection.reasons.join(' · ')}</span>
        </div>
      )}

      {/* Optional key settings */}
      {showKeySettings && (
        <div className="rounded-xl bg-black/30 border border-white/10 p-3 space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">
              Optional Local Key (<code className="font-mono text-[10px]">wn3_api_key</code>)
            </span>
            <span className="text-[10px] text-white/50">Stored in browser</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="Optional override..."
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/10 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[#32ADE6] font-mono"
            />
            <button
              type="button"
              onClick={() => {
                onSaveWn3ApiKey(draftKey.trim());
                setShowKeySettings(false);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#ff3b30] hover:bg-rose-500 text-white font-semibold flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
            {wn3ApiKey && (
              <button
                type="button"
                onClick={() => {
                  setDraftKey('');
                  onSaveWn3ApiKey('');
                  setShowKeySettings(false);
                }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/75 cursor-pointer shrink-0"
                title="Clear stored key"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-[10px] text-white/55 leading-snug">
            Server <code className="font-mono">GOOGLE_WEATHER_API_KEY</code> proxy is checked first and cached 30 min per coordinate.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="space-y-2 py-1">
          <div className="h-14 rounded-xl bg-white/10 animate-pulse" />
          <div className="h-20 rounded-xl bg-white/10 animate-pulse" />
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-xl bg-black/30 border border-[#ff3b30]/40 p-3 text-[11px] text-rose-100 space-y-2">
          <div>{error}</div>
          <button
            type="button"
            onClick={onFallbackToGemini}
            className="px-3 py-1.5 rounded-lg bg-[#ff3b30] text-white font-semibold hover:bg-rose-500 cursor-pointer text-[11px]"
          >
            Run Gemini Cyclone Synthesis Fallback
          </button>
        </div>
      )}

      {/* Mode 1: Direct WeatherNext 3 Telemetry */}
      {!isLoading && wn3Bundle && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 tabular-nums">
            <div className="rounded-xl bg-white/[0.08] border border-white/10 p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/55 flex items-center gap-1">
                <Wind className="w-3 h-3 text-[#ff3b30]" />
                <span>Peak Gust</span>
              </div>
              <div className="font-mono font-semibold text-base text-white mt-1">
                {fmtWind(wn3Bundle.peak120hGustKmh)}
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.08] border border-white/10 p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/55 flex items-center gap-1">
                <Gauge className="w-3 h-3 text-[#5856d6]" />
                <span>Min Pressure</span>
              </div>
              <div className="font-mono font-semibold text-base text-white mt-1">
                {wn3Bundle.min120hPressureMb !== null ? `${Math.round(wn3Bundle.min120hPressureMb)} hPa` : '—'}
                {wn3Bundle.max120hPressureDropMb !== null && (
                  <span className="text-[10px] text-rose-300 ml-1">
                    (Δ {wn3Bundle.max120hPressureDropMb.toFixed(1)})
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.08] border border-white/10 p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/55 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-[#ff9500]" />
                <span>Storm Prob</span>
              </div>
              <div className="font-mono font-semibold text-base text-white mt-1">
                {wn3Bundle.peak120hThunderstormPct !== null ? `${wn3Bundle.peak120hThunderstormPct}%` : '—'}
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.08] border border-white/10 p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/55 flex items-center gap-1">
                <CloudRain className="w-3 h-3 text-[#32ADE6]" />
                <span>1h / 5d QPF</span>
              </div>
              <div className="font-mono font-semibold text-base text-white mt-1">
                {fmtRain(wn3Bundle.peak1hQpfMm)}
                {wn3Bundle.total120hQpfMm !== null && (
                  <span className="text-[10px] font-normal text-white/55 ml-1">
                    ({fmtRain(wn3Bundle.total120hQpfMm)})
                  </span>
                )}
              </div>
            </div>
          </div>

          {wn3Bundle.alerts.length > 0 && (
            <div className="rounded-xl bg-[#ff3b30]/20 border border-[#ff3b30]/35 p-2.5 space-y-1">
              <div className="text-[11px] font-semibold text-white">
                WeatherNext 3 Public Alerts ({wn3Bundle.alerts.length})
              </div>
              {wn3Bundle.alerts.slice(0, 3).map((a, idx) => (
                <div key={a.alertId || idx} className="text-[11px] text-white/85 leading-snug">
                  <span className="font-semibold">{a.headline || a.eventDescription}</span>
                  {a.severity && <span className="text-rose-200"> · {a.severity}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] font-mono text-white/50 tabular-nums">
            <span>
              {wn3Bundle.fromCache ? `Cached (${cacheMinutesAgo}m ago · 30m TTL)` : 'Fresh fetch · cached 30m'}
            </span>
            <span>{wn3Bundle.daily10d.length}d / {wn3Bundle.hourly120h.length}h</span>
          </div>
        </div>
      )}

      {/* Mode 2: Gemini Cyclone Synthesis Fallback */}
      {!isLoading && !wn3Bundle && cycloneSynthesis && (
        <div className="space-y-2.5">
          <div className="rounded-xl bg-black/25 border border-white/10 p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#32ADE6] shrink-0" />
                <span>{cycloneSynthesis.headline}</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold shrink-0 ${riskBadgeStyle(
                  cycloneSynthesis.bruceHwyCutoffRisk
                )}`}
              >
                Bruce Hwy: {cycloneSynthesis.bruceHwyCutoffRisk}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-white/[0.06] border border-white/10 p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Peak Gusts</div>
                <div className="text-white font-medium mt-0.5">{cycloneSynthesis.peakGusts}</div>
              </div>
              <div className="rounded-lg bg-white/[0.06] border border-white/10 p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Corridor Window</div>
                <div className="text-white font-medium mt-0.5">{cycloneSynthesis.corridorWindow}</div>
              </div>
              <div className="rounded-lg bg-white/[0.06] border border-white/10 p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Rainfall Range</div>
                <div className="text-white font-medium mt-0.5">{cycloneSynthesis.rainfallRange}</div>
              </div>
              <div className="rounded-lg bg-white/[0.06] border border-white/10 p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Bruce Hwy Note</div>
                <div className="text-white font-medium mt-0.5">{cycloneSynthesis.bruceHwyDetail}</div>
              </div>
            </div>

            {cycloneSynthesis.bullets.length > 0 && (
              <ul className="space-y-1.5 text-[11px] text-white/80 pt-2 border-t border-white/10">
                {cycloneSynthesis.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5 leading-snug">
                    <span className="text-[#32ADE6] font-bold">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}

            {cycloneSynthesis.citations.length > 0 && (
              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[10px] text-white/50 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Sources:
                </span>
                {cycloneSynthesis.citations.slice(0, 4).map((c) => (
                  <a
                    key={c.uri}
                    href={c.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#32ADE6] hover:underline inline-flex items-center gap-0.5 max-w-[180px] truncate"
                  >
                    <span className="truncate">{c.title}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
