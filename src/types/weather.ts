/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type WeatherUnitSystem = 'METRIC' | 'IMPERIAL';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WeatherCondition {
  iconBaseUri?: string;
  description?: {
    text?: string;
    languageCode?: string;
  };
  type?: string;
}

export interface CurrentWeather {
  temperature?: {
    degrees?: number;
    unit?: string;
  };
  feelsLikeTemperature?: {
    degrees?: number;
    unit?: string;
  };
  dewPoint?: {
    degrees?: number;
    unit?: string;
  };
  relativeHumidity?: number;
  windSpeed?: {
    value?: number;
    unit?: string;
  };
  windDirection?: {
    degrees?: number;
    cardinal?: string;
  };
  windGust?: {
    value?: number;
    unit?: string;
  };
  precipitation?: {
    probability?: {
      percent?: number;
    };
    qpf?: {
      quantity?: number;
      unit?: string;
    };
    type?: string;
  };
  airPressure?: {
    meanSeaLevelMillibars?: number;
  };
  cloudCover?: number;
  uvIndex?: number;
  visibility?: {
    distance?: number;
    unit?: string;
  };
  weatherCondition?: WeatherCondition;
  isDaytime?: boolean;
  currentTime?: string;
  timeZone?: {
    id?: string;
  };
  sunAndMoon?: {
    sunrise?: string;
    sunset?: string;
    moonPhase?: string;
    moonrise?: string;
    moonset?: string;
  };
}

export interface HourlyForecast {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  displayDateTime?: {
    year?: number;
    month?: number;
    day?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    timeZone?: {
      id?: string;
    };
  };
  temperature?: {
    degrees?: number;
  };
  feelsLikeTemperature?: {
    degrees?: number;
  };
  precipitation?: {
    probability?: {
      percent?: number;
    };
    qpf?: {
      quantity?: number;
      unit?: string;
    };
    type?: string;
  };
  weatherCondition?: WeatherCondition;
  windSpeed?: {
    value?: number;
    unit?: string;
  };
  windDirection?: {
    degrees?: number;
    cardinal?: string;
  };
  relativeHumidity?: number;
  uvIndex?: number;
  cloudCover?: number;
  isDaytime?: boolean;
}

export interface DailyForecast {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  displayDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
  maxTemperature?: {
    degrees?: number;
  };
  minTemperature?: {
    degrees?: number;
  };
  precipitation?: {
    probability?: {
      percent?: number;
    };
    qpf?: {
      quantity?: number;
      unit?: string;
    };
    type?: string;
  };
  daytimeForecast?: {
    weatherCondition?: WeatherCondition;
    relativeHumidity?: number;
    windSpeed?: {
      value?: number;
      unit?: string;
    };
    windDirection?: {
      cardinal?: string;
    };
    cloudCover?: number;
    precipitation?: {
      probability?: {
        percent?: number;
      };
      qpf?: {
        quantity?: number;
        unit?: string;
      };
    };
  };
  nighttimeForecast?: {
    weatherCondition?: WeatherCondition;
    relativeHumidity?: number;
    windSpeed?: {
      value?: number;
      unit?: string;
    };
    windDirection?: {
      cardinal?: string;
    };
    cloudCover?: number;
    precipitation?: {
      probability?: {
        percent?: number;
      };
      qpf?: {
        quantity?: number;
        unit?: string;
      };
    };
  };
  sunAndMoon?: {
    sunrise?: string;
    sunset?: string;
    moonPhase?: string;
  };
}

export interface WeatherAlert {
  alertId?: string;
  headline?: string;
  description?: string;
  severity?: 'EXTREME' | 'SEVERE' | 'MODERATE' | 'MINOR' | 'UNKNOWN_SEVERITY';
  urgency?: 'IMMEDIATE' | 'EXPECTED' | 'FUTURE' | 'PAST' | 'UNKNOWN_URGENCY';
  certainty?: 'OBSERVED' | 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'UNKNOWN_CERTAINTY';
  effectiveTime?: string;
  expireTime?: string;
  eventDescription?: string;
  areas?: string[];
  senderName?: string;
}

export interface WeatherLocation {
  id: string;
  name: string;
  searchQuery?: string;
  country: string;
  region?: string;
  lat: number;
  lng: number;
  timezone?: string;
  isManual?: boolean;
}

