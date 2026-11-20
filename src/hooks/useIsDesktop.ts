import { useSyncExternalStore } from 'react';

/** Breakpoint at which the app switches from the mobile bottom sheet to the desktop sidebar. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/** True when the viewport is at least 1024px wide (live, follows resizes/rotation). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
