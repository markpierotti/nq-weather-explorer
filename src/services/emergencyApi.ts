/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EmergencyBundle,
  EmergencyCategory,
  EmergencyFeatureItem,
  EmergencyFeedResponse,
  EmergencyFeedStatus,
  EmergencySourceHost,
  LatLng,
} from '../types/weather';
import { matchCorridorTags } from '../utils/mockWeatherData';

// North Queensland bounding box: 145.5,-21.2,148.6,-17.8
const NQ_BBOX = {
  minLon: 145.5,
  minLat: -21.2,
  maxLon: 148.6,
  maxLat: -17.8,
};

export const DEFAULT_EMERGENCY_PROXY = '/api/emergency/proxy?url=';

function inNqBbox(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= NQ_BBOX.minLat &&
    lat <= NQ_BBOX.maxLat &&
    lng >= NQ_BBOX.minLon &&
    lng <= NQ_BBOX.maxLon
  );
}

/**
 * Safely parse potentially double-encoded JSON responses from Guardian IMS endpoints.
 */
function parsePossiblyDoubleEncodedJson(raw: unknown): any {
  let parsed: any = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (!trimmed) return null;
      parsed = JSON.parse(trimmed);
    } else {
      break;
    }
  }
  return parsed;
}

function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  const base = proxyBase.trim();
  if (!base) return targetUrl;
  if (base.endsWith('=') || base.includes('?url=')) {
    return `${base}${encodeURIComponent(targetUrl)}`;
  }
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}url=${encodeURIComponent(targetUrl)}`;
}

async function fetchDirectOrProxied(
  url: string,
  proxyBase: string
): Promise<{ data: any; mode: 'ok' | 'proxied' | 'blocked'; error?: string }> {
  const trimmedProxy = proxyBase.trim();

  // When using the built-in server proxy (/api/emergency/proxy?url=), go straight through server proxy
  // so Burdekin & Townsville /dashboard/* feeds load reliably without browser CORS failures.
  if (trimmedProxy.startsWith('/')) {
    try {
      const proxiedUrl = buildProxyUrl(trimmedProxy, url);
      const res = await fetch(proxiedUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const text = await res.text();
        return { data: parsePossiblyDoubleEncodedJson(text), mode: 'proxied' };
      }
      return { data: null, mode: 'blocked', error: `Server proxy HTTP ${res.status}` };
    } catch (err: any) {
      return { data: null, mode: 'blocked', error: err?.message || 'Server proxy failed' };
    }
  }

  // Otherwise try direct fetch first -> fallback to custom proxy URL
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6500) });
    if (res.ok) {
      const text = await res.text();
      return { data: parsePossiblyDoubleEncodedJson(text), mode: 'ok' };
    }
  } catch {
    // Expected CORS or network block inside browser -> fall back to proxy
  }

  if (trimmedProxy) {
    try {
      const proxiedUrl = buildProxyUrl(trimmedProxy, url);
      const res = await fetch(proxiedUrl, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const text = await res.text();
        return { data: parsePossiblyDoubleEncodedJson(text), mode: 'proxied' };
      }
      return { data: null, mode: 'blocked', error: `Proxy HTTP ${res.status}` };
    } catch (err: any) {
      return { data: null, mode: 'blocked', error: err?.message || 'Proxy fetch failed' };
    }
  }

  return { data: null, mode: 'blocked', error: 'CORS blocked and no proxy configured' };
}

function extractGeometryCentroidAndPaths(geom: any): {
  lat: number | null;
  lng: number | null;
  geometryType: EmergencyFeatureItem['geometryType'];
  pathCoords?: LatLng[][];
} {
  if (!geom || !geom.type) {
    return { lat: null, lng: null, geometryType: 'None' };
  }

  if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    const lng = Number(geom.coordinates[0]);
    const lat = Number(geom.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, geometryType: 'Point' };
    }
  }

  if (geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    const pts: LatLng[] = geom.coordinates
      .map((c: any) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length > 0) {
      const mid = pts[Math.floor(pts.length / 2)];
      return { lat: mid.lat, lng: mid.lng, geometryType: 'LineString', pathCoords: [pts] };
    }
  }

  if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    const paths: LatLng[][] = geom.coordinates
      .map((line: any[]) =>
        Array.isArray(line)
          ? line
              .map((c: any) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
              .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          : []
      )
      .filter((p: LatLng[]) => p.length > 0);
    if (paths.length > 0) {
      const mid = paths[0][Math.floor(paths[0].length / 2)];
      return { lat: mid.lat, lng: mid.lng, geometryType: 'MultiLineString', pathCoords: paths };
    }
  }

  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0])) {
    const ring: LatLng[] = geom.coordinates[0]
      .map((c: any) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (ring.length > 0) {
      const avgLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
      const avgLng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
      return { lat: avgLat, lng: avgLng, geometryType: 'Polygon', pathCoords: [ring] };
    }
  }

  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0]?.[0])) {
    const ring: LatLng[] = geom.coordinates[0][0]
      .map((c: any) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (ring.length > 0) {
      const avgLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
      const avgLng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
      return { lat: avgLat, lng: avgLng, geometryType: 'MultiPolygon', pathCoords: [ring] };
    }
  }

  return { lat: null, lng: null, geometryType: 'None' };
}

function inferSeverity(category: EmergencyCategory, props: Record<string, any>): EmergencyFeatureItem['severity'] {
  const txt = JSON.stringify(props).toLowerCase();
  if (
    category === 'cyclone' ||
    txt.includes('emergency warning') ||
    txt.includes('extreme') ||
    txt.includes('catastrophic') ||
    txt.includes('road closed') ||
    txt.includes('flooded')
  ) {
    return 'critical';
  }
  if (
    category === 'warning' ||
    category === 'qfd' ||
    category === 'road' ||
    txt.includes('watch and act') ||
    txt.includes('major') ||
    txt.includes('unplanned')
  ) {
    return 'high';
  }
  if (category === 'outage' || category === 'fire_danger' || category === 'bulletin') {
    return 'moderate';
  }
  return 'info';
}

function makeItem(
  id: string,
  category: EmergencyCategory,
  source: EmergencySourceHost,
  sourceLabel: string,
  title: string,
  opts: {
    subtitle?: string;
    description?: string;
    status?: string;
    lat: number | null;
    lng: number | null;
    geometryType?: EmergencyFeatureItem['geometryType'];
    pathCoords?: LatLng[][];
    updatedAt?: string;
    rawProperties?: Record<string, any>;
  }
): EmergencyFeatureItem {
  const combinedText = `${title} ${opts.subtitle || ''} ${opts.description || ''} ${JSON.stringify(opts.rawProperties || {})}`;
  const corridorTags = matchCorridorTags(combinedText);
  return {
    id,
    category,
    source,
    sourceLabel,
    title,
    subtitle: opts.subtitle,
    description: opts.description,
    status: opts.status,
    severity: inferSeverity(category, opts.rawProperties || { title, status: opts.status }),
    lat: opts.lat,
    lng: opts.lng,
    geometryType: opts.geometryType || (opts.lat !== null && opts.lng !== null ? 'Point' : 'None'),
    pathCoords: opts.pathCoords,
    updatedAt: opts.updatedAt,
    isCorridorPriority: corridorTags.length > 0,
    corridorTags,
    rawProperties: opts.rawProperties,
  };
}

function normalizeGeoJsonFeatures(
  geojson: any,
  feedId: string,
  category: EmergencyCategory,
  source: EmergencySourceHost,
  sourceLabel: string,
  filterBbox: boolean
): EmergencyFeatureItem[] {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const items: EmergencyFeatureItem[] = [];

  features.forEach((f: any, idx: number) => {
    const props = f?.properties || {};
    const geomInfo = extractGeometryCentroidAndPaths(f?.geometry);

    // Fallback property-based lat/lng if geometry missing
    let lat = geomInfo.lat;
    let lng = geomInfo.lng;
    if (lat === null || lng === null) {
      const pLat = Number(props.lat ?? props.Lat ?? props.latitude ?? props.Latitude);
      const pLng = Number(props.lon ?? props.lng ?? props.Long ?? props.longitude ?? props.Longitude);
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        lat = pLat;
        lng = pLng;
      }
    }

    if (filterBbox && lat !== null && lng !== null && !inNqBbox(lat, lng)) {
      return;
    }

    const title =
      props.title ||
      props.Title ||
      props.RoadName ||
      props.road_name ||
      props.IncidentType ||
      props.Event ||
      props.Name ||
      props.name ||
      props.SiteName ||
      props.StationName ||
      props.Locality ||
      props.WarningTitle ||
      props.Headline ||
      `${sourceLabel} Event #${idx + 1}`;

    const subtitle =
      props.Suburb ||
      props.Locality ||
      props.RoadClosureStatus ||
      props.Status ||
      props.status ||
      props.AlertLevel ||
      props.CurrentStatus ||
      props.Category ||
      props.Area ||
      undefined;

    const description =
      props.Description ||
      props.description ||
      props.Details ||
      props.Advice ||
      props.Message ||
      props.Impact ||
      props.ClosureReason ||
      props.FuelAvailability ||
      undefined;

    const status =
      props.Status ||
      props.status ||
      props.RoadClosureStatus ||
      props.CurrentStatus ||
      props.AlertLevel ||
      props.OpenStatus ||
      undefined;

    const updatedAt =
      props.LastUpdated ||
      props.Updated ||
      props.updated ||
      props.StartDate ||
      props.IssueTime ||
      props.ResponseTime ||
      undefined;

    items.push(
      makeItem(`${feedId}-${f.id || idx}`, category, source, sourceLabel, String(title), {
        subtitle: subtitle ? String(subtitle) : undefined,
        description: description ? String(description) : undefined,
        status: status ? String(status) : undefined,
        lat,
        lng,
        geometryType: geomInfo.geometryType,
        pathCoords: geomInfo.pathCoords,
        updatedAt: updatedAt ? String(updatedAt) : undefined,
        rawProperties: props,
      })
    );
  });

  return items;
}

