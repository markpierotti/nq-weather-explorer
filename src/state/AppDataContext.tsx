/**
 * Shared app state for the sidebar / bottom-sheet panels and map chrome.
 * State itself still lives in App.tsx; this context only distributes it so panels
 * don't need dozens of pass-through props.
 */

import { createContext, useContext } from 'react';
import type {
  CycloneThreatDetection,
  EmergencyBundle,
  EmergencyFeatureItem,
  EmergencyLayerToggles,
  GeminiCycloneSynthesis,
  LocationWeatherBundle,
  MultiModelBundle,
  RainViewerData,
  WeatherLocation,
  WeatherNext3Bundle,
  WeatherUnitSystem,
} from '../types/weather';

export type SidebarTab = 'overview' | 'models' | 'emergency' | 'alerts';

/** Mobile bottom-sheet snap points. */
export type SheetSnap = 'peek' | 'half' | 'full';

export type RadarSpeed = 1 | 2;

export interface AppData {
  // Locations
  selectedLocation: WeatherLocation;
  savedLocations: WeatherLocation[];
  onSelectLocation: (loc: WeatherLocation) => void;
  onAddLocation: (loc: WeatherLocation) => void;
  onRemoveSavedLocation: (id: string) => void;

  // Forecast data
  weatherBundle: LocationWeatherBundle | null;
  multiModelBundle: MultiModelBundle | null;
  isLoadingWeather: boolean;
  isLoadingModels: boolean;
  unitSystem: WeatherUnitSystem;
  onToggleUnitSystem: () => void;
  onRefreshAll: () => void;

  // Navigation / shell
  isDesktop: boolean;
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  sheetSnap: SheetSnap;
  onChangeSheetSnap: (snap: SheetSnap) => void;
  /** Opens the location search (sidebar on desktop, full sheet on mobile) and focuses it. */
  onOpenSearch: () => void;
  /** Increments every time the search input should grab focus. */
  searchFocusToken: number;
  isLayersMenuOpen: boolean;
  onSetLayersMenuOpen: (open: boolean) => void;
  /** False in the no-API-key fallback (no map, so no layers menu). */
  isMapAvailable: boolean;

  // Emergency
  emergencyBundle: EmergencyBundle | null;
  isLoadingEmergency: boolean;
  emergencyDashboardEnabled: boolean;
  onToggleEmergencyDashboard: () => void;
  emergencyLayers: EmergencyLayerToggles;
  onToggleEmergencyLayer: (key: keyof EmergencyLayerToggles) => void;
  emergencyProxyUrl: string;
  onChangeEmergencyProxyUrl: (url: string) => void;
  onRefreshEmergency: () => void;
  selectedEmergencyItem: EmergencyFeatureItem | null;
  onSelectEmergencyItem: (item: EmergencyFeatureItem | null) => void;
  /** Select an item from a list: enables its layer and (on mobile) drops the sheet to peek. */
  onFocusEmergencyItem: (item: EmergencyFeatureItem) => void;

  // Cyclone mode (WeatherNext 3)
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

/**
 * Radar playback state lives in its own context: the frame index changes every 325–650 ms while
 * the loop plays, and keeping it out of AppData stops every panel in the sheet/sidebar re-rendering
 * on each frame. Only the radar overlay, radar bar and layers menu subscribe to it.
 */
export interface RadarData {
  rainViewerData: RainViewerData | null;
  activeFrameIndex: number;
  onChangeFrameIndex: (idx: number) => void;
  isRadarPlaying: boolean;
  onToggleRadarPlay: () => void;
  radarSpeed: RadarSpeed;
  onToggleRadarSpeed: () => void;
  radarOpacity: number;
  onChangeRadarOpacity: (opacity: number) => void;
  radarVisible: boolean;
  onToggleRadarVisible: () => void;
}

const AppDataContext = createContext<AppData | null>(null);

export const AppDataProvider = AppDataContext.Provider;

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside <AppDataProvider>');
  return ctx;
}

const RadarDataContext = createContext<RadarData | null>(null);

export const RadarDataProvider = RadarDataContext.Provider;

export function useRadarData(): RadarData {
  const ctx = useContext(RadarDataContext);
  if (!ctx) throw new Error('useRadarData must be used inside <RadarDataProvider>');
  return ctx;
}

/** Emergency items that count as warnings (shown on the Alerts tab). */
export function isWarningItem(item: EmergencyFeatureItem): boolean {
  return item.category === 'warning' || item.category === 'cyclone' || item.category === 'bom_warning';
}

/** Badge counts for the Emergency and Alerts tabs. */
export function useTabBadges() {
  const { emergencyBundle, emergencyDashboardEnabled, weatherBundle, multiModelBundle } = useAppData();
  const emergencyItems = emergencyDashboardEnabled ? emergencyBundle?.items ?? [] : [];
  const alerts =
    (weatherBundle?.alerts?.length ?? 0) +
    (multiModelBundle?.bomWarnings?.length ?? 0) +
    emergencyItems.filter(isWarningItem).length;
  return { emergency: emergencyItems.length, alerts };
}
