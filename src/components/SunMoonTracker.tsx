/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sun, Moon, Sunrise, Sunset } from 'lucide-react';
import { CurrentWeather } from '../types/weather';

interface SunMoonTrackerProps {
  current: CurrentWeather;
}

export function SunMoonTracker({ current }: SunMoonTrackerProps) {
  const sunAndMoon = current.sunAndMoon;
  const sunrise = sunAndMoon?.sunrise || '05:35 AM';
  const sunset = sunAndMoon?.sunset || '06:25 PM';
  const moonPhase = sunAndMoon?.moonPhase || 'Waxing Gibbous';

  return (
    <div className="grid grid-cols-2 gap-3 tabular-nums">
      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
          <span className="flex items-center gap-1.5">
            <Sun className="w-3.5 h-3.5 text-[#ff9500]" /> Solar
          </span>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <Sunrise className="w-4 h-4 text-[#ff9500]" />
            <div>
              <div className="text-[10px] text-white/45">Rise</div>
              <div className="font-semibold text-white">{sunrise}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Sunset className="w-4 h-4 text-orange-400" />
            <div>
              <div className="text-[10px] text-white/45">Set</div>
              <div className="font-semibold text-white">{sunset}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="ios-bento-card p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
          <span className="flex items-center gap-1.5">
            <Moon className="w-3.5 h-3.5 text-indigo-400" /> Lunar
          </span>
        </div>

        <div className="flex items-center gap-2.5 mt-3">
          <div className="w-8 h-8 rounded-full bg-[#5856d6]/25 border border-[#5856d6]/40 flex items-center justify-center text-indigo-300 shrink-0">
            <Moon className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">{moonPhase}</div>
            <div className="text-[10px] text-white/45">Illumination ~78%</div>
          </div>
        </div>
      </div>
    </div>
  );
}
