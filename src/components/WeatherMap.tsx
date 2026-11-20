/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  EmergencyFeatureItem,
  EmergencyLayerToggles,
  LocationWeatherBundle,
  MultiModelBundle,
  RainViewerFrame,
  WeatherLocation,
  WeatherUnitSystem,
} from '../types/weather';
import { searchPlaceByCoordinates } from '../services/weatherApi';
import { WeatherTileOverlay } from './WeatherTileOverlay';
import { WeatherMarkers } from './WeatherMarkers';
import { EmergencyMapLayers } from './EmergencyMapLayers';
import { RadarControlBar } from './RadarControlBar';
import { MapFloatingControls } from './MapFloatingControls';
import { panToWithVerticalOffset } from '../utils/mapUtils';

interface WeatherMapProps {
  selectedLocation: WeatherLocation;
  savedLocations?: WeatherLocation[];
  weatherBundle: LocationWeatherBundle | null;
  multiModelBundle: MultiModelBundle | null;
  unitSystem: WeatherUnitSystem;
  onSelectLocation: (loc: WeatherLocation) => void;
  rainViewerHost?: string;
  rainViewerFrames: RainViewerFrame[];
  activeFrameIndex: number;
  onChangeFrameIndex: (idx: number) => void;
  isRadarPlaying: boolean;
  onToggleRadarPlay: () => void;
  radarOpacity: number;
  onChangeRadarOpacity: (opacity: number) => void;
  radarVisible: boolean;
  onToggleRadarVisible: () => void;
  onTriggerRefresh: () => void;
  isSidebarCollapsed?: boolean;
  emergencyDashboardEnabled: boolean;
  emergencyItems: EmergencyFeatureItem[];
  emergencyLayers: EmergencyLayerToggles;
  selectedEmergencyItem: EmergencyFeatureItem | null;
  onSelectEmergencyItem: (item: EmergencyFeatureItem | null) => void;
}

function MapContent({
  selectedLocation,
  savedLocations = [],
  weatherBundle,
  multiModelBundle,
  unitSystem,
  onSelectLocation,
  rainViewerHost,
  rainViewerFrames,
  activeFrameIndex,
  onChangeFrameIndex,
  isRadarPlaying,
  onToggleRadarPlay,
  radarOpacity,
  onChangeRadarOpacity,
  radarVisible,
  onToggleRadarVisible,
  onTriggerRefresh,
  isSidebarCollapsed = false,
  emergencyDashboardEnabled,
  emergencyItems,
  emergencyLayers,
  selectedEmergencyItem,
  onSelectEmergencyItem,
}: WeatherMapProps) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');
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
      map.panTo({ lat: selectedEmergencyItem.lat, lng: selectedEmergencyItem.lng });
      if ((map.getZoom() || 9) < 10) {
        map.setZoom(11);
      }
    }
  }, [map, selectedEmergencyItem]);

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

  const handleJumpRegion = (region: 'CORRIDOR' | 'NQ') => {
    if (!map) return;
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

  const activeFrame = rainViewerFrames[activeFrameIndex] || null;

  return (
    <>
      <WeatherTileOverlay
        rainViewerHost={rainViewerHost}
        rainViewerFrame={activeFrame}
        opacity={radarOpacity}
        visible={radarVisible}
      />

      {emergencyDashboardEnabled && (
        <EmergencyMapLayers
          items={emergencyItems}
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
        onRefreshWeather={onTriggerRefresh}
      />

      <MapFloatingControls
        mapTypeId={mapTypeId}
        onChangeMapType={(type) => {
          setMapTypeId(type);
          if (map) map.setMapTypeId(type);
        }}
        onLocateUser={handleLocateUser}
        isLocating={isLocating}
      />

      <RadarControlBar
        frames={rainViewerFrames}
        activeFrameIndex={activeFrameIndex}
        onChangeFrameIndex={onChangeFrameIndex}
        isPlaying={isRadarPlaying}
        onTogglePlay={onToggleRadarPlay}
        opacity={radarOpacity}
        onChangeOpacity={onChangeRadarOpacity}
        visible={radarVisible}
        onToggleVisible={onToggleRadarVisible}
        onRefresh={onTriggerRefresh}
        onJumpRegion={handleJumpRegion}
        isSidebarCollapsed={isSidebarCollapsed}
      />
    </>
  );
}

export function WeatherMap(props: WeatherMapProps) {
  return (
    <div className="relative w-full h-full min-h-[100vh] bg-[#1a1a1c] overflow-hidden">
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
        <MapContent {...props} />
      </Map>
    </div>
  );
}
