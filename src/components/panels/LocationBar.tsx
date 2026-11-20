/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { BookmarkPlus, Plus, X } from 'lucide-react';
import { PRESET_LOCATIONS } from '../../utils/mockWeatherData';
import { useAppData } from '../../state/AppDataContext';
import { PlaceAutocompleteNew } from '../PlaceAutocompleteNew';
import type { WeatherLocation } from '../../types/weather';

/** True when the selected location already exists as a preset or saved chip. */
export function useIsSelectedSaved(): boolean {
  const { selectedLocation, savedLocations } = useAppData();
  return [...PRESET_LOCATIONS, ...savedLocations].some(
    (loc) =>
      loc.id === selectedLocation.id ||
      (Math.abs(loc.lat - selectedLocation.lat) < 0.002 && Math.abs(loc.lng - selectedLocation.lng) < 0.002)
  );
}

interface LocationSearchRowProps {
  isAddOpen: boolean;
  onToggleAdd: () => void;
  /** Extra buttons after the unit toggle (e.g. desktop collapse button). */
  trailing?: ReactNode;
}

/** Search box + Add + °C/°F toggle. */
export function LocationSearchRow({ isAddOpen, onToggleAdd, trailing }: LocationSearchRowProps) {
  const { onSelectLocation, unitSystem, onToggleUnitSystem, searchFocusToken } = useAppData();
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <PlaceAutocompleteNew
          onSelectLocation={onSelectLocation}
          placeholder="Search for a city or airport"
          focusToken={searchFocusToken}
        />
      </div>

      <button
        id="btn-add-location"
        type="button"
        onClick={onToggleAdd}
        className={`h-11 lg:h-9 px-3 lg:px-2.5 rounded-[10px] text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
          isAddOpen ? 'bg-[#32ADE6] text-white' : 'bg-white/10 hover:bg-white/15 text-white'
        }`}
        title="Add & save a location"
        aria-expanded={isAddOpen}
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Add</span>
      </button>

      <button
        id="btn-toggle-unit"
        type="button"
        onClick={onToggleUnitSystem}
        className="h-11 min-w-11 lg:h-9 lg:min-w-0 px-3 rounded-[10px] bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
        title="Toggle Celsius / Fahrenheit"
      >
        °{unitSystem === 'METRIC' ? 'C' : 'F'}
      </button>

      {trailing}
    </div>
  );
}

const inputClass =
  'w-full px-2.5 py-2.5 lg:py-1.5 text-base lg:text-xs rounded-lg border border-white/15 bg-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#32ADE6]';

