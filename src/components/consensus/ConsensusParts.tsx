/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Info } from 'lucide-react';
import type { TrackerSiteSummary } from '../../types/weather';
import {
  CONFIDENCE_LABEL,
  CONSENSUS_MODELS,
  type Confidence,
  type ConsensusModel,
  type Corrections,
} from '../../utils/consensus';
import { MIN_MODELS } from '../../hooks/useModelSelection';

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: '#34c759',
  moderate: '#ff9500',
  low: '#ff3b30',
};

export function ConfidenceDot({ confidence }: { confidence: Confidence | null }) {
  if (!confidence) return <span className="inline-block w-2 h-2 rounded-full bg-white/25" aria-hidden="true" />;
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: CONFIDENCE_COLOR[confidence] }}
      title={CONFIDENCE_LABEL[confidence]}
      aria-label={CONFIDENCE_LABEL[confidence]}
      role="img"
    />
  );
}

/** Toggle chips for the models that feed the best estimate and agreement. */
export function ModelPicker({ selected, onToggle }: { selected: ConsensusModel[]; onToggle: (id: ConsensusModel) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Models used for the best estimate">
      <span className="text-[11px] text-white/60 mr-0.5">Using</span>
      {CONSENSUS_MODELS.map((m) => {
        const on = selected.includes(m.id);
        const locked = on && selected.length <= MIN_MODELS;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onToggle(m.id)}
            aria-pressed={on}
            aria-disabled={locked}
            title={locked ? `At least ${MIN_MODELS} models are needed to compare` : `${on ? 'Exclude' : 'Include'} ${m.label}`}
            className={`h-9 lg:h-7 px-2.5 rounded-full text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
              on ? 'bg-[#32ADE6] text-[#111113] hover:bg-[#4cbdf0]' : 'bg-white/10 text-white/60 hover:text-white'
            } ${locked ? 'cursor-not-allowed' : ''}`}
          >
            {m.short}
          </button>
        );
      })}
    </div>
  );
}

export function InfoToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label="How to read the consensus"
      title="How to read the consensus"
      className={`w-9 h-9 lg:w-7 lg:h-7 -my-2 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
        open ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'
      }`}
    >
      <Info className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

const SOURCE_NAME: Record<string, string> = {
  bom: 'BOM',
  wn2: 'WeatherNext 2',
  ecmwf: 'ECMWF',
  gfs: 'GFS',
  ecmwf_det: 'ECMWF',
  gfs_det: 'GFS',
};

function biasPhrase(b: number): string {
  if (Math.abs(b) < 0.3) return 'about right';
  return `${Math.abs(b).toFixed(1)}° ${b < 0 ? 'cold' : 'warm'}`;
}

/** The ⓘ explainer: what agreement, Δ and the best estimate mean, the town-vs-grid effect, and local numbers. */
export function ConsensusInfoPanel({
  id,
  site,
  corrections,
}: {
  id: string;
  site: TrackerSiteSummary | null;
  corrections: Corrections | null;
}) {
  const local = corrections
    ? CONSENSUS_MODELS.map((m) => ({ m, c: corrections[m.id][1] })).filter(
        (x): x is { m: (typeof CONSENSUS_MODELS)[number]; c: NonNullable<typeof x.c> } => !!x.c && x.c.tmax !== null,
      )
    : [];
  return (
    <div id={id} className="mt-3 rounded-xl bg-white/[0.06] border border-white/10 p-3 space-y-2 text-[11px] leading-relaxed text-white/75">
      <p>
        <strong className="text-white">Consensus</strong> compares independent forecasts: BOM's official town forecast,
        Google DeepMind's WeatherNext 2 (AI), ECMWF (European) and GFS (US). When they agree, the forecast is more
        trustworthy. When they disagree, that day is genuinely uncertain: check again closer to the day.
      </p>
      <p>
        <strong className="text-white">Agreement</strong>:{' '}
        <span style={{ color: CONFIDENCE_COLOR.high }}>High Agreement</span> means max temperatures within 1.5° and rain
        in the same band. <span style={{ color: CONFIDENCE_COLOR.moderate }}>Moderate Spread</span> means within 3°, or
        rain one band apart (e.g. dry vs showers). <span style={{ color: CONFIDENCE_COLOR.low }}>High Divergence</span>{' '}
        means bigger gaps (e.g. dry vs wet). Rain bands: dry under 1 mm, showers 1–10, wet 10–25, heavy 25+.
      </p>
      <p>
        <strong className="text-white">Δ (delta)</strong> is the highest forecast minus the lowest: ΔT for max
        temperature, ΔR for rain.
      </p>
      <p>
        <strong className="text-white">Best estimate</strong> is the middle value (median) of the models you've chosen,
        so one outlier can't drag it.
        {local.length > 0 && site?.station
          ? ` Temperatures are first corrected for how far off each model has run at ${site.station.name}. Models without enough local history yet (10 days) are "calibrating": they still count for rain, but their temperatures are left out so their grid bias can't drag the estimate.`
          : ''}
      </p>
      <p>
        <strong className="text-white">Town vs grid</strong>: BOM forecasts for the town itself. The models forecast the
        average over a grid square about 25 km wide, which on the coast can include sea, so their maxima tend to run
        cooler and minima warmer than the town.
        {local.length > 0 && site?.station && (
          <>
            {' '}
            At {site.station.name} (1 day ahead, last {site.obsDays} days):{' '}
            {local.map(({ m, c }, i) => (
              <span key={m.id}>
                {i > 0 ? (i === local.length - 1 ? ' and ' : ', ') : ''}
                {SOURCE_NAME[c.from]}
                {c.from.endsWith('_det') ? ' (main run)' : ''} max temps ran {biasPhrase(c.tmax!)}
              </span>
            ))}
            .
          </>
        )}
      </p>
      <p>
        <strong className="text-white">Rain amounts</strong>: WeatherNext 2, ECMWF and GFS here are averages of many runs,
        which spread rain thinly. "2 mm" often means "a shower is possible", not that 2 mm will fall.
      </p>
      <p>
        <strong className="text-white">Which to trust</strong>: BOM is usually best for the next 1–2 days at your town.
        Further out, ECMWF and WeatherNext 2 are generally the strongest global models, with GFS a step behind. The
        Track record on the Models tab shows how each has actually done here.
      </p>
    </div>
  );
}