/**
 * Parse Ergon outages with mandatory swapped coordinate fix:
 * Plain JSON entries in ergonOutages have Lat and Long swapped at source:
 * lat = parseFloat(entry.Long), lon = parseFloat(entry.Lat)
 */
function normalizeErgonOutages(
  raw: any,
  feedId: string,
  source: EmergencySourceHost,
  sourceLabel: string
): EmergencyFeatureItem[] {
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.features)
    ? raw.features
    : Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.outages)
    ? raw.outages
    : [];

  if (Array.isArray(raw?.features)) {
    return normalizeGeoJsonFeatures(raw, feedId, 'outage', source, sourceLabel, true);
  }

  const items: EmergencyFeatureItem[] = [];
  entries.forEach((entry: any, idx: number) => {
    // Swapped source fields: Long holds latitude (~ -19), Lat holds longitude (~ 147)
    let lat = Number.parseFloat(String(entry.Long ?? entry.long ?? entry.lng ?? ''));
    let lng = Number.parseFloat(String(entry.Lat ?? entry.lat ?? ''));

    // Safety check: if someone unswapped them upstream, verify negative ~ -19 and positive ~ 147
    if (!(lat < -9 && lat > -30 && lng > 135 && lng < 155)) {
      const altLat = Number.parseFloat(String(entry.Lat ?? entry.lat ?? ''));
      const altLng = Number.parseFloat(String(entry.Long ?? entry.long ?? entry.lng ?? ''));
      if (altLat < -9 && altLat > -30 && altLng > 135 && altLng < 155) {
        lat = altLat;
        lng = altLng;
      }
    }

    const validCoord = Number.isFinite(lat) && Number.isFinite(lng) && lat < -9 && lat > -30 && lng > 135 && lng < 155;
    if (validCoord && !inNqBbox(lat, lng)) return;

    const suburb = entry.Suburb || entry.suburb || entry.Location || entry.Locality || 'Ergon Outage';
    const typeLabel = entry.OutageType || entry.Type || (entry.Planned ? 'Planned Outage' : 'Unplanned Power Outage');
    const customers = entry.CustomersAffected ?? entry.Customers ?? entry.customersAffected;
    const reason = entry.Reason || entry.Cause || entry.Status || entry.RestorationTime || '';

    items.push(
      makeItem(`${feedId}-${entry.OutageId || entry.id || idx}`, 'outage', source, sourceLabel, `${suburb} — ${typeLabel}`, {
        subtitle: customers ? `${customers} customers affected` : entry.Status || typeLabel,
        description: [reason, entry.Streets ? `Streets: ${entry.Streets}` : ''].filter(Boolean).join(' · ') || undefined,
        status: entry.Status || typeLabel,
        lat: validCoord ? lat : null,
        lng: validCoord ? lng : null,
        updatedAt: entry.StartTime || entry.Updated || undefined,
        rawProperties: entry,
      })
    );
  });

  return items;
}

