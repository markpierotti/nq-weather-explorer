/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { fetchTrackerSummary } from '../services/trackerApi';
import type { TrackerSummaryResponse } from '../types/weather';
import { correctionsFor, estimateDay, nearestTrackedSite, outlookSummary } from '../utils/consensus';
import { useModelSelection } from './useModelSelection';

export function useTrackerSummary(): TrackerSummaryResponse | null {
  const [summary, setSummary] = useState<TrackerSummaryResponse | null>(null);
  useEffect(() => {
    let active = true;
    fetchTrackerSummary().then((d) => {
      if (active) setSummary(d);
    });
    return () => {
      active = false;
    };
  }, []);
  return summary;
}

/** Best estimates + confidence for each forecast day, from the chosen models and local bias corrections. */
export function useConsensus() {
  const { multiModelBundle, selectedLocation } = useAppData();
  const { selected, toggle } = useModelSelection();
  const summary = useTrackerSummary();
  const site = useMemo(
    () => nearestTrackedSite(summary, selectedLocation.lat, selectedLocation.lng),
    [summary, selectedLocation.lat, selectedLocation.lng],
  );
  const corrections = useMemo(() => correctionsFor(site), [site]);
  const days = useMemo(
    () => (multiModelBundle?.daily7d ?? []).map((row, i) => estimateDay(row, i, selected, corrections)),
    [multiModelBundle, selected, corrections],
  );
  return {
    days,
    today: days[0] ?? null,
    outlook: outlookSummary(days),
    site,
    corrections,
    summary,
    selected,
    toggle,
  };
}
