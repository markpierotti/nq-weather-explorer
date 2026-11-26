/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import type { TrackerLeadScore, TrackerSiteSummary, TrackerSummaryResponse } from '../../types/weather';
import { MIN_BIAS_DAYS } from '../../utils/consensus';

function tempLine(l: TrackerLeadScore | undefined) {
  const t = l?.tmax;
  if (!t || t.n < MIN_BIAS_DAYS) return null;
  const dir = Math.abs(t.bias) < 0.3 ? 'about right' : `${Math.abs(t.bias).toFixed(1)}° ${t.bias < 0 ? 'cold' : 'warm'}`;
  return { dir, mae: t.mae, fixed: t.maeCorrected, n: t.n };
}

function rainPct(l: TrackerLeadScore | undefined): string {
  return l?.rain && l.rain.n >= MIN_BIAS_DAYS ? `${l.rain.correctPct}%` : '—';
}

/** How each source's forecasts have compared with the nearest BOM station (forecast tracker). */
export function TrackRecordCard({
  summary,
  preferredSiteId,
  fmtDelta,
}: {
  summary: TrackerSummaryResponse | null;
  preferredSiteId?: string | null;
  fmtDelta: (c: number) => string;
}) {
  const scored = (summary?.sites ?? []).filter((s) => s.station);
  const [siteId, setSiteId] = useState<string | null>(preferredSiteId ?? null);
  useEffect(() => {
    if (preferredSiteId) setSiteId(preferredSiteId);
  }, [preferredSiteId]);
  if (!summary || scored.length === 0) return null;
  const site: TrackerSiteSummary = scored.find((s) => s.id === siteId) ?? scored[0];

  return (
    <div className="ios-bento-card p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/60 flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-[#32ADE6]" aria-hidden="true" />
          <span>Track record</span>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Station">
          {scored.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === site.id}
              onClick={() => setSiteId(s.id)}
              className={`h-9 lg:h-7 px-2.5 rounded-full text-[11px] font-semibold cursor-pointer transition-colors ${
                s.id === site.id ? 'bg-[#32ADE6] text-[#111113]' : 'bg-white/10 text-white/70 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!summary.observationsEnabled ? (
        <p className="text-[11px] text-white/60">Station observations aren't configured on this server yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-white/60 text-left">
                <th className="py-1.5 pr-2 font-medium">Source</th>
                <th className="py-1.5 px-1 font-medium">Max temp, 1 day ahead</th>
                <th className="py-1.5 pl-1 font-medium text-right">Rain right 1 · 3 days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {site.sources.map((src) => {
                const l1 = src.leads.find((l) => l.lead === 1);
                const l3 = src.leads.find((l) => l.lead === 3);
                const t = tempLine(l1);
                const n = Math.max(l1?.tmax?.n ?? 0, l1?.rain?.n ?? 0);
                return (
                  <tr key={src.id} className="align-top">
                    <td className="py-2 pr-2 text-white font-medium">{src.label}</td>
                    {t ? (
                      <td className="py-2 px-1">
                        <div className="text-white">Runs {t.dir}</div>
                        <div className="text-white/60">
                          Typical error {fmtDelta(t.mae)}, {fmtDelta(t.fixed)} once corrected
                        </div>
                      </td>
                    ) : (
                      <td className="py-2 px-1 text-white/60" colSpan={n < MIN_BIAS_DAYS ? 2 : 1}>
                        Collecting data ({n} of {MIN_BIAS_DAYS} days)
                      </td>
                    )}
                    {(t || n >= MIN_BIAS_DAYS) && (
                      <td className="py-2 pl-1 text-right font-mono text-white">
                        {rainPct(l1)} · {rainPct(l3)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-white/60 leading-relaxed">
        Compared with what {site.station?.name ?? 'the station'} measured over the last {site.obsDays} days. "Rain
        right" counts days correctly called wet (1 mm or more) or dry; BOM counts as calling rain at 50%+ chance.
        "Main run" is each centre's single high-resolution forecast, which has two months of history; the averaged
        versions the app shows have been logged since {site.loggingSince ?? 'today'}.
      </p>
    </div>
  );
}