/** Expandable "Add location" form: Places search, save-current, or raw coordinates. */
export function AddLocationForm({ onClose }: { onClose: () => void }) {
  const { selectedLocation, onAddLocation } = useAppData();
  const isSaved = useIsSelectedSaved();
  const [customName, setCustomName] = useState('');
  const [customLat, setCustomLat] = useState('');
  const [customLng, setCustomLng] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addAndClose = (loc: WeatherLocation) => {
    onAddLocation(loc);
    onClose();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = customName.trim();
    const lat = parseFloat(customLat);
    const lng = parseFloat(customLng);
    if (!trimmedName) return setError('Enter a location name.');
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return setError('Latitude must be between -90 and 90.');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return setError('Longitude must be between -180 and 180.');
    addAndClose({
      id: `saved-${Date.now()}`,
      name: trimmedName,
      searchQuery: trimmedName,
      region: 'Saved Location',
      country: '',
      lat,
      lng,
      timezone: 'Australia/Brisbane',
    });
  };

  return (
    <div className="rounded-[20px] border border-[#32ADE6]/35 bg-[#141416]/75 backdrop-blur-xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">Add Location to Quick List</span>
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 -m-3 lg:w-auto lg:h-auto lg:m-0 lg:p-0.5 flex items-center justify-center rounded text-white/50 hover:text-white cursor-pointer"
          aria-label="Close Add Location form"
        >
          <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-1">Search a town or place</div>
        <PlaceAutocompleteNew
          onSelectLocation={addAndClose}
          placeholder="Type place name (e.g. Home Hill, Giru, Bowen)…"
        />
      </div>

      {!isSaved && (
        <button
          type="button"
          onClick={() => addAndClose(selectedLocation)}
          className="w-full min-h-11 lg:min-h-0 py-1.5 px-2.5 rounded-xl bg-[#32ADE6]/20 hover:bg-[#32ADE6]/30 border border-[#32ADE6]/40 text-[#32ADE6] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
          <span className="truncate">Save active: {selectedLocation.name}</span>
        </button>
      )}

      <form onSubmit={handleSubmit} className="pt-2 border-t border-white/10 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Or enter custom coordinates</div>
        <input
          type="text"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="Name (e.g. Haughton River Crossing)"
          aria-label="Location name"
          name="location-name"
          autoComplete="off"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="number"
            step="any"
            aria-label="Latitude"
            name="latitude"
            autoComplete="off"
            value={customLat}
            onChange={(e) => setCustomLat(e.target.value)}
            placeholder="Lat (e.g. -19.44)"
            className={`${inputClass} font-mono`}
          />
          <input
            type="number"
            step="any"
            aria-label="Longitude"
            name="longitude"
            autoComplete="off"
            value={customLng}
            onChange={(e) => setCustomLng(e.target.value)}
            placeholder="Lng (e.g. 147.11)"
            className={`${inputClass} font-mono`}
          />
        </div>
        {error && (
          <p role="alert" className="text-[11px] font-medium text-[#ff3b30]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 lg:min-h-0 px-3 lg:px-2.5 py-1 rounded-lg text-xs font-medium text-white/65 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-11 lg:min-h-0 px-3 py-1 rounded-lg bg-[#32ADE6] hover:bg-[#4cbdf0] text-white text-xs font-semibold cursor-pointer"
          >
            Save Coordinates
          </button>
        </div>
      </form>
    </div>
  );
}

/** Horizontal scroller of preset + saved location chips. */
export function LocationChips() {
  const { selectedLocation, savedLocations, onSelectLocation, onRemoveSavedLocation } = useAppData();
  const chipBase =
    'rounded-lg text-xs lg:text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors';
  const chipState = (selected: boolean) =>
    selected ? 'bg-[#32ADE6] text-white font-semibold' : 'bg-white/[0.08] text-white/75 hover:bg-white/15 hover:text-white';

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar select-none">
      {PRESET_LOCATIONS.map((loc) => (
        <button
          key={loc.id}
          type="button"
          onClick={() => onSelectLocation(loc)}
          className={`${chipBase} ${chipState(loc.id === selectedLocation.id)} min-h-11 lg:min-h-0 px-3 lg:px-2.5 py-1 cursor-pointer`}
        >
          {loc.name}
        </button>
      ))}

      {savedLocations.map((loc) => {
        const isSelected = loc.id === selectedLocation.id;
        return (
          <div key={loc.id} className={`${chipBase} ${chipState(isSelected)} flex items-center`}>
            <button
              type="button"
              onClick={() => onSelectLocation(loc)}
              className="min-h-11 lg:min-h-0 pl-3 lg:pl-2.5 pr-1.5 py-1 cursor-pointer"
            >
              {loc.name}
            </button>
            <button
              type="button"
              onClick={() => onRemoveSavedLocation(loc.id)}
              className={`min-h-11 min-w-9 lg:min-h-0 lg:min-w-0 flex items-center justify-center pr-2 pl-0.5 py-1 cursor-pointer ${
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
  );
}

/** Full location bar (search row, add form, chips) used by the mobile sheet. */
export function LocationBar() {
  const [isAddOpen, setIsAddOpen] = useState(false);
  return (
    <div className="space-y-3">
      <LocationSearchRow isAddOpen={isAddOpen} onToggleAdd={() => setIsAddOpen((v) => !v)} />
      {isAddOpen && <AddLocationForm onClose={() => setIsAddOpen(false)} />}
      <LocationChips />
    </div>
  );
}