function normalizeGenericGuardianFeed(
  raw: any,
  feedId: string,
  category: EmergencyCategory,
  source: EmergencySourceHost,
  sourceLabel: string,
  filterBbox: boolean
): EmergencyFeatureItem[] {
  if (!raw) return [];
  if (raw?.type === 'FeatureCollection' || Array.isArray(raw?.features)) {
    return normalizeGeoJsonFeatures(raw, feedId, category, source, sourceLabel, filterBbox);
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.items) ? raw.items : [];
  const items: EmergencyFeatureItem[] = [];

  arr.forEach((entry: any, idx: number) => {
    if (!entry || typeof entry !== 'object') return;
    const pLat = Number(entry.lat ?? entry.Lat ?? entry.latitude ?? entry.Latitude);
    const pLng = Number(entry.lng ?? entry.lon ?? entry.Long ?? entry.longitude ?? entry.Longitude);
    const hasCoord = Number.isFinite(pLat) && Number.isFinite(pLng) && pLat !== 0 && pLng !== 0;

    if (filterBbox && hasCoord && !inNqBbox(pLat, pLng)) return;

    const title =
      entry.Title ||
      entry.title ||
      entry.Headline ||
      entry.Name ||
      entry.name ||
      entry.District ||
      entry.Region ||
      entry.Rating ||
      `${sourceLabel} Update`;

    const subtitle =
      entry.Rating ||
      entry.FireDangerRating ||
      entry.Status ||
      entry.Category ||
      entry.Suburb ||
      entry.Address ||
      undefined;

    const description =
      entry.Description ||
      entry.Message ||
      entry.Body ||
      entry.Summary ||
      entry.Details ||
      entry.Notes ||
      undefined;

    items.push(
      makeItem(`${feedId}-${entry.id || idx}`, category, source, sourceLabel, String(title), {
        subtitle: subtitle ? String(subtitle) : undefined,
        description: description ? String(description).replace(/<[^>]+>/g, ' ').trim() : undefined,
        status: entry.Status || entry.Rating || entry.FireDangerRating || undefined,
        lat: hasCoord ? pLat : null,
        lng: hasCoord ? pLng : null,
        updatedAt: entry.Published || entry.Updated || entry.Date || undefined,
        rawProperties: entry,
      })
    );
  });

  return items;
}

