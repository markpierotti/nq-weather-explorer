/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Play, Pause, RotateCw, Eye, EyeOff, Sliders, Radio } from 'lucide-react';
import { RainViewerFrame } from '../types/weather';

interface RadarControlBarProps {
  frames: RainViewerFrame[];
  activeFrameIndex: number;
  onChangeFrameIndex: (idx: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  opacity: number;
  onChangeOpacity: (val: number) => void;
  visible: boolean;
  onToggleVisible: () => void;
  onRefresh: () => void;
  onJumpRegion: (region: 'CORRIDOR' | 'NQ') => void;
  isSidebarCollapsed?: boolean;
}

function formatBrisbaneTimestamp(unixSec?: number): string {
  if (!unixSec) return 'Syncing radar...';
  try {
    return (
      new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Brisbane',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(unixSec * 1000)) + ' AEST'
    );
  } catch {
    return new Date(unixSec * 1000).toISOString();
  }
}

export function RadarControlBar({
  frames,
  activeFrameIndex,
  onChangeFrameIndex,
  isPlaying,
  onTogglePlay,
  opacity,
  onChangeOpacity,
  visible,
  onToggleVisible,
  onRefresh,
  onJumpRegion,
  isSidebarCollapsed = true,
}: RadarControlBarProps) {
  const activeFrame = frames[activeFrameIndex] || null;
  const pastCount = frames.filter((f) => f.kind === 'past').length;

  return (
    <div
      className={`fixed bottom-5 z-20 pointer-events-none flex justify-center px-3 transition-all duration-300 ${
        isSidebarCollapsed
          ? 'left-0 w-full'
          : 'left-0 lg:left-[432px] w-full lg:w-[calc(100vw-432px)]'
      }`}
    >
      <div className="w-full max-w-[660px] pointer-events-auto">
        <div className="rounded-[28px] bg-[#141416]/85 border border-white/10 px-5 py-3 shadow-2xl shadow-black/60 backdrop-blur-2xl flex flex-col gap-2 text-white">
          {/* Primary Timeline Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[220px] flex items-center gap-3">
              <button
                type="button"
                onClick={onTogglePlay}
                disabled={frames.length === 0}
                className="w-9 h-9 rounded-full bg-[#32ADE6] hover:bg-[#4cbdf0] disabled:bg-white/15 text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                title={isPlaying ? 'Pause Radar Loop' : 'Play Radar Loop'}
                aria-label={isPlaying ? 'Pause Radar Loop' : 'Play Radar Loop'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>

              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  step={1}
                  value={Math.min(activeFrameIndex, Math.max(0, frames.length - 1))}
                  onChange={(e) => onChangeFrameIndex(Number.parseInt(e.target.value, 10))}
                  disabled={frames.length === 0}
                  className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-[#32ADE6]"
                  aria-label="Radar timeline scrubber"
                />
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-white/60">
                  <span className="truncate font-medium text-white">
                    {formatBrisbaneTimestamp(activeFrame?.time)}
                  </span>
                  <span className="shrink-0 ml-2 text-white/55">
                    {activeFrame ? (activeFrame.kind === 'nowcast' ? 'Nowcast' : 'Observed') : 'Syncing'} ·{' '}
                    {frames.length > 0 ? `${activeFrameIndex + 1}/${frames.length}` : '0/0'}
                    {pastCount > 0 && frames.length > pastCount ? ` (${frames.length - pastCount} fcst)` : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Opacity + Visibility + Refresh */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1.5 bg-white/[0.08] px-2.5 py-1.5 rounded-xl border border-white/10">
                <Sliders className="w-3.5 h-3.5 text-white/60" />
                <input
                  id="radar-opacity-slider"
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => onChangeOpacity(parseFloat(e.target.value))}
                  className="w-14 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#32ADE6]"
                  title="Radar Opacity"
                />
                <span className="text-[10px] font-mono tabular-nums text-white/80 w-7 text-right">
                  {Math.round(opacity * 100)}%
                </span>
              </div>

              <button
                id="btn-radar-refresh"
                type="button"
                onClick={onRefresh}
                className="p-2 rounded-xl bg-white/[0.08] border border-white/10 text-white/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
                title="Refresh Radar & Feeds"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              <button
                id="btn-radar-toggle-visibility"
                type="button"
                onClick={onToggleVisible}
                className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                  visible
                    ? 'bg-[#32ADE6]/20 border-[#32ADE6]/40 text-[#32ADE6]'
                    : 'bg-white/[0.08] border-white/10 text-white/40 hover:text-white/80'
                }`}
                title={visible ? 'Hide Radar Overlay' : 'Show Radar Overlay'}
              >
                {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Legend & NQ Focus Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-white/65 font-medium flex items-center gap-1">
                <Radio className="w-3 h-3 text-[#32ADE6]" />
                Rain
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/45">Light</span>
                <div className="flex h-2 rounded-sm overflow-hidden border border-white/15">
                  <div className="w-4 bg-[#88ddee]" title="Drizzle" />
                  <div className="w-4 bg-[#00cc66]" title="Light Rain" />
                  <div className="w-4 bg-[#ffff00]" title="Moderate" />
                  <div className="w-4 bg-[#ff7e00]" title="Heavy" />
                  <div className="w-4 bg-[#ff0000]" title="Intense" />
                  <div className="w-4 bg-[#b30077]" title="Severe / Hail" />
                </div>
                <span className="text-[10px] text-white/45">Severe</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => onJumpRegion('CORRIDOR')}
                className="px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/15 text-white/85 font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                Ayr ↔ Townsville
              </button>
              <button
                type="button"
                onClick={() => onJumpRegion('NQ')}
                className="px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/15 text-white/85 font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                North QLD
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
