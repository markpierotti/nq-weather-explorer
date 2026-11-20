/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { EmergencyLayerToggles } from '../types/weather';
import { useAppData, useRadarData } from '../state/AppDataContext';
import { IosSwitch } from './panels/ModeToggles';

export type MapStyle = 'roadmap' | 'satellite' | 'terrain';
export type QuickView = 'CORRIDOR' | 'NQ';

const MAP_STYLES: Array<{ id: MapStyle; label: string }> = [
  { id: 'roadmap', label: 'Dark' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'terrain', label: 'Terrain' },
];

const EMERGENCY_LAYERS: Array<{ key: keyof EmergencyLayerToggles; label: string }> = [
  { key: 'corridor', label: 'Bruce Hwy corridor' },
  { key: 'roads', label: 'Road closures' },
  { key: 'outages', label: 'Ergon outages' },
  { key: 'warnings', label: 'Warnings & cyclone' },
  { key: 'qfd', label: 'QFD incidents' },
  { key: 'support', label: 'Fuel, evac & sandbags' },
  { key: 'gauges', label: 'River gauges' },
  { key: 'traffic', label: 'QLDTraffic events' },
  { key: 'bomWarnings', label: 'BOM warnings' },
];

interface LayersMenuProps {
  mapTypeId: string;
  onChangeMapType: (type: MapStyle) => void;
  onQuickView: (view: QuickView) => void;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50 mb-2">{children}</div>;
}

function LayersMenuBody({ mapTypeId, onChangeMapType, onQuickView }: LayersMenuProps) {
  const { radarVisible, onToggleRadarVisible, radarOpacity, onChangeRadarOpacity } = useRadarData();
  const {
    emergencyDashboardEnabled,
    onToggleEmergencyDashboard,
    emergencyLayers,
    onToggleEmergencyLayer,
  } = useAppData();

  const row = 'flex items-center justify-between gap-3 min-h-11 lg:min-h-9';

  return (
    <div className="space-y-5 text-white">
      <section>
        <SectionTitle>Map style</SectionTitle>
        <div className="grid grid-cols-3 gap-1 bg-white/[0.08] p-1 rounded-xl border border-white/10" role="radiogroup">
          {MAP_STYLES.map((s) => (
            <button
              key={s.id}
              id={s.id === mapTypeId ? 'btn-map-type-toggle' : undefined}
              type="button"
              role="radio"
              aria-checked={mapTypeId === s.id}
              onClick={() => onChangeMapType(s.id)}
              className={`min-h-11 lg:min-h-8 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                mapTypeId === s.id ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Rain radar</SectionTitle>
        <div className={row}>
          <span className="text-sm lg:text-xs">Show radar</span>
          <IosSwitch
            id="btn-radar-toggle-visibility"
            checked={radarVisible}
            onToggle={onToggleRadarVisible}
            activeClass="bg-[#32ADE6]"
            title={radarVisible ? 'Hide radar overlay' : 'Show radar overlay'}
          />
        </div>
        <label className={`${row} ${radarVisible ? '' : 'opacity-40'}`}>
          <span className="text-sm lg:text-xs shrink-0">Opacity</span>
          <input
            id="radar-opacity-slider"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={radarOpacity}
            disabled={!radarVisible}
            onChange={(e) => onChangeRadarOpacity(parseFloat(e.target.value))}
            className="flex-1 h-6 accent-[#32ADE6] cursor-pointer"
          />
          <span className="text-xs font-mono tabular-nums text-white/70 w-9 text-right">
            {Math.round(radarOpacity * 100)}%
          </span>
        </label>
      </section>

      <section>
        <SectionTitle>Emergency overlays</SectionTitle>
        <div className={row}>
          <span className="text-sm lg:text-xs font-semibold">Emergency dashboard</span>
          <IosSwitch
            id="btn-layers-emergency-toggle"
            checked={emergencyDashboardEnabled}
            onToggle={onToggleEmergencyDashboard}
            activeClass="bg-[#ff9500]"
            title={emergencyDashboardEnabled ? 'Turn Emergency Dashboard OFF' : 'Turn Emergency Dashboard ON'}
          />
        </div>
        <div className={`mt-1 divide-y divide-white/[0.06] ${emergencyDashboardEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
          {EMERGENCY_LAYERS.map(({ key, label }) => (
            <div key={key} className={row}>
              <span className="text-sm lg:text-xs text-white/85">{label}</span>
              <IosSwitch
                id={`btn-layer-${key}`}
                checked={emergencyLayers[key]}
                onToggle={() => onToggleEmergencyLayer(key)}
                activeClass="bg-[#32ADE6]"
                title={`Toggle ${label}`}
              />
            </div>
          ))}
        </div>
        {!emergencyDashboardEnabled && (
          <p className="text-[11px] text-white/50 mt-1">Turn on the dashboard to load emergency feeds.</p>
        )}
      </section>

      <section>
        <SectionTitle>Quick views</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onQuickView('CORRIDOR')}
            className="min-h-11 lg:min-h-9 rounded-xl bg-white/[0.08] hover:bg-white/15 text-xs font-medium cursor-pointer"
          >
            Ayr ↔ Townsville
          </button>
          <button
            type="button"
            onClick={() => onQuickView('NQ')}
            className="min-h-11 lg:min-h-9 rounded-xl bg-white/[0.08] hover:bg-white/15 text-xs font-medium cursor-pointer"
          >
            North QLD
          </button>
        </div>
      </section>
    </div>
  );
}

/** All map toggles in one place: popover on desktop, modal bottom sheet on mobile. */
export function LayersMenu(props: LayersMenuProps) {
  const { isLayersMenuOpen, onSetLayersMenuOpen, isDesktop } = useAppData();
  const popoverRef = useRef<HTMLDivElement>(null);
  const close = () => onSetLayersMenuOpen(false);

  useEffect(() => {
    if (!isLayersMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSetLayersMenuOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!isDesktop) return; // mobile uses the backdrop
      const target = e.target as HTMLElement;
      if (popoverRef.current?.contains(target) || target.closest('[data-layers-toggle]')) return;
      onSetLayersMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [isLayersMenuOpen, isDesktop, onSetLayersMenuOpen]);

  if (isDesktop) {
    return (
      <AnimatePresence>
        {isLayersMenuOpen && (
          <motion.div
            ref={popoverRef}
            role="dialog"
            aria-label="Map layers"
            initial={{ opacity: 0, scale: 0.96, x: 8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.96, x: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-6 right-[84px] z-30 w-80 max-h-[calc(100dvh-48px)] overflow-y-auto no-scrollbar rounded-[20px] bg-[#1c1c1e]/95 border border-white/10 shadow-2xl backdrop-blur-2xl p-4 origin-top-right"
          >
            <LayersMenuBody {...props} />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Portal to <body> so the modal stacks above the bottom sheet and tab bar regardless of the map's stacking context.
  return createPortal(
    <AnimatePresence>
      {isLayersMenuOpen && (
        <motion.div
          key="layers-modal"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Map layers"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            className="absolute left-0 right-0 bottom-0 max-h-[85dvh] flex flex-col rounded-t-[24px] bg-[#1c1c1e] border-t border-white/10 shadow-2xl"
          >
            <div className="flex items-center justify-between pl-5 pr-2 pt-2 shrink-0">
              <h2 className="text-base font-semibold text-white">Map layers</h2>
              <button
                type="button"
                onClick={close}
                className="w-11 h-11 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 cursor-pointer"
                aria-label="Close map layers"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-2"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
            >
              <LayersMenuBody {...props} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
