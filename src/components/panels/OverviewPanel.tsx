/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AlertTriangle, BarChart3 } from 'lucide-react';
import { useAppData, useTabBadges } from '../../state/AppDataContext';
import { useCurrentConditions } from '../../hooks/useCurrentConditions';
import { AtmosphericMetricsGrid } from '../AtmosphericMetricsGrid';
import { HourlyForecastTimeline } from '../HourlyForecastTimeline';
import { SunMoonTracker } from '../SunMoonTracker';
import { CorridorBriefingCard } from '../CorridorBriefingCard';
import { CycloneThreatSection } from './ModelsPanel';
import { useConsensus } from '../../hooks/useConsensus';
import { CONFIDENCE_LABEL, CONSENSUS_MODELS, type ConsensusModel } from '../../utils/consensus';

const shortName = (id: ConsensusModel) => CONSENSUS_MODELS.find((m) => m.id === id)?.short ?? id;
import {
  CONFIDENCE_COLOR,
  ConfidenceDot,
  ConsensusInfoPanel,
  InfoToggle,
  ModelPicker,
} from '../consensus/ConsensusParts';

const linkBtn = 'text-[11px] font-medium cursor-pointer min-h-11 lg:min-h-0 -my-3 lg:my-0 flex items-center';

function ModelChip({ label, className = 'bg-white/10 text-white/80' }: { label: string; className?: string }) {
  return <div className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono mb-1 ${className}`}>{label}</div>;
}

function ConsensusBento() {
  const { cycloneMode, wn3Bundle, onChangeTab, multiModelBundle } = useAppData();
  const { todayRow, isMetric, fmtRangeTemp, fmtRainShort } = useCurrentConditions();
  const { today, site, corrections, selected, toggle } = useConsensus();
  const [infoOpen, setInfoOpen] = useState(false);

  const todayWn3 =
    cycloneMode && wn3Bundle && todayRow
      ? wn3Bundle.daily10d.find((d) => d.dateKey === todayRow.dateKey) || wn3Bundle.daily10d[0]
      : null;

  const spread = multiModelBundle?.spreadOverview;
  const confidence = today?.confidence ?? null;

  const models = todayRow
    ? [
        { id: 'wn2' as const, label: 'WN2', m: todayRow.weatherNext2, rain: 'text-[#32ADE6]' },
        { id: 'bom' as const, label: 'BOM', m: todayRow.bom, rain: 'text-[#34c759]' },
        { id: 'ecmwf' as const, label: 'ECMWF', m: todayRow.ecmwf, rain: 'text-[#a5a3ff] font-bold' },
        { id: 'gfs' as const, label: 'GFS', m: todayRow.gfs, rain: 'text-[#ff9500]' },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 gap-3 tabular-nums">
      <div className="col-span-2 ios-bento-card p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/60 flex items-center gap-1.5 min-w-0">
            <BarChart3 className="w-3.5 h-3.5 text-white/60 shrink-0" />
            <span className="truncate">Consensus · Today</span>
            <InfoToggle open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} controls="consensus-info-today" />
          </div>
          <button type="button" onClick={() => onChangeTab('models')} className={`${linkBtn} text-[#32ADE6] hover:underline shrink-0`}>
            7d Matrix →
          </button>
        </div>

        {infoOpen && <ConsensusInfoPanel id="consensus-info-today" site={site} corrections={corrections} />}

        {todayRow && today ? (
          <>
            <div className="flex items-end justify-between gap-3 mb-3 mt-1">
              <div>
                <div className="text-[11px] text-white/60">Best estimate</div>
                <div className="text-xl font-semibold text-white leading-tight">
                  {today.tmin !== null ? fmtRangeTemp(today.tmin) : '—'}/{fmtRangeTemp(today.tmax)}{' '}
                  <span className="text-[#32ADE6] text-base">{fmtRainShort(today.rain)}</span>
                </div>
                <div className="text-[11px] text-white/60 mt-0.5">
                  {today.calibrating.length > 0
                    ? `Temps from ${today.tempContributors.map(shortName).join(' + ')} · ${today.calibrating
                        .map(shortName)
                        .join(', ')} calibrating`
                    : `Middle of ${today.contributors.length} models`}
                  {today.corrected && site?.station ? ` · corrected for ${site.label}` : ''}
                </div>
              </div>
              {confidence && (
                <div className="flex items-center gap-1.5 text-xs font-semibold shrink-0" style={{ color: CONFIDENCE_COLOR[confidence] }}>
                  <ConfidenceDot confidence={confidence} />
                  {CONFIDENCE_LABEL[confidence]}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {models.map(({ id, label, m, rain }) => (
                <div key={label} className={selected.includes(id) ? '' : 'opacity-40'}>
                  <ModelChip label={label} />
                  {!selected.includes(id) && <span className="sr-only"> (not used)</span>}
                  <div className="text-sm font-semibold text-white">
                    {m ? `${fmtRangeTemp(m.minTemp)}/${fmtRangeTemp(m.maxTemp)}` : '—'}{' '}
                    <span className={rain}>{m ? fmtRainShort(m.rainMm) : '—'}</span>
                  </div>
                </div>
              ))}

              {todayWn3 && (
                <div className="col-span-2 pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-[#ff3b30]/25 text-[#ff3b30] font-mono text-[11px] font-semibold">
                    WN3
                  </span>
                  <span className="font-semibold text-white">
                    {fmtRangeTemp(todayWn3.minTemp)}/{fmtRangeTemp(todayWn3.maxTemp)}{' '}
                    <span className="text-[#32ADE6] ml-1">{fmtRainShort(todayWn3.rainMm)}</span>
                    {todayWn3.peakGustKmh !== null && (
                      <span className="text-white/60 ml-2">Gust {Math.round(todayWn3.peakGustKmh)} km/h</span>
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-white/10">
              <ModelPicker selected={selected} onToggle={toggle} />
            </div>
          </>
        ) : (
          <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
        )}
      </div>

      <div className="ios-bento-card p-4 flex flex-col justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/60">Precipitation</div>
        <div className="mt-2">
          <div className="text-[1.8rem] font-semibold leading-none text-white">
            {spread?.peak24hRainConsensusMm !== null && spread?.peak24hRainConsensusMm !== undefined
              ? isMetric
                ? spread.peak24hRainConsensusMm.toFixed(1)
                : (spread.peak24hRainConsensusMm / 25.4).toFixed(2)
              : '0.0'}
            <span className="text-sm font-normal text-white/60 ml-1">{isMetric ? 'mm' : 'in'}</span>
          </div>
          <div className="text-xs text-white/65 mt-2">Next 24 h · model average</div>
        </div>
      </div>

      <div className="ios-bento-card p-4 flex flex-col justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/60">Consensus today</div>
        <div className="mt-2">
          <div
            className="text-base font-semibold leading-tight"
            style={{ color: confidence ? CONFIDENCE_COLOR[confidence] : undefined }}
          >
            {confidence ? CONFIDENCE_LABEL[confidence] : 'Syncing…'}
          </div>
          <div className="text-xs text-white/65 mt-2">
            {today?.reason
              ? today.reason.charAt(0).toUpperCase() + today.reason.slice(1)
              : today?.tmaxRange
                ? `ΔT ${(today.tmaxRange[1] - today.tmaxRange[0]).toFixed(1)}° · same rain band`
                : 'Model Variation'}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmergencySummaryCard() {
  const { emergencyBundle, isLoadingEmergency, onChangeTab } = useAppData();
  const items = emergencyBundle?.items ?? [];
  const corridorItems = items.filter((i) => i.isCorridorPriority);
  const top = corridorItems[0] || items[0] || null;

  return (
    <div className="rounded-[20px] border border-[#ff3b30]/25 bg-[#ff3b30]/10 backdrop-blur-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#ff3b30]">Emergency Info</div>
        <button type="button" onClick={() => onChangeTab('emergency')} className={`${linkBtn} text-white/75 hover:text-white`}>
          {items.length} Active →
        </button>
      </div>
      {isLoadingEmergency && !emergencyBundle ? (
        <div className="text-xs text-white/65">Checking QLD ArcGIS & Guardian IMS feeds…</div>
      ) : top ? (
        <div>
          <div className="text-xs font-semibold text-white line-clamp-1">{top.title}</div>
          <div className="text-[11px] text-white/75 mt-1">
            {corridorItems.length > 0
              ? `Bruce Hwy Corridor: ${corridorItems.length} active priority alert${corridorItems.length > 1 ? 's' : ''}`
              : `${items.length} regional feed items · ${top.sourceLabel}`}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs font-semibold text-white">Bruce Highway Corridor: LOW IMPACT</div>
          <div className="text-[11px] text-white/65 mt-1">No active road closures or warnings reported in North QLD bbox</div>
        </div>
      )}
    </div>
  );
}

/** Short warnings teaser linking to the Alerts tab (the full list lives there). */
function AlertsTeaser() {
  const { weatherBundle, multiModelBundle, onChangeTab } = useAppData();
  const { alerts } = useTabBadges();
  if (alerts === 0) return null;
  const firstTitle =
    weatherBundle?.alerts?.[0]?.headline ||
    weatherBundle?.alerts?.[0]?.eventDescription ||
    multiModelBundle?.bomWarnings?.[0]?.title ||
    'Active warnings in your area';

  return (
    <button
      type="button"
      onClick={() => onChangeTab('alerts')}
      className="w-full text-left rounded-[20px] border border-[#ff3b30]/40 bg-[#ff3b30]/15 backdrop-blur-xl p-4 flex items-center gap-3 cursor-pointer hover:bg-[#ff3b30]/20 transition-colors"
    >
      <AlertTriangle className="w-5 h-5 text-[#ff3b30] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-rose-200">
          {alerts} Active Warning{alerts > 1 ? 's' : ''}
        </div>
        <div className="text-xs text-white/90 truncate mt-0.5">{firstTitle}</div>
      </div>
      <span className="text-[11px] font-medium text-white/75 shrink-0">View →</span>
    </button>
  );
}

/** "Weather" tab: consensus bento, corridor briefing, emergency summary and Google detail widgets. */
export function OverviewPanel() {
  const { selectedLocation, multiModelBundle, emergencyBundle, emergencyDashboardEnabled, weatherBundle, unitSystem } =
    useAppData();
  const { current, hasCurrentWeather } = useCurrentConditions();
  const hasExtended = hasCurrentWeather && (weatherBundle?.daily?.length ?? 0) > 0;
  const hasHourly =
    (weatherBundle?.hourly?.length ?? 0) > 0 || (weatherBundle?.historyHours?.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      <CycloneThreatSection />
      <AlertsTeaser />
      <ConsensusBento />
      <CorridorBriefingCard
        selectedLocation={selectedLocation}
        multiModelBundle={multiModelBundle}
        emergencyBundle={emergencyDashboardEnabled ? emergencyBundle : null}
      />
      {emergencyDashboardEnabled && <EmergencySummaryCard />}
      {hasExtended && current && <AtmosphericMetricsGrid current={current} unitSystem={unitSystem} />}
      {hasExtended && hasHourly && (
        <HourlyForecastTimeline hourly={weatherBundle?.hourly} historyHours={weatherBundle?.historyHours} />
      )}
      {hasExtended && current && <SunMoonTracker current={current} />}
    </div>
  );
}
