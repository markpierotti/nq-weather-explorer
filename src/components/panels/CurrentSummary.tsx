/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BookmarkPlus, CloudRain, MapPin, RefreshCw } from 'lucide-react';
import { useAppData } from '../../state/AppDataContext';
import { useCurrentConditions } from '../../hooks/useCurrentConditions';
import { useIsSelectedSaved } from './LocationBar';

function formatCoords(lat: number, lng: number) {
  const latStr = lat >= 0 ? `${lat.toFixed(3)}°N` : `${Math.abs(lat).toFixed(3)}°S`;
  const lngStr = lng >= 0 ? `${lng.toFixed(3)}°E` : `${Math.abs(lng).toFixed(3)}°W`;
  return `${latStr}, ${lngStr}`;
}

/** Large centred iOS-weather hero used in the desktop sidebar. */
export function CurrentHero() {
  const { selectedLocation, onAddLocation, onRefreshAll } = useAppData();
  const { displayTemp, conditionText, todayRow, fmtRangeTemp, isAnyLoading } = useCurrentConditions();
  const isSaved = useIsSelectedSaved();

  return (
    <section className="px-6 pt-7 pb-5 text-center relative">
      <div className="flex items-center justify-center gap-2">
        <h1 className="text-[2.1rem] font-normal tracking-tight text-white truncate max-w-[290px]">
          {selectedLocation.name}
        </h1>
        {!isSaved && (
          <button
            type="button"
            onClick={() => onAddLocation(selectedLocation)}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-[#32ADE6]/30 text-[#32ADE6] transition-colors cursor-pointer shrink-0"
            title="Save this location"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onRefreshAll}
          disabled={isAnyLoading}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/65 hover:text-white transition-colors cursor-pointer shrink-0"
          title="Refresh all weather & radar feeds"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isAnyLoading ? 'animate-spin text-[#32ADE6]' : ''}`} />
        </button>
      </div>

      <div className="text-[5.5rem] font-extralight leading-none tracking-[-0.05em] tabular-nums text-white mt-1 mb-2">
        {displayTemp !== undefined ? `${displayTemp}°` : '--°'}
      </div>

      <div className="text-lg text-white/70 font-medium">{conditionText}</div>

      <div className="text-sm font-medium text-white/90 mt-1 tabular-nums">
        {todayRow ? (
          <>
            <span>H:{fmtRangeTemp(todayRow.meanMaxTemp)}</span>
            <span className="mx-2 text-white/40">·</span>
            <span>L:{fmtRangeTemp(todayRow.meanMinTemp)}</span>
          </>
        ) : (
          <span>Australia/Brisbane</span>
        )}
      </div>

      <div className="text-[11px] font-mono tabular-nums text-white/45 mt-1 flex items-center justify-center gap-1.5">
        <MapPin className="w-3 h-3 text-[#32ADE6]" />
        <span>{formatCoords(selectedLocation.lat, selectedLocation.lng)}</span>
      </div>
    </section>
  );
}

/** Compact summary shown in the mobile sheet header (visible at the peek snap point). */
export function CurrentPeek() {
  const { selectedLocation, onAddLocation, onRefreshAll } = useAppData();
  const { displayTemp, conditionText, todayRow, rainChance, fmtRangeTemp, fmtRainShort, isAnyLoading } =
    useCurrentConditions();
  const isSaved = useIsSelectedSaved();

  return (
    <div className="flex items-center gap-3 px-4 pb-3 select-none">
      <div className="text-[2.75rem] font-extralight leading-none tracking-[-0.04em] tabular-nums text-white shrink-0">
        {displayTemp !== undefined ? `${displayTemp}°` : '--°'}
      </div>

      <div className="flex-1 min-w-0">
        <h1 className="text-[17px] font-semibold text-white truncate leading-tight">{selectedLocation.name}</h1>
        <div className="text-[13px] text-white/70 truncate leading-snug">{conditionText}</div>
        <div className="text-xs text-white/60 tabular-nums flex items-center gap-2 mt-0.5 whitespace-nowrap overflow-hidden">
          {todayRow && (
            <span>
              H:{fmtRangeTemp(todayRow.meanMaxTemp)} L:{fmtRangeTemp(todayRow.meanMinTemp)}
            </span>
          )}
          {(rainChance !== null || todayRow?.meanRainMm != null) && (
            <span className="flex items-center gap-1 text-[#32ADE6]">
              <CloudRain className="w-3 h-3" />
              {rainChance !== null ? `${Math.round(rainChance)}%` : fmtRainShort(todayRow?.meanRainMm)}
            </span>
          )}
        </div>
      </div>

      {!isSaved && (
        <button
          type="button"
          onClick={() => onAddLocation(selectedLocation)}
          className="w-11 h-11 rounded-full bg-white/10 active:bg-[#32ADE6]/30 text-[#32ADE6] flex items-center justify-center shrink-0 cursor-pointer"
          title="Save this location"
          aria-label="Save this location"
        >
          <BookmarkPlus className="w-5 h-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRefreshAll}
        disabled={isAnyLoading}
        className="w-11 h-11 rounded-full bg-white/10 active:bg-white/20 text-white/75 flex items-center justify-center shrink-0 cursor-pointer"
        title="Refresh all weather & radar feeds"
        aria-label="Refresh all weather and radar feeds"
      >
        <RefreshCw className={`w-4.5 h-4.5 ${isAnyLoading ? 'animate-spin text-[#32ADE6]' : ''}`} />
      </button>
    </div>
  );
}