export interface MinuteForecastSegment {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  timeFrame?: {
    startTime?: string;
    endTime?: string;
  };
  probability?: number;
  qpf?: {
    quantity?: number;
    unit?: string;
  };
  snowfallAmount?: {
    quantity?: number;
    unit?: string;
  };
  type?: 'RAIN' | 'SNOW' | 'ICE' | 'HAIL' | 'NONE' | string;
  intensity?: 'NO_INTENSITY' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'VERY_HEAVY' | string;
  precipitation?: {
    probability?: {
      percent?: number;
    };
    qpf?: {
      quantity?: number;
      unit?: string;
    };
    type?: string;
    intensity?: string;
  };
}

export type MinuteForecast = MinuteForecastSegment;

export interface OverallPredictionTimeframe {
  startTime?: string;
  endTime?: string;
}

export interface MinuteNowcastBundle {
  overallPredictionTimeframe?: OverallPredictionTimeframe;
  timeZone?: {
    id?: string;
    version?: string;
  };
  segments: MinuteForecastSegment[];
}

export interface CoverageInfo {
  minutesForecastSupported: boolean;
  isOutOfCoverage: boolean;
  notes?: string;
  endpointsStatus?: Record<string, { status: number; ok: boolean; message?: string }>;
}

export interface MinuteHistorySnapshot {
  timestamp: number;
  probability: number;
  qpfQuantity?: number;
  precipType?: string;
}

export interface MinuteTrendSummary {
  direction: 'INCREASING' | 'DECREASING' | 'STABLE_RAIN' | 'STABLE_DRY';
  text: string;
  deltaProbability: number;
  previousUpdateTime?: number;
}

