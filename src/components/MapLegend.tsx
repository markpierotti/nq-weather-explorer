/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Info, Waves } from 'lucide-react';
import { useAppData } from '../state/AppDataContext';
import { FLOOD_CLASS_COLOR, FLOOD_CLASS_LABEL } from './emergency/GaugeDetail';
import type { FloodClass } from '../types/weather';

const RIVER_LEVELS: FloodClass[] = ['below_minor', 'minor', 'moderate', 'major', 'unknown'];

interface PinLegendItem {
  label: string;
  glyph: string;
  bg: string;
  border: string;
  active: boolean;
}

export function MapLegend() {
  const { emergencyDashboardEnabled, emergencyLayers, isDesktop, sheetSnap } = useAppData();
  const [isOpen, setIsOpen] = useState<boolean>(isDesktop);

  // Sync default open/closed when crossing the desktop/mobile breakpoint
  useEffect(() => {
    setIsOpen(isDesktop);
  }, [isDesktop]);

  if (!emergencyDashboardEnabled) return null;

  const hidden = !isDesktop && sheetSnap === 'full';

  const roadItems: PinLegendItem[] = [
    {
      label: 'Road closed',
      glyph: '✕',
      bg: '#dc2626',
      border: '#7f1d1d',
      active: emergencyLayers.traffic || emergencyLayers.roads,
    },
    {
      label: 'Flooded road',
      glyph: '≈',
      bg: '#0369a1',
      border: '#0c4a6e',
      active: emergencyLayers.traffic,
    },
    {
      label: 'Traffic / roadworks',
      glyph: 'T',
      bg: '#d97706',
      border: '#78350f',
      active: emergencyLayers.traffic || emergencyLayers.roads,
    },
  ];

  const otherItems: PinLegendItem[] = [
    {
      label: 'BOM / Cyclone warning',
      glyph: 'W',
      bg: '#e11d48',
      border: '#881337',
      active: emergencyLayers.bomWarnings || emergencyLayers.warnings,
    },
    {
      label: 'Power outage',
      glyph: '⚡',
      bg: '#7c3aed',
      border: '#4c1d95',
      active: emergencyLayers.outages,
    },
    {
      label: 'QFD fire / danger',
      glyph: 'F',
      bg: '#ea580c',
      border: '#7c2d12',
      active: emergencyLayers.qfd,
    },
    {
      label: 'Evac / Sandbags',
      glyph: 'S',
      bg: '#0284c7',
      border: '#0c4a6e',
      active: emergencyLayers.support,
    },
    {
      label: 'Fuel station',
      glyph: '⛽',
      bg: '#059669',
      border: '#064e3b',
      active: emergencyLayers.support,
    },
  ];

  return (
    <div
      className={`absolute z-20 select-none transition-opacity duration-200 ${
        isDesktop ? 'bottom-6 right-6 max-w-[248px]' : 'left-3 max-w-[236px]'
      } ${hidden ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
      style={isDesktop ? undefined : { top: 'calc(env(safe-area-inset-top) + 12px)' }}
      aria-hidden={hidden}
      inert={hidden}
    >
      <div className="rounded-2xl bg-[#1c1c1e]/90 border border-white/12 backdrop-blur-xl shadow-2xl shadow-black/50 text-white overflow-hidden">
        <button
          id="btn-map-legend"
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-expanded={isOpen}
          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-white/90 hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <span className="inline-flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#32ADE6]" />
            <span>Map Legend</span>
          </span>
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-white/55" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-white/55" />
          )}
        </button>

        {isOpen && (
          <div className="px-3 pb-3 pt-1.5 border-t border-white/10 space-y-2.5 text-[11px] max-h-[60vh] overflow-y-auto no-scrollbar">
            {/* River Heights */}
            <div className={emergencyLayers.gauges ? 'space-y-1.5' : 'space-y-1.5 opacity-40'}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                River Heights
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {RIVER_LEVELS.map((cls) => {
                  const flooding = cls === 'minor' || cls === 'moderate' || cls === 'major';
                  return (
                    <div key={cls} className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="inline-flex items-center justify-center rounded-full border border-white shrink-0"
                        style={{
                          background: FLOOD_CLASS_COLOR[cls],
                          width: flooding ? 18 : 15,
                          height: flooding ? 18 : 15,
                        }}
                        aria-hidden="true"
                      >
                        <Waves className="w-2.5 h-2.5 text-white" />
                      </span>
                      <span className="text-white/80 truncate">{FLOOD_CLASS_LABEL[cls]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-white/45 leading-tight">
                Larger badge = actively flooding
              </div>
            </div>

            {/* Roads & Corridor */}
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                Roads &amp; Corridor
              </div>
              <div className="space-y-1">
                {roadItems.map((item) => (
                  <div
                    key={item.label}
                    className={`flex items-center gap-2 ${item.active ? '' : 'opacity-40'}`}
                  >
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-white border shrink-0"
                      style={{ background: item.bg, borderColor: item.border }}
                      aria-hidden="true"
                    >
                      {item.glyph}
                    </span>
                    <span className="text-white/80 truncate">{item.label}</span>
                  </div>
                ))}
                <div
                  className={`flex items-center gap-2 ${emergencyLayers.corridor ? '' : 'opacity-40'}`}
                >
                  <span
                    className="w-4 h-1 rounded-full shrink-0"
                    style={{
                      background: '#0369a1',
                      boxShadow: '0 0 6px rgba(2, 132, 199, 0.8)',
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-white/80 truncate">Bruce Hwy (A1) corridor</span>
                </div>
              </div>
            </div>

            {/* Warnings, Outages & Support */}
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                Warnings &amp; Support
              </div>
              <div className="space-y-1">
                {otherItems.map((item) => (
                  <div
                    key={item.label}
                    className={`flex items-center gap-2 ${item.active ? '' : 'opacity-40'}`}
                  >
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-white border shrink-0"
                      style={{ background: item.bg, borderColor: item.border }}
                      aria-hidden="true"
                    >
                      {item.glyph}
                    </span>
                    <span className="text-white/80 truncate">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
