/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ShieldAlert, Wind } from 'lucide-react';
import { useAppData } from '../../state/AppDataContext';

interface SwitchProps {
  id: string;
  checked: boolean;
  onToggle: () => void;
  activeClass: string;
  title: string;
}

/** iOS-style switch. The visual pill is small; the tap target is the whole row on mobile. */
export function IosSwitch({ id, checked, onToggle, activeClass, title }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 lg:h-5 lg:w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        checked ? activeClass : 'bg-white/20 hover:bg-white/30'
      }`}
      title={title}
    >
      <span
        className={`inline-block h-5 w-5 lg:h-3.5 lg:w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5.5 lg:translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** Cyclone-mode / tropical-low banner plus the Emergency + Cyclone mode switches. */
export function ModeToggles() {
  const {
    cycloneMode,
    onToggleCycloneMode,
    threatDetection,
    emergencyDashboardEnabled,
    onToggleEmergencyDashboard,
  } = useAppData();

  const rowClass =
    'flex items-center justify-between gap-2 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 min-h-12 lg:min-h-0 cursor-pointer lg:cursor-default';

  return (
    <div className="space-y-2.5">
      {cycloneMode ? (
        <div className="bg-[#ff3b30] text-white px-4 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold shadow-lg shadow-[#ff3b30]/20">
          <span className="flex items-center gap-1.5">
            <Wind className="w-3.5 h-3.5" />
            <span>Cyclone Mode: WN3 Active</span>
          </span>
          <button
            type="button"
            onClick={onToggleCycloneMode}
            className="text-[11px] bg-black/20 hover:bg-black/30 px-3 lg:px-2 min-h-9 lg:min-h-0 lg:py-0.5 rounded-md cursor-pointer"
          >
            Turn OFF
          </button>
        </div>
      ) : threatDetection.isThreatDetected ? (
        <div className="bg-[#ff3b30] text-white px-4 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold animate-pulse">
          <div className="min-w-0">
            <div className="truncate">Tropical Low / Flood Warning</div>
            <div className="text-[10px] text-white/80 font-normal truncate">{threatDetection.reasons[0]}</div>
          </div>
          <button
            type="button"
            onClick={onToggleCycloneMode}
            className="px-3 lg:px-2.5 min-h-9 lg:min-h-0 lg:py-1 rounded-lg bg-white text-[#ff3b30] text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
          >
            Turn ON
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {/* Whole row is tappable on mobile (label click toggles), switch stays the a11y control. */}
        <div className={rowClass} onClick={(e) => e.target === e.currentTarget && onToggleEmergencyDashboard()}>
          <span className="text-xs lg:text-[11px] font-medium text-white/80 truncate flex items-center gap-1.5 pointer-events-none">
            <ShieldAlert
              className={`w-3.5 h-3.5 shrink-0 ${emergencyDashboardEnabled ? 'text-[#ff9500]' : 'text-white/40'}`}
            />
            <span>Emergency</span>
          </span>
          <IosSwitch
            id="btn-emergency-dashboard-toggle"
            checked={emergencyDashboardEnabled}
            onToggle={onToggleEmergencyDashboard}
            activeClass="bg-[#ff9500]"
            title={emergencyDashboardEnabled ? 'Turn Emergency Dashboard OFF' : 'Turn Emergency Dashboard ON'}
          />
        </div>

        <div className={rowClass} onClick={(e) => e.target === e.currentTarget && onToggleCycloneMode()}>
          <span className="text-xs lg:text-[11px] font-medium text-white/80 truncate flex items-center gap-1.5 pointer-events-none">
            <Wind className={`w-3.5 h-3.5 shrink-0 ${cycloneMode ? 'text-[#ff3b30]' : 'text-white/45'}`} />
            <span>Cyclone WN3</span>
          </span>
          <IosSwitch
            id="btn-cyclone-threat-toggle"
            checked={cycloneMode}
            onToggle={onToggleCycloneMode}
            activeClass="bg-[#ff3b30]"
            title="Toggle Cyclone Mode: WeatherNext 3"
          />
        </div>
      </div>
    </div>
  );
}
