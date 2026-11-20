/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CurrentWeather,
  DailyForecast,
  HourlyForecast,
  LatLng,
  LocationWeatherBundle,
  WeatherAlert,
  WeatherLocation,
  WeatherUnitSystem,
} from '../types/weather';

// Default presets focused on North Queensland & the Ayr ↔ Giru ↔ Townsville corridor
export const PRESET_LOCATIONS: WeatherLocation[] = [
  {
    id: 'ayr',
    name: 'Ayr / Burdekin',
    searchQuery: 'Ayr',
    country: 'Australia',
    region: 'QLD',
    lat: -19.574,
    lng: 147.406,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'townsville',
    name: 'Townsville',
    searchQuery: 'Townsville',
    country: 'Australia',
    region: 'QLD',
    lat: -19.259,
    lng: 146.817,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'giru',
    name: 'Giru',
    searchQuery: 'Giru',
    country: 'Australia',
    region: 'QLD',
    lat: -19.514,
    lng: 147.106,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'home-hill',
    name: 'Home Hill',
    searchQuery: 'Home Hill',
    country: 'Australia',
    region: 'QLD',
    lat: -19.666,
    lng: 147.412,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'ingham',
    name: 'Ingham',
    searchQuery: 'Ingham',
    country: 'Australia',
    region: 'QLD',
    lat: -18.649,
    lng: 146.161,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'charters-towers',
    name: 'Charters Towers',
    searchQuery: 'Charters Towers',
    country: 'Australia',
    region: 'QLD',
    lat: -20.076,
    lng: 146.261,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'bowen',
    name: 'Bowen',
    searchQuery: 'Bowen',
    country: 'Australia',
    region: 'QLD',
    lat: -20.013,
    lng: 148.248,
    timezone: 'Australia/Brisbane',
  },
  {
    id: 'cairns',
    name: 'Cairns',
    searchQuery: 'Cairns',
    country: 'Australia',
    region: 'QLD',
    lat: -16.920,
    lng: 145.771,
    timezone: 'Australia/Brisbane',
  },
];

// Bruce Highway (A1) corridor polyline from Home Hill -> Ayr -> Brandon -> Giru -> Nome -> Townsville
export const BRUCE_HWY_CORRIDOR_PATH: LatLng[] = [
  { lat: -19.666, lng: 147.412 }, // Home Hill (Burdekin Bridge South)
  { lat: -19.642, lng: 147.402 }, // Burdekin River Bridge
  { lat: -19.574, lng: 147.406 }, // Ayr
  { lat: -19.555, lng: 147.358 }, // Brandon
  { lat: -19.538, lng: 147.245 }, // Shirbourne / Bruce Hwy
  { lat: -19.514, lng: 147.106 }, // Giru / Haughton River
  { lat: -19.445, lng: 147.008 }, // Woodstock Turnoff / Cromarty
  { lat: -19.372, lng: 146.935 }, // Alligator Creek
  { lat: -19.333, lng: 146.885 }, // Nome
  { lat: -19.295, lng: 146.835 }, // Cluden / Stuart
  { lat: -19.259, lng: 146.817 }, // Townsville
];

export const CORRIDOR_KEYWORDS = [
  'bruce hwy',
  'bruce highway',
  'ayr',
  'home hill',
  'giru',
  'townsville',
  'burdekin',
  'brandon',
  'haughton',
  'alligator creek',
  'nome',
  'cluden',
  'stuart',
  'ross river',
  'bohle',
  'flinders hwy',
];

