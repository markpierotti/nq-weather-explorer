/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Plus,
  ShieldAlert,
  Sun,
  Wind,
} from 'lucide-react';
import { PRESET_LOCATIONS } from '../utils/mockWeatherData';
import { SidebarTab, useAppData, useTabBadges } from '../state/AppDataContext';
import { useCurrentConditions } from '../hooks/useCurrentConditions';
import { PlaceAutocompleteNew } from './PlaceAutocompleteNew';
import { SummaryWidgets } from './SummaryWidgets';
import { AddLocationForm, LocationChips, LocationSearchRow } from './panels/LocationBar';
import { CurrentHero } from './panels/CurrentSummary';
import { ModeToggles } from './panels/ModeToggles';
import { ActivePanel, AttributionFooter } from './panels/ActivePanel';

export type { SidebarTab } from '../state/AppDataContext';

/** Floating dock shown on desktop while the sidebar is collapsed. */
function CollapsedDock({ onOpenAddLocation }: { onOpenAddLocation: () => void }) {
  const {
    selectedLocation,
    onSelectLocation,
    onToggleSidebar,
    emergencyDashboardEnabled,
    onToggleEmergencyDashboard,
    cycloneMode,
    onToggleCycloneMode,
    threatDetection,
  } = useAppData();
  const { displayTemp, conditionText, isMetric } = useCurrentConditions();
  const badges = useTabBadges();
  const [isSearchActive, setIsSearchActive] = useState(false);

  return (
    <div className="fixed top-4 left-4 z-40 flex flex-wrap items-center gap-2 max-w-[calc(100vw-120px)]">
      <button
        id="btn-sidebar-toggle-min"
        type="button"
        onClick={onToggleSidebar}
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[#141416]/85 border border-white/10 shadow-2xl backdrop-blur-xl text-white hover:bg-[#1d334a]/90 transition-colors cursor-pointer shrink-0"
        title="Open Weather Explorer Panel"
      >
        <div className="w-7 h-7 rounded-xl bg-[#32ADE6]/20 border border-[#32ADE6]/40 flex items-center justify-center text-[#32ADE6]">
          <CloudRain className="w-4 h-4" />
        </div>
        <div className="text-left">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5 tabular-nums">
            <span className="max-w-[120px] truncate">{selectedLocation.name}</span>
            {displayTemp !== undefined && (
              <span className="text-[#32ADE6] font-bold">
                {displayTemp}°{isMetric ? 'C' : 'F'}
              </span>
            )}
          </div>
          <div className="text-[10px] text-white/55 truncate max-w-[160px]">{conditionText}</div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/50 ml-0.5" />
      </button>

      {!isSearchActive && (
        <div className="flex items-center gap-1 bg-[#141416]/85 border border-white/10 rounded-2xl p-1 shadow-2xl backdrop-blur-xl">
          {PRESET_LOCATIONS.slice(0, 2).map((loc) => {
            const active = loc.id === selectedLocation.id;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => onSelectLocation(loc)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active ? 'bg-[#32ADE6] text-[#111113]' : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                {loc.name}
              </button>
            );
          })}
          <button
            id="btn-emergency-toggle-min"
            type="button"
            role="switch"
            aria-checked={emergencyDashboardEnabled}
            onClick={onToggleEmergencyDashboard}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer border transition-colors tabular-nums ${
              emergencyDashboardEnabled
                ? 'text-[#ff9500] bg-[#ff9500]/15 border-[#ff9500]/35 hover:bg-[#ff9500]/25'
                : 'text-white/55 bg-white/[0.06] border-white/10 hover:text-white'
            }`}
            title={emergencyDashboardEnabled ? 'Turn Emergency Dashboard OFF' : 'Turn Emergency Dashboard ON'}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{emergencyDashboardEnabled ? `Emergency (${badges.emergency})` : 'Emergency OFF'}</span>
          </button>
          <button
            type="button"
            onClick={onToggleCycloneMode}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer border transition-colors ${
              cycloneMode
                ? 'bg-[#ff3b30] border-[#ff3b30] text-white'
                : threatDetection.isThreatDetected
                ? 'bg-[#ff3b30]/20 border-[#ff3b30]/50 text-rose-200 animate-pulse'
                : 'bg-white/[0.06] border-white/10 text-white/75 hover:bg-white/10 hover:text-white'
            }`}
            title="Toggle Cyclone Mode: WeatherNext 3"
          >
            <Wind className="w-3.5 h-3.5" />
            <span>{cycloneMode ? 'Cyclone ON' : 'Cyclone'}</span>
          </button>
          <button
            id="btn-add-location-min"
            type="button"
            onClick={onOpenAddLocation}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer border border-[#32ADE6]/35 bg-[#32ADE6]/15 text-[#32ADE6] hover:bg-[#32ADE6]/25 transition-colors"
            title="Add and save a new location"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>
      )}

      {threatDetection.isThreatDetected && !cycloneMode && !isSearchActive && (
        <button
          type="button"
          onClick={() => {
            onToggleCycloneMode();
            onToggleSidebar();
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#ff3b30] text-white text-xs font-semibold shadow-2xl animate-pulse cursor-pointer hover:bg-rose-500"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Warning Active — Enable WN3</span>
        </button>
      )}

      <div className={`transition-[width] duration-200 shadow-2xl rounded-xl min-w-0 ${isSearchActive ? 'w-80' : 'w-64'}`}>
        <PlaceAutocompleteNew
          onSelectLocation={(loc) => {
            onSelectLocation(loc);
            setIsSearchActive(false);
          }}
          onFocusChange={setIsSearchActive}
          alignDropdown="right"
          placeholder="Search for a city or place…"
        />
      </div>
    </div>
  );
}

/** Segmented tab control for the desktop sidebar. */
function SidebarTabs() {
  const { activeTab, onChangeTab, cycloneMode, emergencyDashboardEnabled } = useAppData();
  const badges = useTabBadges();
  const tabs: Array<{ id: SidebarTab; label: string; icon: ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Sun className="w-3.5 h-3.5 text-[#ff9500]" /> },
    {
      id: 'models',
      label: cycloneMode ? '5-Model' : '4-Model',
      icon: <BarChart3 className={`w-3.5 h-3.5 ${cycloneMode ? 'text-[#ff3b30]' : 'text-[#32ADE6]'}`} />,
    },
    {
      id: 'emergency',
      label: emergencyDashboardEnabled ? `Emerg. (${badges.emergency})` : 'Emerg.',
      icon: <ShieldAlert className={`w-3.5 h-3.5 ${emergencyDashboardEnabled ? 'text-[#ff9500]' : 'text-white/40'}`} />,
    },
    {
      id: 'alerts',
      label: badges.alerts > 0 ? `Alerts (${badges.alerts})` : 'Alerts',
      icon: <Bell className={`w-3.5 h-3.5 ${badges.alerts > 0 ? 'text-[#ff3b30]' : 'text-white/40'}`} />,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-1 bg-white/[0.08] p-1 rounded-xl border border-white/10">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChangeTab(tab.id)}
          className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
            activeTab === tab.id ? 'bg-white/15 text-white shadow-xs' : 'text-white/60 hover:text-white'
          }`}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Desktop (>= 1024px) left sidebar shell. */
export function WeatherSidebar() {
  const { isSidebarCollapsed, onToggleSidebar, weatherBundle, unitSystem, isLoadingWeather } = useAppData();
  const [isAddOpen, setIsAddOpen] = useState(false);

  return (
    <>
      {isSidebarCollapsed && (
        <CollapsedDock
          onOpenAddLocation={() => {
            setIsAddOpen(true);
            onToggleSidebar();
          }}
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 z-30 w-[432px] ios-sidebar-surface border-r border-white/10 shadow-2xl backdrop-blur-2xl flex flex-col transition-transform duration-300 ease-out text-white ${
          isSidebarCollapsed ? '-translate-x-full' : 'translate-x-0'
        }`}
        aria-hidden={isSidebarCollapsed}
      >
        <header className="px-4 py-3 sticky top-0 bg-[#1d334a]/80 backdrop-blur-md border-b border-white/10 z-20">
          <LocationSearchRow
            isAddOpen={isAddOpen}
            onToggleAdd={() => setIsAddOpen((v) => !v)}
            trailing={
              <button
                id="btn-sidebar-toggle"
                type="button"
                onClick={onToggleSidebar}
                className="h-9 w-9 rounded-[10px] bg-white/10 hover:bg-white/15 text-white/80 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                aria-label="Minimize panel"
                title="Minimize Panel"
              >
                <ChevronLeft aria-hidden="true" className="w-4 h-4" />
              </button>
            }
          />
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {isAddOpen && (
            <div className="mx-4 mt-3">
              <AddLocationForm onClose={() => setIsAddOpen(false)} />
            </div>
          )}

          <div className="px-4 pt-3">
            <LocationChips />
          </div>

          <CurrentHero />

          <div className="px-4 mb-3">
            <SummaryWidgets weatherBundle={weatherBundle} unitSystem={unitSystem} isLoading={isLoadingWeather} />
          </div>

          <div className="px-4 space-y-2.5 mb-3">
            <ModeToggles />
            <SidebarTabs />
          </div>

          <div className="px-4 pb-6 space-y-3">
            <ActivePanel />
            <AttributionFooter />
          </div>
        </div>
      </aside>
    </>
  );
}
