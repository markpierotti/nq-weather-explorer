/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CurrentWeather, DailyForecast, HourlyForecast, LocationWeatherBundle, WeatherAlert, WeatherLocation, WeatherUnitSystem } from '../types/weather';
import { generateRealisticWeather, PRESET_LOCATIONS } from '../utils/mockWeatherData';

export interface WeatherConfig {
  hasKey: boolean;
  apiKey: string | null;
}

export async function fetchWeatherConfig(): Promise<WeatherConfig> {
  try {
    const res = await fetch('/api/weather/config');
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Could not fetch server weather config:', e);
  }
  const clientKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
  return {
    hasKey: !!clientKey,
    apiKey: clientKey,
  };
}

function degreesToCardinal(deg?: number | null): string {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 'N';
  const dirs = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

function mapWmoWeatherCode(code?: number | null, isDay = true): { text: string; type: string } {
  switch (code) {
    case 0:
      return { text: isDay ? 'Sunny' : 'Clear', type: 'CLEAR' };
    case 1:
      return { text: isDay ? 'Mostly Sunny' : 'Mostly Clear', type: 'MOSTLY_CLEAR' };
    case 2:
      return { text: 'Partly Cloudy', type: 'PARTLY_CLOUDY' };
    case 3:
      return { text: 'Overcast', type: 'CLOUDY' };
    case 45:
    case 48:
      return { text: 'Fog', type: 'FOG' };
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return { text: 'Light Drizzle', type: 'LIGHT_RAIN' };
    case 61:
    case 63:
    case 66:
      return { text: 'Rain', type: 'RAIN' };
    case 65:
    case 67:
      return { text: 'Heavy Rain', type: 'HEAVY_RAIN' };
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return { text: 'Snow', type: 'SNOW' };
    case 80:
    case 81:
      return { text: 'Showers', type: 'RAIN_SHOWERS' };
    case 82:
      return { text: 'Heavy Showers', type: 'HEAVY_RAIN' };
    case 95:
    case 96:
    case 99:
      return { text: 'Thunderstorm', type: 'THUNDERSTORM' };
    default:
      return { text: 'Partly Cloudy', type: 'PARTLY_CLOUDY' };
  }
}

/**
 * Fetches live current weather conditions (UV Index, Humidity, Dew Point, Wind Speed/Gusts/Direction,
 * Temperature, Pressure) via Open-Meteo's free keyless CORS API so `weatherBundle` is always populated
 * without consuming Google Weather API quota during routine browsing.
 */
export async function fetchKeylessWeatherBundle(
  location: WeatherLocation
): Promise<LocationWeatherBundle> {
  const { lat, lng } = location;
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat.toFixed(4))}` +
    `&longitude=${encodeURIComponent(lng.toFixed(4))}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day` +
    `&timezone=Australia%2FBrisbane`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw new Error(`Open-Meteo current HTTP ${res.status}`);
    }
    const data = await res.json();
    const c = data?.current;
    if (c && typeof c === 'object') {
      const isDay = c.is_day === 1;
      const cond = mapWmoWeatherCode(c.weather_code, isDay);
      const current: CurrentWeather = {
        temperature:
          typeof c.temperature_2m === 'number'
            ? { degrees: c.temperature_2m, unit: 'CELSIUS' }
            : undefined,
        feelsLikeTemperature:
          typeof c.apparent_temperature === 'number'
            ? { degrees: c.apparent_temperature, unit: 'CELSIUS' }
            : undefined,
        dewPoint:
          typeof c.dew_point_2m === 'number'
            ? { degrees: c.dew_point_2m, unit: 'CELSIUS' }
            : undefined,
        relativeHumidity:
          typeof c.relative_humidity_2m === 'number' ? c.relative_humidity_2m : undefined,
        windSpeed:
          typeof c.wind_speed_10m === 'number'
            ? { value: c.wind_speed_10m, unit: 'KILOMETERS_PER_HOUR' }
            : undefined,
        windDirection:
          typeof c.wind_direction_10m === 'number'
            ? {
                degrees: c.wind_direction_10m,
                cardinal: degreesToCardinal(c.wind_direction_10m),
              }
            : undefined,
        windGust:
          typeof c.wind_gusts_10m === 'number'
            ? { value: c.wind_gusts_10m, unit: 'KILOMETERS_PER_HOUR' }
            : undefined,
        precipitation:
          typeof c.precipitation === 'number'
            ? { qpf: { quantity: c.precipitation, unit: 'MILLIMETERS' } }
            : undefined,
        airPressure:
          typeof c.pressure_msl === 'number'
            ? { meanSeaLevelMillibars: c.pressure_msl }
            : undefined,
        cloudCover: typeof c.cloud_cover === 'number' ? c.cloud_cover : undefined,
        uvIndex: typeof c.uv_index === 'number' ? c.uv_index : undefined,
        weatherCondition: {
          description: { text: cond.text },
          type: cond.type,
        },
        isDaytime: isDay,
        currentTime: typeof c.time === 'string' ? c.time : undefined,
        timeZone: { id: data?.timezone || 'Australia/Brisbane' },
      };

      return {
        location,
        current,
        hourly: [],
        daily: [],
        alerts: [],
        isUnsupportedLocation: false,
        isSimulated: false,
        lastUpdated: Date.now(),
      };
    }
  } catch (err) {
    console.warn('Keyless Open-Meteo current weather fetch failed, using fallback:', err);
  }

  // Fallback to realistic local estimation if offline
  const fallback = generateRealisticWeather(location);
  return {
    ...fallback,
    daily: [],
  };
}

export async function fetchCompleteWeather(
  location: WeatherLocation,
  unitSystem: WeatherUnitSystem = 'METRIC'
): Promise<LocationWeatherBundle> {
  const { lat, lng } = location;

  console.group(
    `%c🌐 [Google Weather API] Fetching weather for ${location.name} (${lat.toFixed(4)}°, ${lng.toFixed(4)}°)`,
    'color: #0284c7; font-weight: bold; padding: 2px 4px; background: #f0f9ff; border-radius: 4px; border: 1px solid #bae6fd;'
  );

  try {
    const [currRes, hourlyRes, historyRes, dailyRes, alertsRes] = await Promise.allSettled([
      fetch(`/api/weather/current?lat=${lat}&lng=${lng}&units=${unitSystem}`).then((r) => r.json()),
      fetch(`/api/weather/forecast/hourly?lat=${lat}&lng=${lng}&hours=24&units=${unitSystem}`).then((r) => r.json()),
      fetch(`/api/weather/history/hourly?lat=${lat}&lng=${lng}&hours=24&units=${unitSystem}`).then((r) => r.json()),
      fetch(`/api/weather/forecast/daily?lat=${lat}&lng=${lng}&days=10&units=${unitSystem}`).then((r) => r.json()),
      fetch(`/api/weather/alerts?lat=${lat}&lng=${lng}`).then((r) => r.json()),
    ]);

    const currData = currRes.status === 'fulfilled' ? currRes.value : null;
    const hourlyData = hourlyRes.status === 'fulfilled' ? hourlyRes.value : null;
    const historyData = historyRes.status === 'fulfilled' ? historyRes.value : null;
    const dailyData = dailyRes.status === 'fulfilled' ? dailyRes.value : null;
    const alertsData = alertsRes.status === 'fulfilled' ? alertsRes.value : null;

    console.log(
      '%c1. Current Conditions (Global):',
      'font-weight: bold; color: #0369a1;',
      `https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&unitsSystem=${unitSystem}`,
      currData
    );

    console.log(
      '%c2. Hourly Forecast (Global):',
      'font-weight: bold; color: #0369a1;',
      `https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude=${lat}&location.longitude=${lng}&hours=24&unitsSystem=${unitSystem}`,
      hourlyData
    );

    console.log(
      '%c3. Hourly History Past Weather (Global):',
      'font-weight: bold; color: #0369a1;',
      `https://weather.googleapis.com/v1/history/hours:lookup?location.latitude=${lat}&location.longitude=${lng}&hours=24&unitsSystem=${unitSystem}`,
      historyData
    );

    console.log(
      '%c4. Daily 10-Day Forecast (Global):',
      'font-weight: bold; color: #0369a1;',
      `https://weather.googleapis.com/v1/forecast/days:lookup?location.latitude=${lat}&location.longitude=${lng}&days=10&unitsSystem=${unitSystem}`,
      dailyData
    );

    console.groupEnd();

    // Check if the API explicitly returned 404 or unsupported location error
    const isUnsupported =
      currData?.apiStatus === 404 ||
      currData?.status === 404 ||
      currData?.error?.code === 404 ||
      currData?.apiError?.code === 404 ||
      currData?.apiError?.status === 'NOT_FOUND' ||
      (typeof currData?.apiError?.message === 'string' && currData.apiError.message.toLowerCase().includes('not supported')) ||
      (typeof currData?.error?.message === 'string' && currData.error.message.toLowerCase().includes('not supported'));

    if (isUnsupported) {
      const errorMsg =
        currData?.apiError?.message ||
        currData?.error?.message ||
        'Information is not supported for this location by Google Maps Weather API. Please select a supported location.';

      return {
        location,
        current: undefined,
        hourly: [],
        historyHours: [],
        daily: [],
        alerts: [],
        minutes: undefined,
        isUnsupportedLocation: true,
        errorMessage: errorMsg,
        coverage: {
          minutesForecastSupported: false,
          isOutOfCoverage: true,
          notes: errorMsg,
        },
        isSimulated: false,
        lastUpdated: Date.now(),
      };
    }

    // Check if API returned live Google Maps Weather API objects
    if (currData && !currData.error && currData.temperature) {
      const current: CurrentWeather = currData;
      const hourly: HourlyForecast[] = hourlyData?.forecastHours || [];
      const historyHours: HourlyForecast[] = historyData?.historyHours || [];
      const daily: DailyForecast[] = dailyData?.forecastDays || [];
      const alerts: WeatherAlert[] = alertsData?.weatherAlerts || [];
      
      return {
        location,
        current,
        hourly,
        historyHours,
        daily,
        alerts,
        isSimulated: false,
        lastUpdated: Date.now(),
      };
    }
  } catch (err: any) {
    console.warn('Weather API request error:', err);
    console.groupEnd();
  }

  // If there is an API error or unsupported location, return error bundle
  return {
    location,
    current: undefined,
    hourly: [],
    daily: [],
    alerts: [],
    isUnsupportedLocation: true,
    errorMessage: 'No meteorological data returned for this location by Google Maps Weather API.',
    coverage: {
      minutesForecastSupported: false,
      isOutOfCoverage: true,
      notes: 'Out of coverage or unsupported by Google Maps Weather API.',
    },
    isSimulated: false,
    lastUpdated: Date.now(),
  };
}

