/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { RainViewerFrame } from '../types/weather';
import { useAppData, useRadarData } from '../state/AppDataContext';

const THUMB_PX = 24;

const LEGEND = [
  { color: '#88ddee', label: 'Drizzle' },
  { color: '#00cc66', label: 'Light' },
  { color: '#ffff00', label: 'Moderate' },
  { color: '#ff7e00', label: 'Heavy' },
  { color: '#ff0000', label: 'Intense' },
  { color: '#b30077', label: 'Severe / hail' },
];

function formatBrisbaneTime(unixSec: number): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(unixSec * 1000));
  } catch {
    return new Date(unixSec * 1000).toISOString().slice(11, 16);
  }
}

/**
 * "14:20 · −20 min" for observed frames, "14:40 · +10 min forecast" for nowcast frames (radar moved forward),
 * "17:00 · +2 h model forecast" for Open-Meteo model frames (not radar).
 */
function describeFrame(frame: RainViewerFrame | null, nowMs: number): { text: string; suffix?: string; isForecast: boolean } {
  if (!frame) return { text: 'Syncing radar…', isForecast: false };
  const time = formatBrisbaneTime(frame.time);
  const diffMin = Math.round((frame.time * 1000 - nowMs) / 60000);
  if (frame.kind === 'model') {
    // Minutes up to 2 h: the 15-min frames there would otherwise share "+1.5 h" labels.
    const ahead = diffMin < 120 ? `+${Math.max(0, diffMin)} min` : `+${Math.round(diffMin / 30) / 2} h`;
    // " forecast" is dropped on narrow screens (the attribution row below says it); screen readers get it all.
    return { text: `${time} · ${ahead} model`, suffix: ' forecast', isForecast: true };
  }
  if (frame.kind === 'nowcast') {
    // The latest radar frame is ~10 min old, so the first nowcast frames can land at or just before "now".
    // Like model frames, the suffix is dropped on narrow screens, where the note row below says it.
    if (diffMin <= 0) return { text: `${time} · now`, suffix: ' (forecast)', isForecast: true };
    return { text: `${time} · +${diffMin} min`, suffix: ' forecast', isForecast: true };
  }
  const rel = Math.abs(diffMin) < 1 ? 'now' : `−${Math.abs(diffMin)} min`;
  return { text: `${time} · ${rel}`, isForecast: false };
}

