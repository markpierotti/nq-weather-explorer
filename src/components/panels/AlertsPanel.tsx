/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BellRing, CheckCircle2, MapPin, ShieldAlert } from 'lucide-react';
import { isWarningItem, useAppData } from '../../state/AppDataContext';
import { WeatherAlertBanner } from '../WeatherAlertBanner';

/** Placeholder for Phase 4 (web push notification settings). */
function PushNotificationsPlaceholder() {
  return (
    <div className="rounded-[20px] border border-dashed border-white/20 bg-white/[0.04] p-4 space-y-1.5">
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4 text-[#32ADE6]" />
        <span className="text-sm font-semibold text-white">Push notifications</span>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/60">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-white/60 leading-relaxed">
        Get a notification on this phone when a BOM warning, road closure or flood alert is issued for your saved
        locations.
      </p>
    </div>
  );
}

/** "Alerts" tab: every active warning in one list + (future) notification settings. */
export function AlertsPanel() {
  const {
    weatherBundle,
    multiModelBundle,
    emergencyBundle,
    emergencyDashboardEnabled,
    onToggleEmergencyDashboard,
    onFocusEmergencyItem,
  } = useAppData();

  const weatherAlerts = weatherBundle?.alerts ?? [];
  const bomWarnings = multiModelBundle?.bomWarnings ?? [];
  const emergencyWarnings = emergencyDashboardEnabled ? (emergencyBundle?.items ?? []).filter(isWarningItem) : [];
  const total = weatherAlerts.length + bomWarnings.length + emergencyWarnings.length;

  return (
    <div className="space-y-3">
      {total === 0 && (
        <div className="ios-bento-card p-5 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-[#34c759] mx-auto" />
          <div className="text-sm font-semibold text-white">No active warnings</div>
          <p className="text-xs text-white/60">Nothing current from BOM or the forecast feeds for this location.</p>
        </div>
      )}

      {weatherAlerts.length > 0 && <WeatherAlertBanner alerts={weatherAlerts} />}

      {bomWarnings.length > 0 && (
        <div className="rounded-[20px] border border-[#ff3b30]/40 bg-[#ff3b30]/15 backdrop-blur-xl p-4 space-y-1.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-rose-200">
            BOM Active Warnings ({bomWarnings.length})
          </div>
          {bomWarnings.map((w) => (
            <div key={w.id} className="text-xs text-white/90">
              {w.title}
            </div>
          ))}
        </div>
      )}

      {emergencyWarnings.length > 0 && (
        <div className="ios-bento-card p-4 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
            Emergency Feed Warnings ({emergencyWarnings.length})
          </div>
          {emergencyWarnings.map((item) => {
            const canFocus = item.lat !== null && item.lng !== null;
            return (
              <div key={item.id} className="flex items-start gap-2.5 border-t border-white/10 pt-2">
                <ShieldAlert className="w-4 h-4 text-[#ff3b30] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white leading-snug">{item.title}</div>
                  <div className="text-[11px] text-white/55">{item.sourceLabel}</div>
                </div>
                {canFocus && (
                  <button
                    type="button"
                    onClick={() => onFocusEmergencyItem(item)}
                    className="w-11 h-11 lg:w-8 lg:h-8 -my-1.5 rounded-lg bg-white/10 hover:bg-[#32ADE6]/25 text-white/75 hover:text-[#32ADE6] flex items-center justify-center shrink-0 cursor-pointer"
                    title="Show on map"
                    aria-label={`Show ${item.title} on map`}
                  >
                    <MapPin className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!emergencyDashboardEnabled && (
        <div className="ios-bento-card p-4 flex items-center gap-3">
          <p className="text-xs text-white/65 flex-1">
            Turn on the Emergency dashboard to include QLD flood, storm and cyclone warnings here.
          </p>
          <button
            type="button"
            onClick={onToggleEmergencyDashboard}
            className="min-h-11 lg:min-h-0 px-3 py-2 rounded-xl bg-[#ff9500] hover:bg-amber-500 text-white text-xs font-semibold shrink-0 cursor-pointer"
          >
            Turn ON
          </button>
        </div>
      )}

      {/* TODO(Phase 4): replace with real web-push subscription settings. */}
      <PushNotificationsPlaceholder />
    </div>
  );
}
