/**
 * Places whose forecasts are tracked, and the BOM station each one is scored against.
 * Model forecasts are requested at the station's coordinates so forecast and observation describe the same spot.
 */

export interface TrackedStation {
  /** BOM station number (SILO uses the same id). */
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TrackedSite {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Scored against this station; null = forecasts are logged but not scored (no station close enough). */
  station: TrackedStation | null;
  /** Town in BOM's public précis forecast feed (IDQ11295) used as "BOM" for this site, if any. */
  bomTown: string | null;
}

export const TRACKED_SITES: TrackedSite[] = [
  {
    id: 'ayr',
    label: 'Ayr',
    lat: -19.6169,
    lon: 147.3758,
    station: { id: '033002', name: 'Ayr DPI Research Stn', lat: -19.6169, lon: 147.3758 },
    bomTown: 'Ayr',
  },
  {
    id: 'alva-beach',
    label: 'Alva Beach',
    lat: -19.4569,
    lon: 147.4833,
    station: { id: '033295', name: 'Alva Beach', lat: -19.4569, lon: 147.4833 },
    // BOM's public feed has no Alva forecast; Ayr's (15 km away) is the closest official one.
    bomTown: 'Ayr',
  },
  {
    id: 'townsville',
    label: 'Townsville',
    lat: -19.2483,
    lon: 146.7661,
    station: { id: '032040', name: 'Townsville Aero', lat: -19.2483, lon: 146.7661 },
    bomTown: 'Townsville',
  },
  {
    // No station within ~38 km: comparing against Ayr or Townsville would mislead, so log only.
    id: 'cungulla',
    label: 'Cungulla Beach',
    lat: -19.395,
    lon: 147.108,
    station: null,
    bomTown: null,
  },
];
