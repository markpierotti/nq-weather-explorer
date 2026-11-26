/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { MotionConfig } from 'motion/react';
import {
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
} from './types/weather';
import { PRESET_LOCATIONS } from './utils/mockWeatherData';
import { fetchKeylessWeatherBundle, fetchWeatherConfig } from './services/weatherApi';
import { fetchMultiModelForecast, fetchRainViewerFrames } from './services/multiModelApi';
import { DEFAULT_EMERGENCY_PROXY, fetchAllNqEmergencyFeeds } from './services/emergencyApi';
import {
  detectCycloneThreat,
  fetchGeminiCycloneSynthesis,
  fetchWeatherNext3,
  getStoredWn3ApiKey,
  setStoredWn3ApiKey,
} from './services/weatherNext3Api';
import { WeatherMap } from './components/WeatherMap';
import { WeatherSidebar } from './components/WeatherSidebar';
import { MobileShell } from './components/mobile/MobileShell';
import { FirstRunNotice } from './components/FirstRunNotice';
import { useIsDesktop } from './hooks/useIsDesktop';
import {
  AppData,
  AppDataProvider,
  RadarData,
  RadarDataProvider,
  RadarSpeed,
  SheetSnap,
  SidebarTab,
} from './state/AppDataContext';

const SAVED_LOCATIONS_KEY = 'nq_saved_locations_v1';

function loadSavedLocations(): WeatherLocation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_LOCATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.lat === 'number' &&
        typeof item.lng === 'number'
    );
  } catch {
    return [];
  }
}

