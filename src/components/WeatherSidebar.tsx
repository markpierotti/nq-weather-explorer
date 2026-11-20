/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type FormEvent } from 'react';
import {
  MapPin,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sun,
  CloudRain,
  ShieldAlert,
  BarChart3,
  Wind,
  AlertTriangle,
  Plus,
  X,
  BookmarkPlus,
} from 'lucide-react';
import {
  CycloneThreatDetection,
  EmergencyBundle,
  EmergencyFeatureItem,
  EmergencyLayerToggles,
  GeminiCycloneSynthesis,
  LocationWeatherBundle,
  MultiModelBundle,
  WeatherLocation,
  WeatherNext3Bundle,
  WeatherUnitSystem,
} from '../types/weather';
import { PRESET_LOCATIONS } from '../utils/mockWeatherData';
import { PlaceAutocompleteNew } from './PlaceAutocompleteNew';
import { AtmosphericMetricsGrid } from './AtmosphericMetricsGrid';
import { HourlyForecastTimeline } from './HourlyForecastTimeline';
import { SunMoonTracker } from './SunMoonTracker';
import { WeatherAlertBanner } from './WeatherAlertBanner';
import { MultiModelComparison } from './MultiModelComparison';
import { CorridorBriefingCard } from './CorridorBriefingCard';
import { EmergencyDrawer } from './EmergencyDrawer';
import { CycloneThreatPanel } from './CycloneThreatPanel';
import { SummaryWidgets } from './SummaryWidgets';

export type SidebarTab = 'overview' | 'models' | 'emergency';

interface WeatherSidebarProps {
  selectedLocation: WeatherLocation;
  savedLocations: WeatherLocation[];
  onAddLocation: (loc: WeatherLocation) => void;
  onRemoveSavedLocation: (id: string) => void;
  weatherBundle: LocationWeatherBundle | null;
  multiModelBundle: MultiModelBundle | null;
  emergencyBundle: EmergencyBundle | null;
  isLoadingWeather: boolean;
  isLoadingModels: boolean;
  isLoadingEmergency: boolean;
  unitSystem: WeatherUnitSystem;
  onToggleUnitSystem: () => void;
  onSelectLocation: (loc: WeatherLocation) => void;
  onRefreshAll: () => void;
  onRefreshEmergency: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  emergencyDashboardEnabled: boolean;
  onToggleEmergencyDashboard: () => void;
  emergencyLayers: EmergencyLayerToggles;
  onToggleEmergencyLayer: (key: keyof EmergencyLayerToggles) => void;
  emergencyProxyUrl: string;
  onChangeEmergencyProxyUrl: (url: string) => void;
  onFocusEmergencyItem: (item: EmergencyFeatureItem) => void;
  cycloneMode: boolean;
  onToggleCycloneMode: () => void;
  threatDetection: CycloneThreatDetection;
  wn3ApiKey: string;
  onSaveWn3ApiKey: (key: string) => void;
  wn3Bundle: WeatherNext3Bundle | null;
  cycloneSynthesis: GeminiCycloneSynthesis | null;
  isLoadingCyclone: boolean;
  cycloneError: string | null;
  onRefreshCyclone: (forceNetwork?: boolean) => void;
  onFallbackCycloneToGemini: () => void;
}