export function matchCorridorTags(text: string): string[] {
  const lower = (text || '').toLowerCase();
  const matched: string[] = [];
  if (lower.includes('bruce hwy') || lower.includes('bruce highway')) matched.push('Bruce Hwy');
  if (lower.includes('ayr')) matched.push('Ayr');
  if (lower.includes('home hill')) matched.push('Home Hill');
  if (lower.includes('giru') || lower.includes('haughton')) matched.push('Giru');
  if (lower.includes('townsville')) matched.push('Townsville');
  if (lower.includes('burdekin') && !matched.includes('Ayr')) matched.push('Burdekin');
  if (lower.includes('brandon') || lower.includes('alligator creek') || lower.includes('nome')) {
    if (!matched.includes('Bruce Hwy')) matched.push('Corridor');
  }
  return matched;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function generateRealisticWeather(
  location: WeatherLocation,
  unitSystem: WeatherUnitSystem = 'METRIC'
): LocationWeatherBundle {
  const isMetric = unitSystem === 'METRIC';
  const now = new Date();
  const seed = Math.abs(Math.round(location.lat * 100) + Math.round(location.lng * 100));

  const latFactor = Math.cos((location.lat * Math.PI) / 180);
  const baseTempC = Math.round(24 * latFactor + (pseudoRandom(seed) * 10 - 5));
  const temp = isMetric ? baseTempC : Math.round((baseTempC * 9) / 5 + 32);
  const feelsLike = temp + (pseudoRandom(seed + 1) > 0.5 ? 2 : -2);

  const conditionPool = [
    { type: 'CLEAR', text: 'Clear Sky', icon: 'https://maps.gstatic.com/weather/icons/v1/sunny' },
    { type: 'PARTLY_CLOUDY', text: 'Partly Cloudy', icon: 'https://maps.gstatic.com/weather/icons/v1/partly_cloudy' },
    { type: 'MOSTLY_CLOUDY', text: 'Mostly Cloudy', icon: 'https://maps.gstatic.com/weather/icons/v1/mostly_cloudy' },
    { type: 'SCATTERED_SHOWERS', text: 'Scattered Showers', icon: 'https://maps.gstatic.com/weather/icons/v1/scattered_showers' },
    { type: 'RAIN', text: 'Light to Moderate Rain', icon: 'https://maps.gstatic.com/weather/icons/v1/rain' },
    { type: 'THUNDERSTORM', text: 'Thunderstorms', icon: 'https://maps.gstatic.com/weather/icons/v1/thunderstorms' },
  ];

  const condIdx = Math.floor(pseudoRandom(seed + 2) * conditionPool.length);
  const condition = conditionPool[condIdx];
  const precipProb = condition.type === 'RAIN' ? 85 : condition.type === 'SCATTERED_SHOWERS' ? 55 : condition.type === 'THUNDERSTORM' ? 90 : 15;
  const windSpeedVal = Math.round(12 + pseudoRandom(seed + 3) * 18);
  const windSpeed = isMetric ? windSpeedVal : Math.round(windSpeedVal * 0.621371);
  const humidity = Math.round(45 + pseudoRandom(seed + 4) * 45);
  const pressure = Math.round(1012 + (pseudoRandom(seed + 5) * 16 - 8));
  const uvIndex = Math.max(1, Math.min(11, Math.round(8 * latFactor * pseudoRandom(seed + 6))));
  const cloudCover = condition.type === 'CLEAR' ? 10 : condition.type === 'PARTLY_CLOUDY' ? 40 : 85;

  const current: CurrentWeather = {
    temperature: { degrees: temp, unit: isMetric ? 'CELSIUS' : 'FAHRENHEIT' },
    feelsLikeTemperature: { degrees: feelsLike, unit: isMetric ? 'CELSIUS' : 'FAHRENHEIT' },
    dewPoint: { degrees: Math.round(temp - ((100 - humidity) / 5)), unit: isMetric ? 'CELSIUS' : 'FAHRENHEIT' },
    relativeHumidity: humidity,
    windSpeed: { value: windSpeed, unit: isMetric ? 'KILOMETERS_PER_HOUR' : 'MILES_PER_HOUR' },
    windDirection: { degrees: Math.round(pseudoRandom(seed + 7) * 360), cardinal: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(pseudoRandom(seed + 7) * 8)] },
    windGust: { value: windSpeed + 8, unit: isMetric ? 'KILOMETERS_PER_HOUR' : 'MILES_PER_HOUR' },
    precipitation: {
      probability: { percent: precipProb },
      qpf: { quantity: precipProb > 50 ? +(pseudoRandom(seed + 8) * 3.5).toFixed(1) : 0, unit: isMetric ? 'MILLIMETERS' : 'INCHES' },
      type: precipProb > 50 ? 'RAIN' : 'NONE',
    },
    airPressure: { meanSeaLevelMillibars: pressure },
    cloudCover,
    uvIndex,
    visibility: { distance: isMetric ? 10 : 6.2, unit: isMetric ? 'KILOMETERS' : 'MILES' },
    weatherCondition: {
      type: condition.type,
      description: { text: condition.text },
      iconBaseUri: condition.icon,
    },
    isDaytime: true,
    currentTime: now.toISOString(),
    timeZone: { id: location.timezone || 'Australia/Brisbane' },
    sunAndMoon: {
      sunrise: '05:25 AM',
      sunset: '06:22 PM',
      moonPhase: 'Waxing Gibbous',
      moonrise: '03:45 PM',
      moonset: '04:12 AM',
    },
  };

  const hourly: HourlyForecast[] = Array.from({ length: 24 }).map((_, i) => {
    const hourDate = new Date(now.getTime() + i * 3600 * 1000);
    const hour = hourDate.getHours();
    const tempDelta = Math.sin(((hour - 6) / 24) * 2 * Math.PI) * 4;
    const hTemp = Math.round(temp + tempDelta + (pseudoRandom(seed + i * 13) * 2 - 1));
    const hPrecip = Math.max(0, Math.min(100, Math.round(precipProb + Math.sin(i / 3) * 25)));
    const hCond = hPrecip > 60 ? conditionPool[4] : hPrecip > 35 ? conditionPool[3] : hour >= 6 && hour <= 20 ? conditionPool[1] : conditionPool[0];

    return {
      interval: {
        startTime: hourDate.toISOString(),
        endTime: new Date(hourDate.getTime() + 3600 * 1000).toISOString(),
      },
      displayDateTime: {
        year: hourDate.getFullYear(),
        month: hourDate.getMonth() + 1,
        day: hourDate.getDate(),
        hours: hour,
        minutes: 0,
        seconds: 0,
      },
      temperature: { degrees: hTemp },
      feelsLikeTemperature: { degrees: hTemp + 1 },
      precipitation: {
        probability: { percent: hPrecip },
        qpf: { quantity: hPrecip > 50 ? +(pseudoRandom(seed + i * 7) * 2.2).toFixed(1) : 0 },
        type: hPrecip > 50 ? 'RAIN' : 'NONE',
      },
      weatherCondition: {
        type: hCond.type,
        description: { text: hCond.text },
        iconBaseUri: hCond.icon,
      },
      windSpeed: { value: Math.round(windSpeed + (pseudoRandom(seed + i) * 6 - 3)) },
      windDirection: { cardinal: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(pseudoRandom(seed + i * 2) * 8)] },
      relativeHumidity: Math.min(100, Math.max(20, Math.round(humidity - tempDelta * 2))),
      uvIndex: hour >= 10 && hour <= 16 ? Math.round(uvIndex * (1 - Math.abs(hour - 13) / 4)) : 0,
      cloudCover: Math.round(cloudCover + (pseudoRandom(seed + i * 5) * 20 - 10)),
      isDaytime: hour >= 6 && hour <= 20,
    };
  });

  const daily: DailyForecast[] = Array.from({ length: 10 }).map((_, i) => {
    const dayDate = new Date(now.getTime() + i * 86400 * 1000);
    const dayTempMax = Math.round(temp + 3 + (pseudoRandom(seed + i * 21) * 6 - 3));
    const dayTempMin = Math.round(temp - 4 + (pseudoRandom(seed + i * 31) * 4 - 2));
    const dPrecip = Math.round(Math.max(5, Math.min(95, pseudoRandom(seed + i * 41) * 100)));
    const dCond = dPrecip > 65 ? conditionPool[4] : dPrecip > 35 ? conditionPool[3] : conditionPool[Math.floor(pseudoRandom(seed + i) * 3)];

    return {
      interval: {
        startTime: dayDate.toISOString(),
        endTime: new Date(dayDate.getTime() + 86400 * 1000).toISOString(),
      },
      displayDate: {
        year: dayDate.getFullYear(),
        month: dayDate.getMonth() + 1,
        day: dayDate.getDate(),
      },
      maxTemperature: { degrees: dayTempMax },
      minTemperature: { degrees: dayTempMin },
      precipitation: {
        probability: { percent: dPrecip },
        qpf: { quantity: dPrecip > 50 ? +(pseudoRandom(seed + i) * 5.0).toFixed(1) : 0 },
      },
      daytimeForecast: {
        weatherCondition: {
          type: dCond.type,
          description: { text: dCond.text },
          iconBaseUri: dCond.icon,
        },
        relativeHumidity: humidity,
        windSpeed: { value: windSpeed },
        windDirection: { cardinal: 'SE' },
        cloudCover,
        precipitation: { probability: { percent: dPrecip } },
      },
      nighttimeForecast: {
        weatherCondition: {
          type: 'PARTLY_CLOUDY',
          description: { text: 'Partly Cloudy Night' },
          iconBaseUri: 'https://maps.gstatic.com/weather/icons/v1/partly_cloudy_night',
        },
        relativeHumidity: Math.min(100, humidity + 15),
        windSpeed: { value: Math.max(5, windSpeed - 4) },
        windDirection: { cardinal: 'ESE' },
        cloudCover: Math.max(10, cloudCover - 15),
        precipitation: { probability: { percent: Math.round(dPrecip * 0.7) } },
      },
      sunAndMoon: {
        sunrise: '05:25 AM',
        sunset: '06:22 PM',
        moonPhase: ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'][i % 8],
      },
    };
  });

  const alerts: WeatherAlert[] = [];
  if (precipProb >= 80) {
    alerts.push({
      alertId: `alert-${location.id}-${now.getDate()}`,
      headline: `Special Weather Statement: Moderate to Heavy Rainfall in ${location.name}`,
      description: `Meteorological radar detects localized convective precipitation cells moving across the ${location.region || location.name} area.`,
      severity: 'MODERATE',
      urgency: 'EXPECTED',
      certainty: 'LIKELY',
      effectiveTime: now.toISOString(),
      expireTime: new Date(now.getTime() + 6 * 3600 * 1000).toISOString(),
      eventDescription: 'Precipitation & Wind Advisory',
      areas: [location.name],
      senderName: 'Regional Weather Service',
    });
  }

  return {
    location,
    current,
    hourly,
    daily,
    alerts,
    isSimulated: true,
    lastUpdated: Date.now(),
  };
}
