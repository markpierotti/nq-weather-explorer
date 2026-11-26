/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import { CONSENSUS_MODELS, type ConsensusModel } from '../utils/consensus';

/** Which models feed the consensus. Remembered per browser; shared live by every component that uses it. */
const STORAGE_KEY = 'nq-weather:consensus-models:v1';
const ALL = CONSENSUS_MODELS.map((m) => m.id);
/** Agreement needs at least two forecasts to compare. */
export const MIN_MODELS = 2;

function load(): ConsensusModel[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(raw)) {
      const valid = ALL.filter((id) => raw.includes(id));
      if (valid.length >= MIN_MODELS) return valid;
    }
  } catch {
    // ignore
  }
  return ALL;
}

let current: ConsensusModel[] = typeof window === 'undefined' ? ALL : load();
const listeners = new Set<() => void>();

function set(next: ConsensusModel[]) {
  current = ALL.filter((id) => next.includes(id));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // private mode etc.: still works for this session
  }
  listeners.forEach((l) => l());
}

export function useModelSelection() {
  const selected = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const toggle = (id: ConsensusModel) => {
    if (selected.includes(id)) {
      if (selected.length > MIN_MODELS) set(selected.filter((m) => m !== id));
    } else {
      set([...selected, id]);
    }
  };
  return { selected, toggle };
}