/** Thumb-friendly radar timeline pill (play, scrubber with frame ticks, relative time, speed). */
export function RadarControlBar() {
  const {
    rainViewerData,
    activeFrameIndex,
    onChangeFrameIndex,
    isRadarPlaying,
    onToggleRadarPlay,
    radarSpeed,
    onToggleRadarSpeed,
    radarVisible,
  } = useRadarData();
  const { isDesktop, isSidebarCollapsed, sheetSnap } = useAppData();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showLegend, setShowLegend] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Radar overlay off: no point showing the timeline (turn it back on from the Layers menu).
  if (!radarVisible) return null;

  const frames = rainViewerData?.frames ?? [];
  const lastIdx = Math.max(0, frames.length - 1);
  const idx = Math.min(activeFrameIndex, lastIdx);
  const activeFrame = frames[idx] ?? null;
  const pastCount = frames.filter((f) => f.kind === 'past').length;
  const { text, suffix, isForecast } = describeFrame(activeFrame, nowMs);
  const fullText = text + (suffix ?? '');
  const hasModelFrames = frames.some((f) => f.kind === 'model');
  const hasForecastFrames = pastCount < frames.length;
  const isModelFrame = activeFrame?.kind === 'model';
  const hasNowcastFrames = frames.some((f) => f.kind === 'nowcast');
  // Say what the orange frames are: the nowcast is radar moved forward, the model isn't radar at all,
  // and in between (+30 to +90 min) one fades into the other.
  const forecastNote =
    activeFrame?.nowcast && activeFrame.grid
      ? 'radar trend fading into model'
      : activeFrame?.kind === 'nowcast'
        ? 'radar moved forward, not observed'
        : isModelFrame || !hasNowcastFrames
          ? 'model rain forecast, not radar'
          : 'forecast, not observed radar';
  const hidden = !isDesktop && sheetSnap === 'full';

  // Fraction of the track where forecast frames begin (between the last past and first forecast frame).
  const forecastStart =
    frames.length > 1 && pastCount < frames.length ? Math.max(0, (pastCount - 0.5) / lastIdx) : 1;
  const trackPos = (f: number) => `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${f})`;

  const positionClass = isDesktop
    ? `bottom-5 ${isSidebarCollapsed ? 'left-0 w-full' : 'left-[432px] w-[calc(100vw-432px)]'}`
    : 'left-0 w-full follows-sheet';

  return (
    <div
      className={`fixed z-20 pointer-events-none flex justify-center px-3 transition-[opacity,transform,bottom,left,width] duration-300 ${positionClass} ${
        hidden ? 'opacity-0 translate-y-4' : 'opacity-100'
      }`}
      style={isDesktop ? undefined : { bottom: 'calc(var(--sheet-h, 200px) + 8px)' }}
      aria-hidden={hidden}
      inert={hidden}
    >
      <div
        className={`w-full max-w-[560px] rounded-[24px] bg-[#141416]/85 border border-white/10 pl-2 pr-2 py-2 shadow-2xl shadow-black/60 backdrop-blur-2xl text-white ${
          hidden ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleRadarPlay}
            disabled={frames.length === 0}
            className="w-11 h-11 rounded-full bg-[#32ADE6] hover:bg-[#4cbdf0] disabled:bg-white/15 text-[#111113] disabled:text-white/60 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            title={isRadarPlaying ? 'Pause radar loop' : 'Play radar loop'}
            aria-label={isRadarPlaying ? 'Pause radar loop' : 'Play radar loop'}
          >
            {isRadarPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 px-1">
              <span
                className={`text-xs font-mono font-semibold tabular-nums truncate ${
                  isForecast ? 'text-[#ff9500]' : 'text-white'
                }`}
                aria-live="off"
              >
                {text}
                {suffix && <span className="max-[420px]:hidden">{suffix}</span>}
              </span>
              <button
                type="button"
                onClick={() => setShowLegend((v) => !v)}
                className="flex items-center gap-1 h-8 -my-2 px-1.5 shrink-0 cursor-pointer"
                aria-expanded={showLegend}
                aria-label="Rain intensity legend"
                title="Rain intensity legend"
              >
                <span className="flex h-1.5 w-12 rounded-sm overflow-hidden">
                  {LEGEND.map((l) => (
                    <span key={l.color} className="flex-1" style={{ backgroundColor: l.color }} />
                  ))}
                </span>
              </button>
            </div>

            {/* Scrubber: decorative track + ticks behind a transparent native range input. */}
            <div className="relative h-9">
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full"
                style={{
                  left: THUMB_PX / 2,
                  right: THUMB_PX / 2,
                  background: `linear-gradient(to right, rgba(50,173,230,0.55) 0%, rgba(50,173,230,0.55) ${
                    forecastStart * 100
                  }%, rgba(255,149,0,0.55) ${forecastStart * 100}%, rgba(255,149,0,0.55) 100%)`,
                }}
              />
              {frames.length > 1 &&
                frames.map((f, i) => (
                  <span
                    key={f.time}
                    className={`absolute top-1/2 w-0.5 rounded-full -translate-x-1/2 ${
                      f.kind !== 'past' ? 'bg-[#ff9500] h-2.5 -translate-y-1/2' : 'bg-white/60 h-3 -translate-y-1/2'
                    }`}
                    style={{ left: trackPos(i / lastIdx) }}
                  />
                ))}
              <input
                type="range"
                min={0}
                max={lastIdx}
                step={1}
                value={idx}
                onChange={(e) => onChangeFrameIndex(Number.parseInt(e.target.value, 10))}
                disabled={frames.length === 0}
                className={`radar-scrubber absolute inset-0 w-full h-full ${isForecast ? 'is-forecast' : ''}`}
                aria-label={hasForecastFrames ? 'Radar and forecast timeline' : 'Radar timeline'}
                aria-valuetext={fullText}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleRadarSpeed}
            className={`w-11 h-11 rounded-full text-xs font-bold font-mono tabular-nums shrink-0 cursor-pointer transition-colors ${
              radarSpeed === 2 ? 'bg-white/20 text-white' : 'bg-white/[0.08] text-white/75 hover:text-white'
            }`}
            title="Playback speed"
            aria-label={`Playback speed ${radarSpeed}x`}
          >
            {radarSpeed}×
          </button>
        </div>

        {showLegend && (
          <div className="flex items-center gap-2 pt-1.5 px-1 text-[11px] text-white/60 overflow-x-auto no-scrollbar">
            {LEGEND.map((l) => (
              <span key={l.color} className="flex items-center gap-1 whitespace-nowrap">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
                {l.label}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
              <span className="w-2.5 h-0.5 bg-[#ff9500]" /> {hasModelFrames && !hasNowcastFrames ? 'model forecast' : 'forecast'}
            </span>
          </div>
        )}

        {/* Forecast frames are not observed radar: say so, and credit Open-Meteo (CC BY 4.0) for the model frames. */}
        {hasForecastFrames && (
          <div className="flex items-center justify-between gap-2 px-1 pt-0.5 text-[11px] text-white/60">
            <span className={`truncate transition-colors ${isForecast ? 'text-[#ff9500]' : ''}`}>
              {/* "Orange:" explains the orange ticks; narrow screens drop it to fit (the note itself turns orange). */}
              <span className="max-[420px]:hidden">Orange: {forecastNote}</span>
              <span className="hidden max-[420px]:inline">
                {forecastNote.charAt(0).toUpperCase() + forecastNote.slice(1)}
              </span>
            </span>
            {hasModelFrames && (
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 whitespace-nowrap underline decoration-white/30 underline-offset-2 hover:text-white"
              >
                Open-Meteo · CC BY 4.0
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