export function App() {
  const envMapsKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
  const [apiKey, setApiKey] = useState<string>(envMapsKey);
  const [isConfigReady, setIsConfigReady] = useState<boolean>(() => Boolean(envMapsKey));
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);

  // Default to North Queensland: Ayr / Burdekin
  const [savedLocations, setSavedLocations] = useState<WeatherLocation[]>(() => loadSavedLocations());
  const [selectedLocation, setSelectedLocation] = useState<WeatherLocation>(PRESET_LOCATIONS[0]);
  const [weatherBundle, setWeatherBundle] = useState<LocationWeatherBundle | null>(null);
  const [multiModelBundle, setMultiModelBundle] = useState<MultiModelBundle | null>(null);
  const [emergencyBundle, setEmergencyBundle] = useState<EmergencyBundle | null>(null);

  const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [isLoadingEmergency, setIsLoadingEmergency] = useState<boolean>(false);

  // On-demand Cyclone Threat Mode (WeatherNext 3) — OFF by default for $0 idle usage
  const [cycloneMode, setCycloneMode] = useState<boolean>(false);
  const [wn3ApiKey, setWn3ApiKey] = useState<string>(() => getStoredWn3ApiKey());
  const [wn3Bundle, setWn3Bundle] = useState<WeatherNext3Bundle | null>(null);
  const [cycloneSynthesis, setCycloneSynthesis] = useState<GeminiCycloneSynthesis | null>(null);
  const [isLoadingCyclone, setIsLoadingCyclone] = useState<boolean>(false);
  const [cycloneError, setCycloneError] = useState<string | null>(null);

  const [unitSystem, setUnitSystem] = useState<WeatherUnitSystem>('METRIC');
  const [rainViewerData, setRainViewerData] = useState<RainViewerData | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState<number>(0);
  const [isRadarPlaying, setIsRadarPlaying] = useState<boolean>(false);

  const [radarSpeed, setRadarSpeed] = useState<RadarSpeed>(1);
  const [radarOpacity, setRadarOpacity] = useState<number>(0.75);
  const [radarVisible, setRadarVisible] = useState<boolean>(true);

  // Shell: desktop (>= 1024px) left sidebar vs. mobile bottom sheet + tab bar
  const isDesktop = useIsDesktop();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');
  const [activeTab, setActiveTab] = useState<SidebarTab>('overview');
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState<boolean>(false);
  const [searchFocusToken, setSearchFocusToken] = useState<number>(0);

  // Emergency layer & dashboard OFF by default
  const [emergencyDashboardEnabled, setEmergencyDashboardEnabled] = useState<boolean>(false);
  const [emergencyProxyUrl, setEmergencyProxyUrl] = useState<string>(DEFAULT_EMERGENCY_PROXY);
  const [emergencyLayers, setEmergencyLayers] = useState<EmergencyLayerToggles>({
    corridor: true,
    roads: true,
    outages: true,
    warnings: true,
    qfd: true,
    support: true,
    gauges: true,
    traffic: true,
    bomWarnings: true,
  });
  const [selectedEmergencyItem, setSelectedEmergencyItem] = useState<EmergencyFeatureItem | null>(null);

  // Listen for Google Maps Platform auth/quota events (Case A Demo Key defense)
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Initialize Maps client config before mounting APIProvider
  useEffect(() => {
    let active = true;
    fetchWeatherConfig()
      .then((cfg) => {
        if (active && cfg.apiKey) {
          setApiKey(cfg.apiKey);
        }
      })
      .finally(() => {
        if (active) setIsConfigReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load RainViewer radar frames
  const loadRainViewer = useCallback(async () => {
    const data = await fetchRainViewerFrames();
    if (data && data.frames.length > 0) {
      setRainViewerData(data);
      const pastFrames = data.frames.filter((f) => f.kind === 'past');
      const initialIdx = pastFrames.length > 0 ? pastFrames.length - 1 : 0;
      setActiveFrameIndex(initialIdx);
    }
  }, []);

  useEffect(() => {
    loadRainViewer();
  }, [loadRainViewer]);

  // Animated RainViewer playback loop
  useEffect(() => {
    if (!isRadarPlaying || !rainViewerData || rainViewerData.frames.length === 0) return;
    const total = rainViewerData.frames.length;
    const timer = setInterval(() => {
      setActiveFrameIndex((prev) => (prev + 1) % total);
    }, 650 / radarSpeed);
    return () => clearInterval(timer);
  }, [isRadarPlaying, rainViewerData, radarSpeed]);

  // Load keyless Open-Meteo current weatherBundle + Multi-Model ($0 keyless WeatherNext 2 / ECMWF / GFS + BOM).
  // Keep GOOGLE_WEATHER_API_KEY OFF during routine browsing to protect the 100 calls/day free quota.
  const loadLocationForecasts = useCallback(
    async (location: WeatherLocation) => {
      setIsLoadingWeather(true);
      setIsLoadingModels(true);

      const [weatherRes, modelRes] = await Promise.allSettled([
        fetchKeylessWeatherBundle(location),
        fetchMultiModelForecast(location),
      ]);

      if (weatherRes.status === 'fulfilled') {
        setWeatherBundle(weatherRes.value);
      } else {
        console.warn('Current weather bundle fetch error:', weatherRes.reason);
      }
      setIsLoadingWeather(false);

      if (modelRes.status === 'fulfilled') {
        setMultiModelBundle(modelRes.value);
      } else {
        console.warn('Multi-model fetch error:', modelRes.reason);
      }
      setIsLoadingModels(false);
    },
    []
  );

  useEffect(() => {
    loadLocationForecasts(selectedLocation);
  }, [selectedLocation, loadLocationForecasts]);

  // Load NQ Emergency, Flood, Road & Outage Feeds
  const loadEmergencyFeeds = useCallback(async (proxy: string) => {
    setIsLoadingEmergency(true);
    try {
      const bundle = await fetchAllNqEmergencyFeeds(proxy);
      setEmergencyBundle(bundle);
    } finally {
      setIsLoadingEmergency(false);
    }
  }, []);

  useEffect(() => {
    if (!emergencyDashboardEnabled) return;
    loadEmergencyFeeds(emergencyProxyUrl);
  }, [emergencyDashboardEnabled, emergencyProxyUrl, loadEmergencyFeeds]);

  // Automatic Tropical Low / Cyclone detection from ArcGIS Cyclone Track & BOM warnings
  const threatDetection = useMemo(
    () => detectCycloneThreat(emergencyBundle, multiModelBundle),
    [emergencyBundle, multiModelBundle]
  );

  // On-demand WeatherNext 3 (backend GOOGLE_WEATHER_API_KEY proxy -> 30m cache -> Gemini Synthesis fallback)
  // ONLY executes when cycloneMode === true.
  const loadCycloneThreatData = useCallback(
    async (forceNetwork = false) => {
      if (!cycloneMode) return;
      setIsLoadingCyclone(true);
      setCycloneError(null);

      try {
        const bundle = await fetchWeatherNext3(
          selectedLocation.lat,
          selectedLocation.lng,
          wn3ApiKey,
          forceNetwork
        );
        setWn3Bundle(bundle);
        setCycloneSynthesis(null);
      } catch (err: any) {
        if (err?.code === 'NO_WEATHER_KEY') {
          // No backend GOOGLE_WEATHER_API_KEY or local wn3_api_key -> automatic Gemini Cyclone Synthesis
          try {
            setWn3Bundle(null);
            const synth = await fetchGeminiCycloneSynthesis(
              selectedLocation,
              multiModelBundle,
              emergencyBundle
            );
            setCycloneSynthesis(synth);
          } catch (synthErr: any) {
            setCycloneError(synthErr?.message || 'Unable to run Gemini Cyclone Synthesis.');
          }
        } else {
          setCycloneError(err?.message || 'Unable to load WeatherNext 3 Cyclone data.');
        }
      } finally {
        setIsLoadingCyclone(false);
      }
    },
    [cycloneMode, wn3ApiKey, selectedLocation, multiModelBundle, emergencyBundle]
  );

  // Trigger on-demand load only when Cyclone Mode is toggled ON or key/location changes while ON
  useEffect(() => {
    if (!cycloneMode) return;
    loadCycloneThreatData(false);
  }, [cycloneMode, wn3ApiKey, selectedLocation.lat, selectedLocation.lng]);

  const handleFallbackCycloneToGemini = useCallback(async () => {
    setIsLoadingCyclone(true);
    setCycloneError(null);
    setWn3Bundle(null);
    try {
      const synth = await fetchGeminiCycloneSynthesis(
        selectedLocation,
        multiModelBundle,
        emergencyBundle
      );
      setCycloneSynthesis(synth);
    } catch (err: any) {
      setCycloneError(err?.message || 'Gemini Cyclone Synthesis fallback failed.');
    } finally {
      setIsLoadingCyclone(false);
    }
  }, [selectedLocation, multiModelBundle, emergencyBundle]);

  const handleSaveWn3ApiKey = useCallback((newKey: string) => {
    setStoredWn3ApiKey(newKey);
    setWn3ApiKey(newKey);
    if (!newKey) {
      setWn3Bundle(null);
    }
  }, []);

  const handleToggleCycloneMode = useCallback(() => {
    setCycloneMode((prev) => !prev);
  }, []);

  const handleSelectLocation = useCallback((loc: WeatherLocation) => {
    setSelectedLocation(loc);
  }, []);

  const handleAddLocation = useCallback((loc: WeatherLocation) => {
    const normalized: WeatherLocation = {
      ...loc,
      id: loc.id.startsWith('saved-') ? loc.id : `saved-${Date.now()}-${Math.round(Math.abs(loc.lat) * 100)}`,
      searchQuery: loc.searchQuery || loc.name,
      timezone: loc.timezone || 'Australia/Brisbane',
      isManual: false,
    };

    setSavedLocations((prev) => {
      const existsInPresets = PRESET_LOCATIONS.some(
        (p) => Math.abs(p.lat - normalized.lat) < 0.002 && Math.abs(p.lng - normalized.lng) < 0.002
      );
      const existsInSaved = prev.some(
        (p) =>
          p.id === loc.id ||
          (Math.abs(p.lat - normalized.lat) < 0.002 && Math.abs(p.lng - normalized.lng) < 0.002)
      );
      if (existsInPresets || existsInSaved) return prev;
      const next = [...prev, normalized];
      try {
        window.localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
    setSelectedLocation(normalized);
  }, []);

  const handleRemoveSavedLocation = useCallback(
    (id: string) => {
      setSavedLocations((prev) => {
        const next = prev.filter((l) => l.id !== id);
        try {
          window.localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage errors
        }
        return next;
      });
      if (selectedLocation.id === id) {
        setSelectedLocation(PRESET_LOCATIONS[0]);
      }
    },
    [selectedLocation.id]
  );

  const handleToggleEmergencyDashboard = useCallback(() => {
    setEmergencyDashboardEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedEmergencyItem(null);
      }
      return next;
    });
  }, []);

  const handleRefreshAll = useCallback(() => {
    loadLocationForecasts(selectedLocation);
    loadRainViewer();
    if (emergencyDashboardEnabled) {
      loadEmergencyFeeds(emergencyProxyUrl);
    }
    if (cycloneMode) {
      loadCycloneThreatData(true);
    }
  }, [
    selectedLocation,
    emergencyDashboardEnabled,
    emergencyProxyUrl,
    cycloneMode,
    loadLocationForecasts,
    loadRainViewer,
    loadEmergencyFeeds,
    loadCycloneThreatData,
  ]);

  const handleToggleEmergencyLayer = useCallback((key: keyof EmergencyLayerToggles) => {
    setEmergencyLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleFocusEmergencyItem = useCallback(
    (item: EmergencyFeatureItem) => {
      setSelectedEmergencyItem(item);
      // Ensure corresponding layer is enabled
      if (item.category === 'road') setEmergencyLayers((p) => ({ ...p, roads: true }));
      if (item.category === 'outage') setEmergencyLayers((p) => ({ ...p, outages: true }));
      if (item.category === 'warning' || item.category === 'cyclone') setEmergencyLayers((p) => ({ ...p, warnings: true }));
      if (item.category === 'qfd' || item.category === 'fire_danger') setEmergencyLayers((p) => ({ ...p, qfd: true }));
      if (['fuel', 'evac', 'sandbag', 'bulletin'].includes(item.category)) {
        setEmergencyLayers((p) => ({ ...p, support: true }));
      }
      if (item.category === 'river_gauge') setEmergencyLayers((p) => ({ ...p, gauges: true }));
      if (item.category === 'traffic') setEmergencyLayers((p) => ({ ...p, traffic: true }));
      if (item.category === 'bom_warning') setEmergencyLayers((p) => ({ ...p, bomWarnings: true }));
      // Mobile: drop the sheet so the map (and the item) is visible
      if (!isDesktop) setSheetSnap('peek');
    },
    [isDesktop]
  );

  const handleChangeTab = useCallback(
    (tab: SidebarTab) => {
      setActiveTab(tab);
      // Mobile: picking a tab while the sheet is collapsed opens it to half height
      if (!isDesktop) setSheetSnap((s) => (s === 'peek' ? 'half' : s));
    },
    [isDesktop]
  );

  const handleOpenSearch = useCallback(() => {
    if (isDesktop) {
      setIsCollapsed(false);
    } else {
      setActiveTab('overview');
      setSheetSnap('full');
      setIsLayersMenuOpen(false);
    }
    setSearchFocusToken((t) => t + 1);
  }, [isDesktop]);

  const handleChangeFrameIndex = useCallback((idx: number) => {
    setIsRadarPlaying(false);
    setActiveFrameIndex(idx);
  }, []);

  const handleToggleUnitSystem = useCallback(
    () => setUnitSystem((p) => (p === 'METRIC' ? 'IMPERIAL' : 'METRIC')),
    []
  );
  const handleToggleSidebar = useCallback(() => setIsCollapsed((c) => !c), []);
  const handleToggleRadarPlay = useCallback(() => setIsRadarPlaying((p) => !p), []);
  const handleToggleRadarSpeed = useCallback(() => setRadarSpeed((s) => (s === 1 ? 2 : 1)), []);
  const handleToggleRadarVisible = useCallback(() => setRadarVisible((v) => !v), []);
  const handleRefreshEmergency = useCallback(
    () => loadEmergencyFeeds(emergencyProxyUrl),
    [loadEmergencyFeeds, emergencyProxyUrl]
  );

  const mapsApiKey = apiKey || (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';

  const quotaBanner = quotaExceeded ? (
    <div className="bg-[#ff9500]/15 border-b border-[#ff9500]/30 text-amber-200 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 backdrop-blur-md">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/documentation/javascript/usage-and-billing"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-white hover:text-[#32ADE6]"
        >
          maps developer site
        </a>{' '}
        for instructions to update your account.
      </span>
    </div>
  ) : null;

  const isMapAvailable = isConfigReady && Boolean(mapsApiKey);

  const appData = useMemo<AppData>(
    () => ({
      selectedLocation,
      savedLocations,
      onSelectLocation: handleSelectLocation,
      onAddLocation: handleAddLocation,
      onRemoveSavedLocation: handleRemoveSavedLocation,
      weatherBundle,
      multiModelBundle,
      isLoadingWeather,
      isLoadingModels,
      unitSystem,
      onToggleUnitSystem: handleToggleUnitSystem,
      onRefreshAll: handleRefreshAll,
      isDesktop,
      activeTab,
      onChangeTab: handleChangeTab,
      isSidebarCollapsed: isCollapsed,
      onToggleSidebar: handleToggleSidebar,
      sheetSnap,
      onChangeSheetSnap: setSheetSnap,
      onOpenSearch: handleOpenSearch,
      searchFocusToken,
      isLayersMenuOpen,
      onSetLayersMenuOpen: setIsLayersMenuOpen,
      isMapAvailable,
      emergencyBundle,
      isLoadingEmergency,
      emergencyDashboardEnabled,
      onToggleEmergencyDashboard: handleToggleEmergencyDashboard,
      emergencyLayers,
      onToggleEmergencyLayer: handleToggleEmergencyLayer,
      emergencyProxyUrl,
      onChangeEmergencyProxyUrl: setEmergencyProxyUrl,
      onRefreshEmergency: handleRefreshEmergency,
      selectedEmergencyItem,
      onSelectEmergencyItem: setSelectedEmergencyItem,
      onFocusEmergencyItem: handleFocusEmergencyItem,
      cycloneMode,
      onToggleCycloneMode: handleToggleCycloneMode,
      threatDetection,
      wn3ApiKey,
      onSaveWn3ApiKey: handleSaveWn3ApiKey,
      wn3Bundle,
      cycloneSynthesis,
      isLoadingCyclone,
      cycloneError,
      onRefreshCyclone: loadCycloneThreatData,
      onFallbackCycloneToGemini: handleFallbackCycloneToGemini,
    }),
    [
      selectedLocation,
      savedLocations,
      handleSelectLocation,
      handleAddLocation,
      handleRemoveSavedLocation,
      weatherBundle,
      multiModelBundle,
      isLoadingWeather,
      isLoadingModels,
      unitSystem,
      handleToggleUnitSystem,
      handleRefreshAll,
      isDesktop,
      activeTab,
      handleChangeTab,
      isCollapsed,
      handleToggleSidebar,
      sheetSnap,
      handleOpenSearch,
      searchFocusToken,
      isLayersMenuOpen,
      isMapAvailable,
      emergencyBundle,
      isLoadingEmergency,
      emergencyDashboardEnabled,
      handleToggleEmergencyDashboard,
      emergencyLayers,
      handleToggleEmergencyLayer,
      emergencyProxyUrl,
      handleRefreshEmergency,
      selectedEmergencyItem,
      handleFocusEmergencyItem,
      cycloneMode,
      handleToggleCycloneMode,
      threatDetection,
      wn3ApiKey,
      handleSaveWn3ApiKey,
      wn3Bundle,
      cycloneSynthesis,
      isLoadingCyclone,
      cycloneError,
      loadCycloneThreatData,
      handleFallbackCycloneToGemini,
    ]
  );

  const radarData = useMemo<RadarData>(
    () => ({
      rainViewerData,
      activeFrameIndex,
      onChangeFrameIndex: handleChangeFrameIndex,
      isRadarPlaying,
      onToggleRadarPlay: handleToggleRadarPlay,
      radarSpeed,
      onToggleRadarSpeed: handleToggleRadarSpeed,
      radarOpacity,
      onChangeRadarOpacity: setRadarOpacity,
      radarVisible,
      onToggleRadarVisible: handleToggleRadarVisible,
    }),
    [
      rainViewerData,
      activeFrameIndex,
      handleChangeFrameIndex,
      isRadarPlaying,
      handleToggleRadarPlay,
      radarSpeed,
      handleToggleRadarSpeed,
      radarOpacity,
      radarVisible,
      handleToggleRadarVisible,
    ]
  );

  const shellEl = isDesktop ? <WeatherSidebar /> : <MobileShell />;

  if (!isMapAvailable) {
    return (
      <MotionConfig reducedMotion="user">
      <AppDataProvider value={appData}>
      <RadarDataProvider value={radarData}>
        <div className="relative w-full h-dvh overflow-hidden bg-[#111113] text-white font-sans flex flex-col">
          {quotaBanner}
          <FirstRunNotice />
          <div className="relative flex-1 flex items-start lg:items-center justify-center bg-[#1a1a1c] pt-[calc(env(safe-area-inset-top)+24px)] lg:pt-0">
            <div className="rounded-[20px] bg-white/[0.08] border border-white/10 backdrop-blur-xl shadow-2xl px-6 py-5 text-center max-w-sm mx-4">
              <div className="text-sm font-semibold text-white">
                {!isConfigReady ? 'Initializing Google Maps…' : 'Google Maps API Key Unavailable'}
              </div>
              <p className="text-xs text-white/65 mt-1.5 leading-relaxed">
                {!isConfigReady
                  ? 'Loading map configuration and North Queensland weather layers.'
                  : 'Google Maps canvas is paused until VITE_GOOGLE_MAPS_API_KEY is available. Multi-Model forecasts and emergency feeds remain active.'}
              </p>
            </div>
            {shellEl}
          </div>
        </div>
      </RadarDataProvider>
      </AppDataProvider>
      </MotionConfig>
    );
  }

  return (
    <APIProvider
      key={mapsApiKey}
      apiKey={mapsApiKey}
      libraries={['places', 'maps', 'marker']}
    >
      <MotionConfig reducedMotion="user">
      <AppDataProvider value={appData}>
      <RadarDataProvider value={radarData}>
        <div className="relative w-full h-dvh overflow-hidden bg-[#111113] text-white font-sans flex flex-col">
          {quotaBanner}
          <FirstRunNotice />
          <div className="relative flex-1 overflow-hidden">
            <WeatherMap />
            {shellEl}
          </div>
        </div>
      </RadarDataProvider>
      </AppDataProvider>
      </MotionConfig>
    </APIProvider>
  );
}

export default App;