export async function fetchAllNqEmergencyFeeds(proxyUrl: string = DEFAULT_EMERGENCY_PROXY): Promise<EmergencyBundle> {
  const feedStatuses: EmergencyFeedStatus[] = [];
  const allItems: EmergencyFeatureItem[] = [];

  // A. Direct Browser-CORS QLD ArcGIS GeoJSON Feeds
  const arcgisFeeds: Array<{
    id: string;
    label: string;
    url: string;
    category: EmergencyCategory;
    filterBbox: boolean;
  }> = [
    {
      id: 'qld-warnings',
      label: 'QLD Severe Weather, Flood & Cyclone Warnings',
      url: 'https://services-ap1.arcgis.com/4z1c8UDtmlbV0cw9/ArcGIS/rest/services/Severe_Weather_Flood_Cyclone_Point_Public_View/FeatureServer/0/query?where=1%3D1&geometry=145.5,-21.2,148.6,-17.8&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&f=geojson',
      category: 'warning',
      filterBbox: true,
    },
    {
      id: 'qld-cyclone',
      label: 'Cyclone Track',
      url: 'https://services7.arcgis.com/si70weKpzPSa0BGV/arcgis/rest/services/Cyclone_Q1/FeatureServer/187/query?where=1%3D1&outSR=4326&outFields=*&f=geojson',
      category: 'cyclone',
      filterBbox: false,
    },
    {
      id: 'qld-qfd',
      label: 'QFD Current Emergency Incidents',
      url: 'https://services1.arcgis.com/vkTwD8kHw2woKBqV/arcgis/rest/services/ESCAD_Current_Incidents_Public/FeatureServer/0/query?where=1%3D1&geometry=145.5,-21.2,148.6,-17.8&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&f=geojson',
      category: 'qfd',
      filterBbox: true,
    },
    {
      id: 'qld-fuel',
      label: 'QLD Disaster Fuel Site Status',
      url: 'https://services7.arcgis.com/si70weKpzPSa0BGV/arcgis/rest/services/fuel_sites_qld/FeatureServer/0/query?where=1%3D1&geometry=145.5,-21.2,148.6,-17.8&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&f=geojson',
      category: 'fuel',
      filterBbox: true,
    },
  ];

  // B. Burdekin & Townsville Guardian IMS Feeds
  const guardianFeeds: Array<{
    id: string;
    label: string;
    host: EmergencySourceHost;
    url: string;
    category: EmergencyCategory;
    isErgon?: boolean;
    filterBbox: boolean;
  }> = [
    {
      id: 'burdekin-road',
      label: 'Burdekin Local Roads',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/imsRoad',
      category: 'road',
      filterBbox: false,
    },
    {
      id: 'burdekin-tmr',
      label: 'TMR / QLDTraffic Highways (NQ)',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/tmrRoadData',
      category: 'road',
      filterBbox: true,
    },
    {
      id: 'burdekin-ergon',
      label: 'Burdekin Ergon Outages',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/ergonOutages',
      category: 'outage',
      isErgon: true,
      filterBbox: true,
    },
    {
      id: 'burdekin-bulletin',
      label: 'Burdekin Bulletins',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/imsBulletin',
      category: 'bulletin',
      filterBbox: false,
    },
    {
      id: 'burdekin-fire',
      label: 'Burdekin Fire Danger',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/fireDangerRating',
      category: 'fire_danger',
      filterBbox: false,
    },
    {
      id: 'burdekin-evac',
      label: 'Burdekin Evac Centres',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/imsEvac',
      category: 'evac',
      filterBbox: false,
    },
    {
      id: 'burdekin-sandbag',
      label: 'Burdekin Sandbag Stations',
      host: 'burdekin_ims',
      url: 'https://disaster.burdekin.qld.gov.au/dashboard/sandbagStations',
      category: 'sandbag',
      filterBbox: false,
    },
    {
      id: 'townsville-road',
      label: 'Townsville Local Roads',
      host: 'townsville_ims',
      url: 'https://disaster.townsville.qld.gov.au/dashboard/imsRoad',
      category: 'road',
      filterBbox: false,
    },
    {
      id: 'townsville-ergon',
      label: 'Townsville Ergon Outages',
      host: 'townsville_ims',
      url: 'https://disaster.townsville.qld.gov.au/dashboard/ergonOutages',
      category: 'outage',
      isErgon: true,
      filterBbox: true,
    },
    {
      id: 'townsville-bulletin',
      label: 'Townsville Bulletins',
      host: 'townsville_ims',
      url: 'https://disaster.townsville.qld.gov.au/dashboard/imsBulletin',
      category: 'bulletin',
      filterBbox: false,
    },
    {
      id: 'townsville-fire',
      label: 'Townsville Fire Danger',
      host: 'townsville_ims',
      url: 'https://disaster.townsville.qld.gov.au/dashboard/fireDangerRating',
      category: 'fire_danger',
      filterBbox: false,
    },
    {
      id: 'townsville-evac',
      label: 'Townsville Evac Centres',
      host: 'townsville_ims',
      url: 'https://disaster.townsville.qld.gov.au/dashboard/imsEvac',
      category: 'evac',
      filterBbox: false,
    },
    {
      id: 'townsville-sandbag',
      label: 'Townsville Sandbag Stations',
      host: 'townsville_ims',
      url: 'https://disaster.townsville.qld.gov.au/dashboard/sandbagStations',
      category: 'sandbag',
      filterBbox: false,
    },
  ];

  // Fetch ArcGIS feeds directly (CORS-enabled)
  const arcgisPromises = arcgisFeeds.map(async (feed) => {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items = normalizeGeoJsonFeatures(json, feed.id, feed.category, 'qld_arcgis', feed.label, feed.filterBbox);
      allItems.push(...items);
      feedStatuses.push({
        id: feed.id,
        label: feed.label,
        host: 'qld_arcgis',
        status: items.length > 0 ? 'ok' : 'empty',
        count: items.length,
      });
    } catch (err: any) {
      feedStatuses.push({
        id: feed.id,
        label: feed.label,
        host: 'qld_arcgis',
        status: 'blocked',
        count: 0,
        error: err?.message || 'Request failed',
      });
    }
  });

  // Fetch Guardian IMS feeds with direct -> proxy fallback + double-encoded JSON handling
  const guardianPromises = guardianFeeds.map(async (feed) => {
    const result = await fetchDirectOrProxied(feed.url, proxyUrl);
    if (result.mode === 'blocked' || result.data === null) {
      feedStatuses.push({
        id: feed.id,
        label: feed.label,
        host: feed.host,
        status: 'blocked',
        count: 0,
        error: result.error,
      });
      return;
    }

    const items = feed.isErgon
      ? normalizeErgonOutages(result.data, feed.id, feed.host, feed.label)
      : normalizeGenericGuardianFeed(result.data, feed.id, feed.category, feed.host, feed.label, feed.filterBbox);

    allItems.push(...items);
    feedStatuses.push({
      id: feed.id,
      label: feed.label,
      host: feed.host,
      status: items.length > 0 ? result.mode : 'empty',
      count: items.length,
    });
  });

  // Server-side feeds (QLDTraffic, BOM warnings, river gauges): cached on our own server,
  // so they never need the CORS proxy. See server/feeds/index.ts.
  const serverFeeds: Array<{ path: string; id: string; label: string; host: EmergencySourceHost }> = [
    { path: '/api/emergency/traffic', id: 'qldtraffic', label: 'QLDTraffic Road Events', host: 'qldtraffic' },
    { path: '/api/emergency/bom-warnings', id: 'bom-warnings', label: 'BOM QLD Warnings', host: 'bom' },
    { path: '/api/emergency/gauges', id: 'river-gauges', label: 'BOM River Heights', host: 'bom' },
  ];
  const serverPromises = serverFeeds.map(async (feed) => {
    try {
      const res = await fetch(feed.path, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as EmergencyFeedResponse;
      const items = Array.isArray(body.items) ? body.items : [];
      allItems.push(...items);
      feedStatuses.push({
        id: feed.id,
        label: feed.label,
        host: feed.host,
        status: items.length > 0 ? 'ok' : body.error ? 'blocked' : 'empty',
        count: items.length,
        error: body.error,
      });
    } catch (err: any) {
      feedStatuses.push({
        id: feed.id,
        label: feed.label,
        host: feed.host,
        status: 'blocked',
        count: 0,
        error: err?.message || 'Request failed',
      });
    }
  });

  await Promise.allSettled([...arcgisPromises, ...guardianPromises, ...serverPromises]);

  // Sort: Corridor priority first, then severity (critical > high > moderate > info)
  const sevRank: Record<EmergencyFeatureItem['severity'], number> = {
    critical: 0,
    high: 1,
    moderate: 2,
    info: 3,
  };

  allItems.sort((a, b) => {
    if (a.isCorridorPriority !== b.isCorridorPriority) {
      return a.isCorridorPriority ? -1 : 1;
    }
    return sevRank[a.severity] - sevRank[b.severity];
  });

  return {
    items: allItems,
    feedStatuses,
    lastUpdated: Date.now(),
  };
}
