/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useAppData, useRadarData } from '../state/AppDataContext';
import { searchPlaceByCoordinates } from '../services/weatherApi';
import { WeatherTileOverlay } from './WeatherTileOverlay';
import { WeatherMarkers } from './WeatherMarkers';
import { EmergencyMapLayers } from './EmergencyMapLayers';
import { RadarControlBar } from './RadarControlBar';
import { MapFloatingControls } from './MapFloatingControls';
import { MapLegend } from './MapLegend';
import { LayersMenu, type MapStyle, type QuickView } from './LayersMenu';
import { panToWithVerticalOffset } from '../utils/mapUtils';

/** Radar tiles subscribe to radar state on their own, so playback doesn't re-render markers/layers. */
function RadarTileLayer() {
  const { rainViewerData, activeFrameIndex, radarOpacity, radarVisible } = useRadarData();
  return (
    <WeatherTileOverlay
      rainViewerHost={rainViewerData?.host}
      rainViewerFrame={rainViewerData?.frames[activeFrameIndex] ?? null}
      opacity={radarOpacity}
      visible={radarVisible}
    />
  );
}

function MapContent() {
  const {
    selectedLocation,
    savedLocations,
    weatherBundle,
    multiModelBundle,
    unitSystem,
    onSelectLocation,
    onRefreshAll,
    emergencyDashboardEnabled,
    emergencyBundle,
    emergencyLayers,
    selectedEmergencyItem,
    onSelectEmergencyItem,
    isDesktop,
    onChangeSheetSnap,
    onSetLayersMenuOpen,
  } = useAppData();
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const [mapTypeId, setMapTypeId] = useState<MapStyle>('roadmap');
  const [isLocating, setIsLocating] = useState(false);

  const lastPannedCoord = useRef<{ lat: number; lng: number } | null>(null);
  const lastFocusedEmergencyId = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !selectedLocation) return;
    const prev = lastPannedCoord.current;
    if (
      prev &&
      Math.abs(prev.lat - selectedLocation.lat) < 0.0001 &&
      Math.abs(prev.lng - selectedLocation.lng) < 0.0001
    ) {
      return;
    }
    lastPannedCoord.current = { lat: selectedLocation.lat, lng: selectedLocation.lng };
    panToWithVerticalOffset(map, selectedLocation.lat, selectedLocation.lng);
  }, [map, selectedLocation.lat, selectedLocation.lng]);

  // Pan map when user selects an emergency item from the list
  useEffect(() => {
    if (!map || !selectedEmergencyItem) return;
    if (lastFocusedEmergencyId.current === selectedEmergencyItem.id) return;
    if (selectedEmergencyItem.lat !== null && selectedEmergencyItem.lng !== null) {
      lastFocusedEmergencyId.current = selectedEmergencyItem.id;
      if ((map.getZoom() || 9) < 10) {
        map.setZoom(11);
      }
      if (isDesktop) {
        map.panTo({ lat: selectedEmergencyItem.lat, lng: selectedEmergencyItem.lng });
      } else {
        // Mobile: keep the item above the bottom sheet.
        panToWithVerticalOffset(map, selectedEmergencyItem.lat, selectedEmergencyItem.lng);
      }
    }
  }, [map, selectedEmergencyItem, isDesktop]);

  // Click anywhere on map to resolve place name & update weather/models
  useEffect(() => {
    if (!map) return;

    const clickListener = map.addListener('click', async (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      onSelectLocation({
        id: `loc-${lat.toFixed(4)}-${lng.toFixed(4)}`,
        name: `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`,
        country: '',
        lat,
        lng,
        isManual: true,
      });

      try {
        const resolved = await searchPlaceByCoordinates(lat, lng, placesLib);
        onSelectLocation({
          ...resolved,
          isManual: true,
        });
      } catch (err) {
        console.warn('Places API (New) click search error:', err);
      }
    });

    return () => {
      google.maps.event.removeListener(clickListener);
    };
  }, [map, placesLib, onSelectLocation]);

  const handleQuickView = (region: QuickView) => {
    if (!map) return;
    if (!isDesktop) {
      onSetLayersMenuOpen(false);
      onChangeSheetSnap('peek');
    }
    if (region === 'CORRIDOR') {
      map.setCenter({ lat: -19.42, lng: 147.11 });
      map.setZoom(10);
    } else if (region === 'NQ') {
      map.setCenter({ lat: -19.3, lng: 146.9 });
      map.setZoom(7);
    }
  };

  const handleLocateUser = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        onSelectLocation({
          id: 'my-location',
          name: 'My Current Location',
          country: 'Local Device',
          lat: latitude,
          lng: longitude,
        });
        try {
          const resolved = await searchPlaceByCoordinates(latitude, longitude, placesLib);
          onSelectLocation({ ...resolved, id: 'my-location' });
        } catch {
          // Keep generic name
        }
      },
      () => {
        setIsLocating(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  return (
    <>
      <RadarTileLayer />

      {emergencyDashboardEnabled && (
        <EmergencyMapLayers
          items={emergencyBundle?.items ?? []}
          layerToggles={emergencyLayers}
          selectedItem={selectedEmergencyItem}
          onSelectItem={onSelectEmergencyItem}
        />
      )}

      <WeatherMarkers
        selectedLocation={selectedLocation}
        savedLocations={savedLocations}
        currentBundle={weatherBundle}
        multiModelBundle={multiModelBundle}
        unitSystem={unitSystem}
        onSelectLocation={onSelectLocation}
        showStations={true}
        onRefreshWeather={onRefreshAll}
      />

      <MapFloatingControls onLocateUser={handleLocateUser} isLocating={isLocating} />

      <MapLegend />

      <LayersMenu
        mapTypeId={mapTypeId}
        onChangeMapType={(type) => {
          setMapTypeId(type);
          if (map) map.setMapTypeId(type);
        }}
        onQuickView={handleQuickView}
      />

      <RadarControlBar />
    </>
  );
}

export function WeatherMap() {
  return (
    <div className="relative w-full h-full bg-[#1a1a1c] overflow-hidden">
      <Map
        id="google-weather-map-instance"
        mapId="DEMO_MAP_ID"
        colorScheme={'DARK' as any}
        defaultCenter={{ lat: -19.42, lng: 147.11 }}
        defaultZoom={9}
        minZoom={2}
        maxZoom={17}
        disableDefaultUI={true}
        clickableIcons={false}
        gestureHandling="greedy"
        className="w-full h-full"
      >
        <MapContent />
      </Map>
    </div>
  );
}
