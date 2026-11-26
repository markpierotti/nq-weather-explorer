/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { WeatherAlert } from '../types/weather';

interface WeatherAlertBannerProps {
  alerts: WeatherAlert[];
}

export function WeatherAlertBanner({ alerts }: WeatherAlertBannerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {alerts.map((alert, idx) => {
        const isExpanded = expandedId === (alert.alertId || `alert-${idx}`);
        const severity = alert.severity || 'MODERATE';
        const isSevere = severity === 'EXTREME' || severity === 'SEVERE';

        return (
          <div
            key={alert.alertId || idx}
            className={`rounded-[20px] border p-3.5 transition-colors backdrop-blur-xl ${
              isSevere
                ? 'bg-[#ff3b30]/15 border-[#ff3b30]/40 text-white'
                : 'bg-[#ff9500]/15 border-[#ff9500]/40 text-white'
            }`}
          >
            <div
              className="flex items-start justify-between gap-2 cursor-pointer select-none"
              onClick={() => setExpandedId(isExpanded ? null : (alert.alertId || `alert-${idx}`))}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ShieldAlert className={`w-4 h-4 shrink-0 ${isSevere ? 'text-[#ff3b30]' : 'text-[#ff9500]'}`} />
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide shrink-0 ${
                      isSevere ? 'bg-[#ff3b30] text-white' : 'bg-[#ff9500] text-white'
                    }`}
                  >
                    {severity}
                  </span>
                  <span className="text-xs font-semibold truncate text-white">
                    {alert.headline || alert.eventDescription || 'Weather Advisory'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="text-white/60 hover:text-white p-0.5 shrink-0 cursor-pointer"
                aria-label="Toggle alert details"
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {isExpanded && (
              <div className="mt-2.5 pt-2.5 border-t border-white/15 text-xs text-white/80 flex flex-col gap-1.5">
                <p className="leading-relaxed whitespace-pre-wrap font-sans">
                  {alert.description || 'Active advisory for this region.'}
                </p>
                {alert.areas && alert.areas.length > 0 && (
                  <div className="text-[11px] text-white/65">
                    <span className="font-semibold text-white">Affecting:</span> {alert.areas.join(', ')}
                  </div>
                )}
                {alert.senderName && (
                  <div className="text-[10px] text-white/60 font-mono">
                    Issued by {alert.senderName}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