export function WeatherSidebar({
  selectedLocation,
  savedLocations,
  onAddLocation,
  onRemoveSavedLocation,
  weatherBundle,
  multiModelBundle,
  emergencyBundle,
  isLoadingWeather,
  isLoadingModels,
  isLoadingEmergency,
  unitSystem,
  onToggleUnitSystem,
  onSelectLocation,
  onRefreshAll,
  onRefreshEmergency,
  isCollapsed,
  onToggleCollapse,
  activeTab,
  onChangeTab,
  emergencyDashboardEnabled,
  onToggleEmergencyDashboard,
  emergencyLayers,
  onToggleEmergencyLayer,
  emergencyProxyUrl,
  onChangeEmergencyProxyUrl,
  onFocusEmergencyItem,
  cycloneMode,
  onToggleCycloneMode,
  threatDetection,
  wn3ApiKey,
  onSaveWn3ApiKey,
  wn3Bundle,
  cycloneSynthesis,
  isLoadingCyclone,
  cycloneError,
  onRefreshCyclone,
  onFallbackCycloneToGemini,
}: WeatherSidebarProps) {
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customLat, setCustomLat] = useState('');
  const [customLng, setCustomLng] = useState('');
  const [addLocationError, setAddLocationError] = useState<string | null>(null);

  const allPresetAndSaved = [...PRESET_LOCATIONS, ...savedLocations];
  const isCurrentSavedOrPreset = allPresetAndSaved.some(
    (loc) =>
      loc.id === selectedLocation.id ||
      (Math.abs(loc.lat - selectedLocation.lat) < 0.002 &&
        Math.abs(loc.lng - selectedLocation.lng) < 0.002)
  );

  const handleCustomLocationSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = customName.trim();
    const lat = parseFloat(customLat);
    const lng = parseFloat(customLng);

    if (!trimmedName) {
      setAddLocationError('Enter a location name.');
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setAddLocationError('Latitude must be between -90 and 90.');
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setAddLocationError('Longitude must be between -180 and 180.');
      return;
    }

    onAddLocation({
      id: `saved-${Date.now()}`,
      name: trimmedName,
      searchQuery: trimmedName,
      region: 'Saved Location',
      country: '',
      lat,
      lng,
      timezone: 'Australia/Brisbane',
    });

    setCustomName('');
    setCustomLat('');
    setCustomLng('');
    setAddLocationError(null);
    setIsAddLocationOpen(false);
  };

  const isMetric = unitSystem === 'METRIC';
  const hasCurrentWeather = !!weatherBundle?.current && !weatherBundle?.isUnsupportedLocation;
  const hasExtendedGoogleBundle = hasCurrentWeather && (weatherBundle?.daily?.length ?? 0) > 0;
  const current = weatherBundle?.current;

  const first3h = multiModelBundle?.hourly3h?.[0];
  const todayRow = multiModelBundle?.daily7d?.[0];

  const rawTempVal = hasCurrentWeather
    ? current?.temperature?.degrees
    : first3h?.weatherNext2.temp ?? first3h?.ecmwf.temp ?? first3h?.gfs.temp;

  const tempUnit = hasCurrentWeather ? current?.temperature?.unit : 'CELSIUS';

  const displayTemp =
    rawTempVal !== null && rawTempVal !== undefined
      ? tempUnit === 'FAHRENHEIT'
        ? Math.round(isMetric ? ((rawTempVal - 32) * 5) / 9 : rawTempVal)
        : tempUnit === 'CELSIUS' || !hasCurrentWeather
        ? Math.round(isMetric ? rawTempVal : (rawTempVal * 9) / 5 + 32)
        : Math.round(rawTempVal)
      : undefined;

  const conditionText = hasCurrentWeather
    ? current?.weatherCondition?.description?.text || 'Clear'
    : todayRow?.bom?.shortText ||
      (first3h?.weatherNext2.precipMm && first3h.weatherNext2.precipMm > 0.5
        ? 'Showers Projected'
        : 'Multi-Model Live');

  const fmtRangeTemp = (c: number | null | undefined) => {
    if (c === null || c === undefined || !Number.isFinite(c)) return '—';
    return `${Math.round(isMetric ? c : (c * 9) / 5 + 32)}°`;
  };

  const fmtRainShort = (mm: number | null | undefined) => {
    if (mm === null || mm === undefined || !Number.isFinite(mm)) return '—';
    return isMetric ? `${mm < 10 ? Number(mm.toFixed(1)) : Math.round(mm)}mm` : `${(mm / 25.4).toFixed(2)}in`;
  };

  const emergencyCount = emergencyBundle?.items.length ?? 0;
  const corridorItems = emergencyBundle?.items.filter((i) => i.isCorridorPriority) ?? [];
  const corridorCount = corridorItems.length;
  const topEmergency = corridorItems[0] || emergencyBundle?.items[0] || null;
  const isAnyLoading = isLoadingWeather || isLoadingModels;

  const spreadColorClass =
    multiModelBundle?.spreadOverview.agreementLabel === 'High Agreement'
      ? 'text-[#34c759]'
      : multiModelBundle?.spreadOverview.agreementLabel === 'Moderate Spread'
      ? 'text-[#ff9500]'
      : 'text-[#ff9500]';

  const todayWn3 =
    cycloneMode && wn3Bundle && todayRow
      ? wn3Bundle.daily10d.find((d) => d.dateKey === todayRow.dateKey) || wn3Bundle.daily10d[0]
      : null;

  return (
    <>
      {/* Collapsed Top Floating Dock */}
      {isCollapsed && (
        <div className="fixed top-4 left-4 right-16 sm:right-auto z-40 flex flex-wrap items-center gap-2 max-w-[calc(100vw-80px)]">
          <button
            id="btn-sidebar-toggle-min"
            type="button"
            onClick={onToggleCollapse}
            className={`items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[#141416]/85 border border-white/10 shadow-2xl backdrop-blur-xl text-white hover:bg-[#1d334a]/90 transition-colors cursor-pointer shrink-0 ${
              isSearchActive ? 'hidden sm:flex' : 'flex'
            }`}
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
            <div className="hidden md:flex items-center gap-1 bg-[#141416]/85 border border-white/10 rounded-2xl p-1 shadow-2xl backdrop-blur-xl">
              {PRESET_LOCATIONS.slice(0, 2).map((loc) => {
                const active = loc.id === selectedLocation.id;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => onSelectLocation(loc)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      active ? 'bg-[#32ADE6] text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
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
                <span>{emergencyDashboardEnabled ? `Alerts (${emergencyCount})` : 'Alerts OFF'}</span>
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
                onClick={() => {
                  setIsAddLocationOpen(true);
                  onToggleCollapse();
                }}
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
                onToggleCollapse();
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#ff3b30] text-white text-xs font-semibold shadow-2xl animate-pulse cursor-pointer hover:bg-rose-500"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Warning Active — Enable WN3</span>
            </button>
          )}

          <div
            className={`transition-all duration-200 shadow-2xl rounded-xl min-w-0 ${
              isSearchActive ? 'flex-1 min-w-0 w-full sm:w-80' : 'w-44 sm:w-64'
            }`}
          >
            <PlaceAutocompleteNew
              onSelectLocation={(loc) => {
                onSelectLocation(loc);
                setIsSearchActive(false);
              }}
              onFocusChange={setIsSearchActive}
              alignDropdown="right"
              placeholder="Search for a city or place..."
            />
          </div>
        </div>
      )}

      {/* Primary iOS Dark Glass Sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-30 w-full sm:w-[432px] ios-sidebar-surface border-r border-white/10 shadow-2xl backdrop-blur-2xl flex flex-col transition-transform duration-300 ease-out text-white ${
          isCollapsed ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        {/* Sticky Top Bar */}
        <header className="px-4 py-3 flex items-center gap-2 sticky top-0 bg-[#1d334a]/80 backdrop-blur-md border-b border-white/10 z-20">
          <div className="flex-1 min-w-0">
            <PlaceAutocompleteNew
              onSelectLocation={onSelectLocation}
              placeholder="Search for a city or airport"
            />
          </div>

          <button
            id="btn-add-location"
            type="button"
            onClick={() => {
              setIsAddLocationOpen((prev) => !prev);
              setAddLocationError(null);
            }}
            className={`h-9 px-2.5 rounded-[10px] text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              isAddLocationOpen
                ? 'bg-[#32ADE6] text-white'
                : 'bg-white/10 hover:bg-white/15 text-white'
            }`}
            title="Add & save a location"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>

          <button
            id="btn-toggle-unit"
            type="button"
            onClick={onToggleUnitSystem}
            className="h-9 px-3 rounded-[10px] bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
            title="Toggle Celsius / Fahrenheit"
          >
            °{isMetric ? 'C' : 'F'}
          </button>

          <button
            id="btn-sidebar-toggle"
            type="button"
            onClick={onToggleCollapse}
            className="h-9 w-9 rounded-[10px] bg-white/10 hover:bg-white/15 text-white/80 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="Minimize Panel"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Expandable Add Location Form */}
          {isAddLocationOpen && (
            <div className="mx-4 mt-3 rounded-[20px] border border-[#32ADE6]/35 bg-[#141416]/75 backdrop-blur-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  Add Location to Quick List
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddLocationOpen(false);
                    setAddLocationError(null);
                  }}
                  className="p-0.5 rounded text-white/50 hover:text-white cursor-pointer"
                  aria-label="Close Add Location form"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-1">
                  Search a town or place
                </div>
                <PlaceAutocompleteNew
                  onSelectLocation={(loc) => {
                    onAddLocation(loc);
                    setIsAddLocationOpen(false);
                  }}
                  placeholder="Type place name (e.g. Home Hill, Giru, Bowen)..."
                />
              </div>

              {!isCurrentSavedOrPreset && (
                <button
                  type="button"
                  onClick={() => {
                    onAddLocation(selectedLocation);
                    setIsAddLocationOpen(false);
                  }}
                  className="w-full py-1.5 px-2.5 rounded-xl bg-[#32ADE6]/20 hover:bg-[#32ADE6]/30 border border-[#32ADE6]/40 text-[#32ADE6] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span className="truncate">Save active: {selectedLocation.name}</span>
                </button>
              )}

              <form onSubmit={handleCustomLocationSubmit} className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                  Or enter custom coordinates
                </div>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Name (e.g. Haughton River Crossing)"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-white/15 bg-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#32ADE6]"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="number"
                    step="any"
                    value={customLat}
                    onChange={(e) => setCustomLat(e.target.value)}
                    placeholder="Lat (e.g. -19.44)"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-white/15 bg-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#32ADE6] font-mono"
                  />
                  <input
                    type="number"
                    step="any"
                    value={customLng}
                    onChange={(e) => setCustomLng(e.target.value)}
                    placeholder="Lng (e.g. 147.11)"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-white/15 bg-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#32ADE6] font-mono"
                  />
                </div>
                {addLocationError && (
                  <p className="text-[11px] font-medium text-[#ff3b30]">{addLocationError}</p>
                )}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddLocationOpen(false);
                      setAddLocationError(null);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-white/65 hover:text-white hover:bg-white/10 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 rounded-lg bg-[#32ADE6] hover:bg-[#4cbdf0] text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Coordinates
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Quick-Switch Preset & Saved Location Chips */}
          <div className="px-4 pt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar select-none">
            {PRESET_LOCATIONS.map((loc) => {
              const isSelected = loc.id === selectedLocation.id;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => onSelectLocation(loc)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#32ADE6] text-white font-semibold'
                      : 'bg-white/[0.08] text-white/75 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  {loc.name}
                </button>
              );
            })}

            {savedLocations.map((loc) => {
              const isSelected = loc.id === selectedLocation.id;
              return (
                <div
                  key={loc.id}
                  className={`flex items-center rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-[#32ADE6] text-white font-semibold'
                      : 'bg-white/[0.08] text-white/75 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectLocation(loc)}
                    className="pl-2.5 pr-1.5 py-1 cursor-pointer"
                  >
                    {loc.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSavedLocation(loc.id)}
                    className={`pr-2 pl-0.5 py-1 cursor-pointer ${
                      isSelected ? 'text-white/80 hover:text-white' : 'text-white/45 hover:text-[#ff3b30]'
                    }`}
                    title={`Remove ${loc.name}`}
                    aria-label={`Remove ${loc.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Centered iOS Weather Hero Section */}
          <section className="px-6 pt-7 pb-5 text-center relative">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-[2.1rem] font-normal tracking-tight text-white truncate max-w-[290px]">
                {selectedLocation.name}
              </h1>
              {!isCurrentSavedOrPreset && (
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
              <span>
                {selectedLocation.lat >= 0
                  ? `${selectedLocation.lat.toFixed(3)}°N`
                  : `${Math.abs(selectedLocation.lat).toFixed(3)}°S`}
                ,{' '}
                {selectedLocation.lng >= 0
                  ? `${selectedLocation.lng.toFixed(3)}°E`
                  : `${Math.abs(selectedLocation.lng).toFixed(3)}°W`}
              </span>
            </div>
          </section>

          {/* Quick-Access Summary Widgets (UV Index, Humidity, Wind Speed) */}
          <div className="px-4 mb-3">
            <SummaryWidgets
              weatherBundle={weatherBundle}
              unitSystem={unitSystem}
              isLoading={isLoadingWeather}
            />
          </div>

          {/* Active iOS Red Cyclone / Threat Banner */}
          {cycloneMode ? (
            <div className="mx-4 mb-3 bg-[#ff3b30] text-white px-4 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold shadow-lg shadow-[#ff3b30]/20">
              <span className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5" />
                <span>Cyclone Mode: WN3 Active</span>
              </span>
              <button
                type="button"
                onClick={onToggleCycloneMode}
                className="text-[11px] bg-black/20 hover:bg-black/30 px-2 py-0.5 rounded-md cursor-pointer"
              >
                Turn OFF
              </button>
            </div>
          ) : threatDetection.isThreatDetected ? (
            <div className="mx-4 mb-3 bg-[#ff3b30] text-white px-4 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold animate-pulse">
              <div className="min-w-0">
                <div className="truncate">Tropical Low / Flood Warning</div>
                <div className="text-[10px] text-white/80 font-normal truncate">
                  {threatDetection.reasons[0]}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleCycloneMode}
                className="px-2.5 py-1 rounded-lg bg-white text-[#ff3b30] text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
              >
                Turn ON
              </button>
            </div>
          ) : null}

          {/* Mode Switches + Segmented Navigation Tabs */}
          <div className="px-4 space-y-2.5 mb-3">
            {/* Compact Toggle Strip */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2">
                <span className="text-[11px] font-medium text-white/80 truncate flex items-center gap-1.5">
                  <ShieldAlert
                    className={`w-3.5 h-3.5 shrink-0 ${
                      emergencyDashboardEnabled ? 'text-[#ff9500]' : 'text-white/40'
                    }`}
                  />
                  <span>Emergency</span>
                </span>
                <button
                  id="btn-emergency-dashboard-toggle"
                  type="button"
                  role="switch"
                  aria-checked={emergencyDashboardEnabled}
                  onClick={onToggleEmergencyDashboard}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    emergencyDashboardEnabled ? 'bg-[#ff9500]' : 'bg-white/20 hover:bg-white/30'
                  }`}
                  title={emergencyDashboardEnabled ? 'Turn Emergency Dashboard OFF' : 'Turn Emergency Dashboard ON'}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      emergencyDashboardEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2">
                <span className="text-[11px] font-medium text-white/80 truncate flex items-center gap-1.5">
                  <Wind className={`w-3.5 h-3.5 shrink-0 ${cycloneMode ? 'text-[#ff3b30]' : 'text-white/45'}`} />
                  <span>Cyclone WN3</span>
                </span>
                <button
                  id="btn-cyclone-threat-toggle"
                  type="button"
                  role="switch"
                  aria-checked={cycloneMode}
                  onClick={onToggleCycloneMode}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    cycloneMode ? 'bg-[#ff3b30]' : 'bg-white/20 hover:bg-white/30'
                  }`}
                  title="Toggle Cyclone Mode: WeatherNext 3"
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      cycloneMode ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Segmented Mode Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-white/[0.08] p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => onChangeTab('overview')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'overview'
                    ? 'bg-white/15 text-white shadow-xs'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <Sun className="w-3.5 h-3.5 text-[#ff9500]" />
                <span>Overview</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeTab('models')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'models'
                    ? 'bg-white/15 text-white shadow-xs'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <BarChart3 className={`w-3.5 h-3.5 ${cycloneMode ? 'text-[#ff3b30]' : 'text-[#32ADE6]'}`} />
                <span>{cycloneMode ? '5-Model' : '4-Model'}</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeTab('emergency')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                  activeTab === 'emergency'
                    ? 'bg-white/15 text-white shadow-xs'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <ShieldAlert className={`w-3.5 h-3.5 ${emergencyDashboardEnabled ? 'text-[#ff9500]' : 'text-white/40'}`} />
                <span>{emergencyDashboardEnabled ? `Alerts (${emergencyCount})` : 'Alerts OFF'}</span>
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="px-4 pb-6 space-y-3">
            {activeTab === 'overview' && (
              <div className="space-y-3">
                {cycloneMode && (
                  <CycloneThreatPanel
                    cycloneMode={cycloneMode}
                    onToggleCycloneMode={onToggleCycloneMode}
                    threatDetection={threatDetection}
                    wn3ApiKey={wn3ApiKey}
                    onSaveWn3ApiKey={onSaveWn3ApiKey}
                    wn3Bundle={wn3Bundle}
                    cycloneSynthesis={cycloneSynthesis}
                    isLoading={isLoadingCyclone}
                    error={cycloneError}
                    unitSystem={unitSystem}
                    onRefresh={onRefreshCyclone}
                    onFallbackToGemini={onFallbackCycloneToGemini}
                  />
                )}

                {/* Apple-Style Bento Grid */}
                <div className="grid grid-cols-2 gap-3 tabular-nums">
                  {/* Card Full: Multi-Model Consensus (Today) */}
                  <div className="col-span-2 ios-bento-card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-white/50" />
                        <span>Multi-Model Consensus (Today)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onChangeTab('models')}
                        className="text-[11px] font-medium text-[#32ADE6] hover:underline cursor-pointer"
                      >
                        7d Matrix →
                      </button>
                    </div>

                    {todayRow ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="inline-block px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-white/80 mb-1">
                            WN2
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {fmtRangeTemp(todayRow.weatherNext2.minTemp)}/{fmtRangeTemp(todayRow.weatherNext2.maxTemp)}{' '}
                            <span className="text-[#32ADE6]">
                              {fmtRainShort(todayRow.weatherNext2.rainMm)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <div className="inline-block px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-white/80 mb-1">
                            BOM
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {todayRow.bom
                              ? `${fmtRangeTemp(todayRow.bom.minTemp)}/${fmtRangeTemp(todayRow.bom.maxTemp)}`
                              : '—'}{' '}
                            <span className="text-[#34c759]">
                              {todayRow.bom ? fmtRainShort(todayRow.bom.rainMm) : '—'}
                            </span>
                          </div>
                        </div>

                        <div>
                          <div className="inline-block px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-white/80 mb-1">
                            ECMWF
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {fmtRangeTemp(todayRow.ecmwf.minTemp)}/{fmtRangeTemp(todayRow.ecmwf.maxTemp)}{' '}
                            <span className="text-[#5856d6] font-bold">
                              {fmtRainShort(todayRow.ecmwf.rainMm)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <div className="inline-block px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-white/80 mb-1">
                            GFS
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {fmtRangeTemp(todayRow.gfs.minTemp)}/{fmtRangeTemp(todayRow.gfs.maxTemp)}{' '}
                            <span className="text-[#ff9500]">
                              {fmtRainShort(todayRow.gfs.rainMm)}
                            </span>
                          </div>
                        </div>

                        {todayWn3 && (
                          <div className="col-span-2 pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-[#ff3b30]/25 text-[#ff3b30] font-mono text-[10px] font-semibold">
                              WN3
                            </span>
                            <span className="font-semibold text-white">
                              {fmtRangeTemp(todayWn3.minTemp)}/{fmtRangeTemp(todayWn3.maxTemp)}{' '}
                              <span className="text-[#32ADE6] ml-1">{fmtRainShort(todayWn3.rainMm)}</span>
                              {todayWn3.peakGustKmh !== null && (
                                <span className="text-white/60 ml-2">Gust {Math.round(todayWn3.peakGustKmh)} km/h</span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
                    )}
                  </div>

                  {/* Card Half: Precipitation */}
                  <div className="ios-bento-card p-4 flex flex-col justify-between">
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
                      Precipitation
                    </div>
                    <div className="mt-2">
                      <div className="text-[1.8rem] font-semibold leading-none text-white">
                        {multiModelBundle?.spreadOverview.peak24hRainConsensusMm !== null &&
                        multiModelBundle?.spreadOverview.peak24hRainConsensusMm !== undefined
                          ? isMetric
                            ? multiModelBundle.spreadOverview.peak24hRainConsensusMm.toFixed(1)
                            : (multiModelBundle.spreadOverview.peak24hRainConsensusMm / 25.4).toFixed(2)
                          : '0.0'}
                        <span className="text-sm font-normal text-white/60 ml-1">
                          {isMetric ? 'mm' : 'in'}
                        </span>
                      </div>
                      <div className="text-xs text-white/55 mt-2">24h Mean</div>
                    </div>
                  </div>

                  {/* Card Half: Consensus */}
                  <div className="ios-bento-card p-4 flex flex-col justify-between">
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
                      Consensus
                    </div>
                    <div className="mt-2">
                      <div className={`text-base font-semibold leading-tight ${spreadColorClass}`}>
                        {multiModelBundle?.spreadOverview.agreementLabel || 'Syncing…'}
                      </div>
                      <div className="text-xs text-white/55 mt-2">
                        {multiModelBundle?.spreadOverview.avgTempSpreadC !== null &&
                        multiModelBundle?.spreadOverview.avgTempSpreadC !== undefined
                          ? `ΔT ${multiModelBundle.spreadOverview.avgTempSpreadC.toFixed(1)}° · Model Spread`
                          : 'Model Variation'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Corridor Briefing Bento */}
                <CorridorBriefingCard
                  selectedLocation={selectedLocation}
                  multiModelBundle={multiModelBundle}
                  emergencyBundle={emergencyDashboardEnabled ? emergencyBundle : null}
                />

                {/* Emergency Info Summary Bento */}
                {emergencyDashboardEnabled && (
                  <div className="rounded-[20px] border border-[#ff3b30]/25 bg-[#ff3b30]/10 backdrop-blur-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#ff3b30]">
                        Emergency Info
                      </div>
                      <button
                        type="button"
                        onClick={() => onChangeTab('emergency')}
                        className="text-[11px] font-medium text-white/75 hover:text-white cursor-pointer"
                      >
                        {emergencyCount} Active →
                      </button>
                    </div>
                    {isLoadingEmergency && !emergencyBundle ? (
                      <div className="text-xs text-white/65">Checking QLD ArcGIS & Guardian IMS feeds...</div>
                    ) : topEmergency ? (
                      <div>
                        <div className="text-xs font-semibold text-white line-clamp-1">
                          {topEmergency.title}
                        </div>
                        <div className="text-[11px] text-white/75 mt-1">
                          {corridorCount > 0
                            ? `Bruce Hwy Corridor: ${corridorCount} active priority alert${corridorCount > 1 ? 's' : ''}`
                            : `${emergencyCount} regional feed items · ${topEmergency.sourceLabel}`}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs font-semibold text-white">Bruce Highway Corridor: LOW IMPACT</div>
                        <div className="text-[11px] text-white/65 mt-1">
                          No active road closures or warnings reported in North QLD bbox
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* BOM Official Warnings & Public Alerts */}
                {weatherBundle?.alerts && weatherBundle.alerts.length > 0 && (
                  <WeatherAlertBanner alerts={weatherBundle.alerts} />
                )}

                {multiModelBundle && multiModelBundle.bomWarnings.length > 0 && (
                  <div className="rounded-[20px] border border-[#ff3b30]/40 bg-[#ff3b30]/15 backdrop-blur-xl p-4 space-y-1.5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-rose-200">
                      BOM Active Warnings ({multiModelBundle.bomWarnings.length})
                    </div>
                    {multiModelBundle.bomWarnings.map((w) => (
                      <div key={w.id} className="text-xs text-white/90">
                        {w.title}
                      </div>
                    ))}
                  </div>
                )}

                {hasExtendedGoogleBundle && current && (
                  <AtmosphericMetricsGrid current={current} unitSystem={unitSystem} />
                )}

                {hasExtendedGoogleBundle &&
                  ((weatherBundle?.hourly && weatherBundle.hourly.length > 0) ||
                    (weatherBundle?.historyHours && weatherBundle.historyHours.length > 0)) && (
                    <HourlyForecastTimeline
                      hourly={weatherBundle?.hourly}
                      historyHours={weatherBundle?.historyHours}
                    />
                  )}

                {hasExtendedGoogleBundle && current && <SunMoonTracker current={current} />}
              </div>
            )}

            {activeTab === 'models' && (
              <div className="space-y-3">
                {cycloneMode && (
                  <CycloneThreatPanel
                    cycloneMode={cycloneMode}
                    onToggleCycloneMode={onToggleCycloneMode}
                    threatDetection={threatDetection}
                    wn3ApiKey={wn3ApiKey}
                    onSaveWn3ApiKey={onSaveWn3ApiKey}
                    wn3Bundle={wn3Bundle}
                    cycloneSynthesis={cycloneSynthesis}
                    isLoading={isLoadingCyclone}
                    error={cycloneError}
                    unitSystem={unitSystem}
                    onRefresh={onRefreshCyclone}
                    onFallbackToGemini={onFallbackCycloneToGemini}
                  />
                )}
                <MultiModelComparison
                  bundle={multiModelBundle}
                  isLoading={isLoadingModels}
                  unitSystem={unitSystem}
                  onRefresh={onRefreshAll}
                  cycloneMode={cycloneMode}
                  wn3Bundle={wn3Bundle}
                  cycloneSynthesis={cycloneSynthesis}
                />
              </div>
            )}

            {activeTab === 'emergency' && (
              <EmergencyDrawer
                isEnabled={emergencyDashboardEnabled}
                onToggleEnabled={onToggleEmergencyDashboard}
                bundle={emergencyBundle}
                isLoading={isLoadingEmergency}
                layerToggles={emergencyLayers}
                onToggleLayer={onToggleEmergencyLayer}
                proxyUrl={emergencyProxyUrl}
                onChangeProxyUrl={onChangeEmergencyProxyUrl}
                onRefresh={onRefreshEmergency}
                onFocusItem={onFocusEmergencyItem}
              />
            )}

            {/* Quiet Monochrome Attribution Footer */}
            <footer className="pt-6 pb-2 text-center font-mono text-[10px] tracking-wider text-white/40 uppercase tabular-nums space-y-1">
              <div>OPEN-METEO · BOM · RAINVIEWER · QLD ARCGIS</div>
              <div>
                {new Date(multiModelBundle?.lastUpdated || Date.now()).toLocaleTimeString('en-AU', {
                  timeZone: 'Australia/Brisbane',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                AEST · AUSTRALIA/BRISBANE
              </div>
            </footer>
          </div>
        </div>
      </aside>
    </>
  );
}