export async function geocodeSearch(query: string): Promise<WeatherLocation | null> {
  if (!query || query.trim().length === 0) return null;

  try {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const parts = item.formatted_address.split(',').map((s: string) => s.trim());
        const name = parts[0] || query;
        const country = parts[parts.length - 1] || '';
        const region = parts.length > 2 ? parts[1] : undefined;

        return {
          id: `loc-${item.geometry.location.lat.toFixed(4)}-${item.geometry.location.lng.toFixed(4)}`,
          name,
          country,
          region,
          lat: item.geometry.location.lat,
          lng: item.geometry.location.lng,
        };
      }
    }
  } catch (e) {
    console.warn('Geocoding fetch failed:', e);
  }

  // Fallback to preset search match
  const q = query.toLowerCase();
  const found = PRESET_LOCATIONS.find(
    (l) => l.name.toLowerCase().includes(q) || l.country.toLowerCase().includes(q) || (l.region && l.region.toLowerCase().includes(q))
  );

  return found || null;
}

export async function fetchPlaceDetails(
  placeId: string,
  placesLib?: any
): Promise<WeatherLocation | null> {
  try {
    if (placesLib?.Place) {
      const place = new placesLib.Place({ id: placeId });
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'addressComponents', 'types', 'id'],
      });

      const lat = place.location?.lat();
      const lng = place.location?.lng();

      if (lat !== undefined && lng !== undefined) {
        let city = '';
        let region = '';
        let country = '';

        for (const comp of place.addressComponents || []) {
          if (comp.types.includes('locality') || comp.types.includes('postal_town') || comp.types.includes('sublocality')) {
            city = comp.longText || comp.shortText;
          }
          if (comp.types.includes('administrative_area_level_1')) {
            region = comp.shortText || comp.longText;
          }
          if (comp.types.includes('country')) {
            country = comp.longText || comp.shortText;
          }
        }

        const name = place.displayName || city || (place.formattedAddress ? place.formattedAddress.split(',')[0] : 'Selected Location');

        return {
          id: `place-${placeId}`,
          name,
          country: country || (place.formattedAddress ? place.formattedAddress.split(',').pop()?.trim() : ''),
          region: region || undefined,
          lat,
          lng,
        };
      }
    }
  } catch (err) {
    console.warn('Place.fetchFields error:', err);
  }

  // Fallback to server geocode proxy
  try {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(placeId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const lat = item.geometry?.location?.lat;
        const lng = item.geometry?.location?.lng;
        if (lat !== undefined && lng !== undefined) {
          let city = '';
          let region = '';
          let country = '';
          for (const comp of item.address_components || []) {
            if (comp.types.includes('locality') || comp.types.includes('postal_town')) {
              city = comp.long_name;
            }
            if (comp.types.includes('administrative_area_level_1')) {
              region = comp.short_name || comp.long_name;
            }
            if (comp.types.includes('country')) {
              country = comp.long_name;
            }
          }
          const parts = item.formatted_address ? item.formatted_address.split(',').map((s: string) => s.trim()) : [];
          return {
            id: `place-${placeId}`,
            name: city || parts[0] || item.formatted_address,
            country: country || (parts.length > 0 ? parts[parts.length - 1] : ''),
            region: region || (parts.length > 2 ? parts[1] : undefined),
            lat,
            lng,
          };
        }
      }
    }
  } catch (e) {
    console.warn('Geocode fallback error:', e);
  }

  return null;
}

