/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Sparkles, RefreshCw, ExternalLink, AlertCircle, Globe } from 'lucide-react';
import {
  CorridorBriefingResponse,
  EmergencyBundle,
  MultiModelBundle,
  WeatherLocation,
} from '../types/weather';

interface CorridorBriefingCardProps {
  selectedLocation: WeatherLocation;
  multiModelBundle: MultiModelBundle | null;
  emergencyBundle: EmergencyBundle | null;
}

export function CorridorBriefingCard({
  selectedLocation,
  multiModelBundle,
  emergencyBundle,
}: CorridorBriefingCardProps) {
  const [briefing, setBriefing] = useState<CorridorBriefingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateBriefing = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const multiModelSummary = multiModelBundle
        ? {
            location: selectedLocation.name,
            bomLocation: multiModelBundle.bomLocation,
            spreadOverview: multiModelBundle.spreadOverview,
            bomWarnings: multiModelBundle.bomWarnings.slice(0, 5),
            next3Days: multiModelBundle.daily7d.slice(0, 3).map((d) => ({
              day: d.dayLabel,
              weatherNext2: d.weatherNext2,
              bom: d.bom,
              ecmwf: d.ecmwf,
              gfs: d.gfs,
              deltaMaxTempC: d.deltaMaxTemp,
              deltaRainMm: d.deltaRainMm,
            })),
          }
        : { location: selectedLocation.name, note: 'Multi-model data still loading' };

      const items = emergencyBundle?.items || [];
      const blockedFeedsCount =
        emergencyBundle?.feedStatuses.filter((f) => f.status === 'blocked').length ?? 0;

      const emergencySummary = {
        totalActiveItems: items.length,
        corridorPriorityCount: items.filter((i) => i.isCorridorPriority).length,
        corridorPriorityItems: items
          .filter((i) => i.isCorridorPriority)
          .slice(0, 10)
          .map((i) => ({
            category: i.category,
            title: i.title,
            status: i.status,
            subtitle: i.subtitle,
            tags: i.corridorTags,
          })),
        otherRegionalHighlights: items
          .filter((i) => !i.isCorridorPriority)
          .slice(0, 8)
          .map((i) => ({
            category: i.category,
            title: i.title,
            status: i.status,
          })),
        blockedFeeds: emergencyBundle?.feedStatuses
          .filter((f) => f.status === 'blocked')
          .map((f) => f.label),
      };

      const res = await fetch('/api/briefing/corridor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationName: selectedLocation.name,
          multiModelSummary,
          emergencySummary,
          blockedFeedsCount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Briefing request failed (${res.status})`);
      }
      setBriefing(data);
    } catch (err: any) {
      setError(err?.message || 'Could not generate AI Corridor Briefing.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderBoldMarkdown = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="ios-bento-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#32ADE6]" />
            <span>AI Corridor Briefing</span>
          </div>
          <p className="text-[11px] text-white/55 mt-1">
            4-bullet wet-season synthesis · Gemini 4 Flash + Search
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerateBriefing}
          disabled={isLoading}
          className="px-3 py-1.5 rounded-[10px] bg-[#32ADE6] hover:bg-[#4cbdf0] disabled:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{briefing ? 'Refresh' : 'Generate'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#ff3b30]/40 bg-[#ff3b30]/15 p-3 text-[11px] text-rose-100 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-[#ff3b30] shrink-0 mt-0.5" />
          <div className="leading-relaxed">{error}</div>
        </div>
      )}

      {!briefing && !isLoading && !error && (
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 text-xs text-white/70 leading-relaxed">
          Generate a live 4-bullet operational briefing combining WeatherNext 2, BOM, ECMWF, GFS, Burdekin/Townsville feeds, and Google Search grounding for the Ayr ↔ Giru ↔ Townsville corridor.
        </div>
      )}

      {isLoading && (
        <div className="space-y-2 py-1">
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-11/12" />
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-full" />
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-10/12" />
          <div className="h-3.5 bg-white/10 rounded animate-pulse w-9/12" />
        </div>
      )}

      {briefing && !isLoading && (
        <div className="space-y-2.5">
          <ul className="space-y-2 text-[13px] text-white/85 leading-relaxed">
            {briefing.bullets.map((bullet, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-[#32ADE6] font-bold leading-snug shrink-0">•</span>
                <span>{renderBoldMarkdown(bullet)}</span>
              </li>
            ))}
          </ul>

          {briefing.citations.length > 0 && (
            <div className="pt-2.5 border-t border-white/10 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/50 flex items-center gap-1">
                <Globe className="w-3 h-3 text-white/45" />
                <span>Search Grounding Sources</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {briefing.citations.slice(0, 4).map((c) => (
                  <a
                    key={c.uri}
                    href={c.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[#32ADE6] hover:underline inline-flex items-center gap-1 max-w-[200px] truncate"
                  >
                    <span className="truncate">{c.title}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] font-mono text-white/40 flex items-center justify-between pt-2 border-t border-white/10 tabular-nums">
            <span>{briefing.model}</span>
            <span>
              {new Date(briefing.generatedAt).toLocaleTimeString('en-AU', {
                timeZone: 'Australia/Brisbane',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              AEST
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