export interface LocationWeatherBundle {
  location: WeatherLocation;
  current?: CurrentWeather;
  hourly: HourlyForecast[];
  historyHours?: HourlyForecast[];
  daily: DailyForecast[];
  alerts: WeatherAlert[];
  minutes?: MinuteForecast[];
  minuteNowcast?: MinuteNowcastBundle;
  historySnapshots?: MinuteHistorySnapshot[];
  trendSummary?: MinuteTrendSummary;
  coverage?: CoverageInfo;
  isUnsupportedLocation?: boolean;
  errorMessage?: string;
  isSimulated?: boolean;
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Multi-Model Comparison (Open-Meteo Ensemble + BOM Official)
// ---------------------------------------------------------------------------

export interface ModelMetricsSample {
  temp: number | null;
  precipMm: number | null;
  windKmh: number | null;
}

export interface ThreeHourlyModelRow {
  timeIso: string;
  label: string;
  weatherNext2: ModelMetricsSample;
  ecmwf: ModelMetricsSample;
  gfs: ModelMetricsSample;
  tempSpreadC: number | null;
  rainSpreadMm: number | null;
}

export interface DailyModelMetrics {
  minTemp: number | null;
  maxTemp: number | null;
  rainMm: number | null;
  rainChance?: number | null;
  maxWindKmh?: number | null;
  shortText?: string;
}

export interface DailyComparisonRow {
  dateKey: string;
  dayLabel: string;
  weatherNext2: DailyModelMetrics;
  ecmwf: DailyModelMetrics;
  gfs: DailyModelMetrics;
  bom: DailyModelMetrics | null;
  googleWeather?: DailyModelMetrics | null;
  meanMaxTemp: number | null;
  meanMinTemp: number | null;
  meanRainMm: number | null;
  deltaMaxTemp: number | null;
  deltaMinTemp: number | null;
  deltaRainMm: number | null;
  agreementLevel: 'HIGH' | 'MODERATE' | 'LOW';
}

export interface BomLocationInfo {
  geohash: string;
  name: string;
  state: string;
}

export interface BomWarningItem {
  id: string;
  title: string;
  shortTitle?: string;
  type?: string;
  state?: string;
  issueTime?: string;
  expiryTime?: string;
  phase?: string;
}

export interface MultiModelSpreadOverview {
  avgTempSpreadC: number | null;
  maxRainSpreadMm: number | null;
  peak24hRainConsensusMm: number | null;
  agreementLabel: 'High Agreement' | 'Moderate Spread' | 'High Divergence';
  agreementDetail: string;
}

export interface MultiModelBundle {
  location: WeatherLocation;
  hourly3h: ThreeHourlyModelRow[];
  daily7d: DailyComparisonRow[];
  bomLocation: BomLocationInfo | null;
  bomWarnings: BomWarningItem[];
  spreadOverview: MultiModelSpreadOverview;
  sourcesAvailable: {
    weatherNext2: boolean;
    ecmwf: boolean;
    gfs: boolean;
    bom: boolean;
    googleWeather: boolean;
  };
  errors: string[];
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// RainViewer Animated Radar
// ---------------------------------------------------------------------------

export interface RainViewerFrame {
  time: number;
  path: string;
  kind: 'past' | 'nowcast';
}

export interface RainViewerData {
  host: string;
  generated: number;
  frames: RainViewerFrame[];
}

// ---------------------------------------------------------------------------
// North Queensland Emergency, Flood, Road & Outage Feeds
// ---------------------------------------------------------------------------

export type EmergencyCategory =
  | 'warning'
  | 'cyclone'
  | 'qfd'
  | 'fuel'
  | 'road'
  | 'outage'
  | 'bulletin'
  | 'fire_danger'
  | 'evac'
  | 'sandbag';

export type EmergencySourceHost =
  | 'qld_arcgis'
  | 'burdekin_ims'
  | 'townsville_ims';

export interface EmergencyLayerToggles {
  corridor: boolean;
  roads: boolean;
  outages: boolean;
  warnings: boolean;
  qfd: boolean;
  support: boolean; // Fuel, Evac, Sandbags
}

export interface EmergencyFeatureItem {
  id: string;
  category: EmergencyCategory;
  source: EmergencySourceHost;
  sourceLabel: string;
  title: string;
  subtitle?: string;
  description?: string;
  status?: string;
  severity: 'critical' | 'high' | 'moderate' | 'info';
  lat: number | null;
  lng: number | null;
  geometryType?: 'Point' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon' | 'None';
  pathCoords?: LatLng[][]; // For cyclone tracks or road closure polylines
  updatedAt?: string;
  isCorridorPriority: boolean;
  corridorTags: string[];
  rawProperties?: Record<string, any>;
}

export interface EmergencyFeedStatus {
  id: string;
  label: string;
  host: EmergencySourceHost;
  status: 'ok' | 'proxied' | 'blocked' | 'empty';
  count: number;
  error?: string;
}

export interface EmergencyBundle {
  items: EmergencyFeatureItem[];
  feedStatuses: EmergencyFeedStatus[];
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Gemini AI Corridor Briefing
// ---------------------------------------------------------------------------

export interface GroundingCitation {
  title: string;
  uri: string;
}

export interface CorridorBriefingResponse {
  locationName: string;
  bullets: string[];
  rawText: string;
  citations: GroundingCitation[];
  usedSearchGrounding: boolean;
  generatedAt: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Cyclone Threat Mode & WeatherNext 3 (On-Demand)
// ---------------------------------------------------------------------------

export interface CycloneThreatDetection {
  isThreatDetected: boolean;
  reasons: string[];
  cycloneTrackCount: number;
  cycloneWarningCount: number;
}

export interface WeatherNext3HourlySample {
  timeIso: string;
  tempC: number | null;
  precipMm: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  pressureMb: number | null;
  thunderstormPct: number | null;
}

export interface WeatherNext3DailyMetrics {
  dateKey: string;
  dayLabel: string;
  minTemp: number | null;
  maxTemp: number | null;
  rainMm: number | null;
  rainChance: number | null;
  peakGustKmh: number | null;
  minPressureMb: number | null;
  peakThunderstormPct: number | null;
  shortText?: string;
}

export interface WeatherNext3Bundle {
  lat: number;
  lng: number;
  daily10d: WeatherNext3DailyMetrics[];
  hourly120h: WeatherNext3HourlySample[];
  alerts: WeatherAlert[];
  peak120hGustKmh: number | null;
  min120hPressureMb: number | null;
  max120hPressureDropMb: number | null;
  peak120hThunderstormPct: number | null;
  peak1hQpfMm: number | null;
  total120hQpfMm: number | null;
  fetchedAt: number;
  fromCache: boolean;
  source?: 'server-proxy' | 'local-key';
}

export interface GeminiCycloneSynthesis {
  locationName: string;
  headline: string;
  peakGusts: string;
  corridorWindow: string;
  rainfallRange: string;
  bruceHwyCutoffRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' | 'UNKNOWN';
  bruceHwyDetail: string;
  bullets: string[];
  citations: GroundingCitation[];
  generatedAt: string;
  model: string;
}