/**
 * Search and resolve real place name on map click using Places API (New) searchNearby
 */
export async function searchPlaceByCoordinates(
  lat: number,
  lng: number,
  placesLib?: any
): Promise<WeatherLocation> {
  // 1. Try client-side Places API (New) Place.searchNearby if available
  if (placesLib?.Place?.searchNearby) {
    try {
      const { places } = await placesLib.Place.searchNearby({
        fields: [
          'id',
          'displayName',
          'formattedAddress',
          'shortFormattedAddress',
          'location',
          'addressComponents',
          'types',
          'primaryTypeDisplayName',
        ],
        locationRestriction: {
          center: { lat, lng },
          radius: 15000,
        },
        maxResultCount: 8,
      });

      if (places && places.length > 0) {
        // Find the best locality/city/town/place from results
        for (const place of places) {
          let city = '';
          let region = '';
          let country = '';

          for (const comp of place.addressComponents || []) {
            if (
              comp.types?.includes('locality') ||
              comp.types?.includes('postal_town') ||
              comp.types?.includes('sublocality_level_1') ||
              comp.types?.includes('sublocality')
            ) {
              city = comp.longText || comp.shortText || '';
            }
            if (comp.types?.includes('administrative_area_level_1')) {
              region = comp.shortText || comp.longText || '';
            }
            if (comp.types?.includes('country')) {
              country = comp.longText || comp.shortText || '';
            }
          }

          const placeDisplayName =
            typeof place.displayName === 'object' && place.displayName !== null
              ? (place.displayName as any).text
              : place.displayName;

          const chosenName =
            city ||
            placeDisplayName ||
            (place.shortFormattedAddress ? place.shortFormattedAddress.split(',')[0] : '') ||
            (place.formattedAddress ? place.formattedAddress.split(',')[0] : '');

          if (chosenName) {
            return {
              id: place.id ? `place-${place.id}` : `loc-${lat.toFixed(4)}-${lng.toFixed(4)}`,
              name: chosenName,
              country: country || (place.formattedAddress ? place.formattedAddress.split(',').pop()?.trim() : ''),
              region: region || undefined,
              lat,
              lng,
            };
          }
        }
      }
    } catch (clientErr) {
      console.debug('Client-side Places API (New) searchNearby error, falling back to server proxy:', clientErr);
    }
  }

  // 2. Try server-side Places API (New) nearby proxy
  try {
    const res = await fetch(`/api/places/nearby?lat=${lat}&lng=${lng}&radius=15000`);
    if (res.ok) {
      const data = await res.json();
      const places = data.places || [];
      if (Array.isArray(places) && places.length > 0) {
        for (const p of places) {
          let city = '';
          let region = '';
          let country = '';

          for (const comp of p.addressComponents || []) {
            const types = comp.types || [];
            if (
              types.includes('locality') ||
              types.includes('postal_town') ||
              types.includes('sublocality_level_1') ||
              types.includes('sublocality')
            ) {
              city = comp.longText || comp.shortText || '';
            }
            if (types.includes('administrative_area_level_1')) {
              region = comp.shortText || comp.longText || '';
            }
            if (types.includes('country')) {
              country = comp.longText || comp.shortText || '';
            }
          }

          const placeDisplayName = p.displayName?.text || p.displayName;
          const chosenName =
            city ||
            placeDisplayName ||
            (p.shortFormattedAddress ? p.shortFormattedAddress.split(',')[0] : '') ||
            (p.formattedAddress ? p.formattedAddress.split(',')[0] : '');

          if (chosenName) {
            return {
              id: p.id ? `place-${p.id}` : `loc-${lat.toFixed(4)}-${lng.toFixed(4)}`,
              name: chosenName,
              country: country || (p.formattedAddress ? p.formattedAddress.split(',').pop()?.trim() : ''),
              region: region || undefined,
              lat,
              lng,
            };
          }
        }
      }
    }
  } catch (serverPlacesErr) {
    console.warn('Server Places API (New) nearby search error:', serverPlacesErr);
  }

  // 3. Fallback to Reverse Geocoding
  return reverseGeocode(lat, lng);
}

export async function reverseGeocode(lat: number, lng: number): Promise<WeatherLocation> {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        let city = '';
        let region = '';
        let country = '';

        for (const comp of item.address_components || []) {
          if (comp.types.includes('locality') || comp.types.includes('postal_town') || comp.types.includes('sublocality')) {
            city = comp.long_name;
          }
          if (comp.types.includes('administrative_area_level_1')) {
            region = comp.short_name || comp.long_name;
          }
          if (comp.types.includes('country')) {
            country = comp.long_name;
          }
        }

        const parts = item.formatted_address ? item.formatted_address.split(',').map((s: string) => s.trim()) : [];
        const name = city || parts[0] || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;

        return {
          id: item.place_id ? `place-${item.place_id}` : `loc-${lat.toFixed(4)}-${lng.toFixed(4)}`,
          name,
          country: country || (parts.length > 0 ? parts[parts.length - 1] : ''),
          region: region || (parts.length > 2 ? parts[1] : undefined),
          lat,
          lng,
        };
      }
    }
  } catch (e) {
    console.warn('Reverse geocoding failed:', e);
  }

  return {
    id: `loc-${lat.toFixed(4)}-${lng.toFixed(4)}`,
    name: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
    country: '',
    lat,
    lng,
  };
}
