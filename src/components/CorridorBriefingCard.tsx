/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Globe,
  MessageSquare,
  Send,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Trash2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import {
  BriefingChatEvent,
  BriefingChatMessage,
  BriefingFeedHealth,
  BriefingGroundingReport,
  BriefingRisk,
  CorridorBriefingResponse,
  EmergencyBundle,
  GroundingCitation,
  MultiModelBundle,
  WeatherLocation,
} from '../types/weather';

interface CorridorBriefingCardProps {
  selectedLocation: WeatherLocation;
  multiModelBundle: MultiModelBundle | null;
  emergencyBundle: EmergencyBundle | null;
}

interface ChatTurn extends BriefingChatMessage {
  citations?: GroundingCitation[];
  grounding?: BriefingGroundingReport;
  feedHealth?: BriefingFeedHealth[];
  intent?: string;
  isStreaming?: boolean;
}

const RISK_STYLES: Record<BriefingRisk, { badge: string; dot: string }> = {
  LOW: {
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  MODERATE: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  HIGH: {
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    dot: 'bg-orange-400',
  },
  EXTREME: {
    badge: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
    dot: 'bg-rose-400',
  },
};

const QUICK_QUESTIONS = [
  'Is the Bruce Hwy open between Townsville and Ayr?',
  'When is the heaviest rain window?',
  'Any river gauges rising near flood levels?',
];

const FEED_LABELS: Record<BriefingFeedHealth['feed'], string> = {
  traffic: 'QLDTraffic',
  'bom-warnings': 'BOM',
  gauges: 'Gauges',
};

function GroundingStatusBar({
  grounding,
  feedHealth,
}: {
  grounding?: BriefingGroundingReport;
  feedHealth?: BriefingFeedHealth[];
}) {
  if (!grounding && (!feedHealth || feedHealth.length === 0)) return null;

  const degradedFeeds = (feedHealth || []).filter((f) => f.status !== 'live');
  const scorePct =
    grounding?.checked && typeof grounding.supportScore === 'number'
      ? Math.round(grounding.supportScore * 100)
      : null;

  return (
    <div className="space-y-1.5 pt-2 border-t border-white/10">
      <div className="flex flex-wrap items-center gap-1.5">
        {grounding?.checked && grounding.passed && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>Verified against live feeds{scorePct !== null ? ` (${scorePct}%)` : ''}</span>
          </span>
        )}

        {grounding?.checked && !grounding.passed && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/15 text-amber-200 border border-amber-500/35">
            <ShieldAlert className="w-3 h-3 shrink-0" />
            <span>
              Grounding check flagged ({scorePct !== null ? `${scorePct}%` : 'low'})
            </span>
          </span>
        )}

        {feedHealth && feedHealth.length > 0 && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
              degradedFeeds.length > 0
                ? 'bg-amber-500/10 text-amber-200 border-amber-500/30'
                : 'bg-white/[0.05] text-white/65 border-white/10'
            }`}
          >
            <span>
              Feeds:{' '}
              {feedHealth
                .map((f) =>
                  f.status === 'live'
                    ? `${FEED_LABELS[f.feed]} ✓`
                    : `${FEED_LABELS[f.feed]} (${f.status})`,
                )
                .join(' · ')}
            </span>
          </span>
        )}
      </div>

      <p className="text-[10px] text-white/60 leading-snug">
        Verify live conditions on QLDTraffic &amp; BOM before travelling — never drive through floodwater.
      </p>
    </div>
  );
}

export function CorridorBriefingCard({
  selectedLocation,
  multiModelBundle,
  emergencyBundle,
}: CorridorBriefingCardProps) {
  const [briefing, setBriefing] = useState<CorridorBriefingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});

  // Follow-up chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Abort any in-flight stream on unmount or location change
  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    chatAbortRef.current?.abort();
    setChatTurns([]);
    setChatError(null);
    setIsChatStreaming(false);
    setExpandedSections({});
  }, [selectedLocation.id]);

  useEffect(() => {
    if (chatOpen && chatTurns.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [chatTurns, chatOpen]);

  const buildContextSummaries = () => {
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

    return { multiModelSummary, emergencySummary, blockedFeedsCount };
  };

  const handleGenerateBriefing = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { multiModelSummary, emergencySummary, blockedFeedsCount } = buildContextSummaries();

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
      setExpandedSections({});
    } catch (err: any) {
      setError(err?.message || 'Could not generate AI Corridor Briefing.');
    } finally {
      setIsLoading(false);
    }
  };

  const sendChatMessage = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || isChatStreaming) return;

    setChatOpen(true);
    setChatInput('');
    setChatError(null);

    const priorMessages: BriefingChatMessage[] = chatTurns
      .filter((t) => t.text.trim().length > 0)
      .map((t) => ({ role: t.role, text: t.text }));

    const nextMessages: BriefingChatMessage[] = [
      ...priorMessages,
      { role: 'user', text: question },
    ];

    setChatTurns((prev) => [
      ...prev,
      { role: 'user', text: question },
      { role: 'model', text: '', isStreaming: true },
    ]);
    setIsChatStreaming(true);

    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      const { multiModelSummary, emergencySummary } = buildContextSummaries();

      const res = await fetch('/api/briefing/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextMessages,
          context: {
            locationName: selectedLocation.name,
            lat: selectedLocation.lat,
            lng: selectedLocation.lng,
            multiModelSummary,
            emergencySummary,
          },
        }),
      });

      if (!res.ok) {
        let errMsg = `Chat request failed (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.error) errMsg = errJson.error;
        } catch {
          // ignore non-JSON error body
        }
        throw new Error(errMsg);
      }

      if (!res.body) {
        throw new Error('Streaming response body unavailable.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;

        let event: BriefingChatEvent;
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }

        if (event.type === 'chunk') {
          setChatTurns((prev) => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, text: last.text + event.text };
            return copy;
          });
        } else if (event.type === 'citations') {
          setChatTurns((prev) => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, citations: event.citations };
            return copy;
          });
        } else if (event.type === 'grounding') {
          setChatTurns((prev) => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = {
              ...last,
              grounding: event.grounding,
              feedHealth: event.feedHealth,
              intent: event.intent,
            };
            return copy;
          });
        } else if (event.type === 'error') {
          setChatError(event.error || 'Streaming error occurred.');
        } else if (event.type === 'done') {
          setChatTurns((prev) => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, isStreaming: false };
            return copy;
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line.trim());
        }
      }

      if (buffer.trim()) {
        processLine(buffer.trim());
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setChatError(err?.message || 'Unable to complete follow-up question.');
        setChatTurns((prev) => {
          if (
            prev.length > 0 &&
            prev[prev.length - 1].role === 'model' &&
            !prev[prev.length - 1].text
          ) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      setIsChatStreaming(false);
      setChatTurns((prev) =>
        prev.map((t) => (t.isStreaming ? { ...t, isStreaming: false } : t)),
      );
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
      }
    }
  };

  const handleChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendChatMessage(chatInput);
  };

  const handleClearChat = () => {
    chatAbortRef.current?.abort();
    setChatTurns([]);
    setChatError(null);
    setIsChatStreaming(false);
  };

  const toggleSection = (idx: number) => {
    setExpandedSections((prev) => ({ ...prev, [idx]: !prev[idx] }));
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

  const structured = briefing?.structured;

  return (
    <div className="ios-bento-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/60 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#32ADE6]" />
            <span>AI Corridor Briefing</span>
          </div>
          <p className="text-[11px] text-white/65 mt-1">
            Live-feed grounded synthesis · QLDTraffic + BOM + Gauges
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerateBriefing}
          disabled={isLoading}
          className="px-3 py-1.5 rounded-[10px] bg-[#32ADE6] hover:bg-[#4cbdf0] disabled:bg-white/15 text-[#111113] disabled:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
          Generate a live operational briefing grounded directly in QLDTraffic road events, BOM warnings, river gauges, and multi-model forecasts for the Ayr ↔ Giru ↔ Townsville corridor.
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
        <div className="space-y-3">
          {structured ? (
            <div className="space-y-2.5">
              {/* Overall risk + headline */}
              <div className="flex items-start gap-2 rounded-xl bg-white/[0.04] border border-white/[0.07] p-2.5">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider border shrink-0 mt-0.5 ${RISK_STYLES[structured.overallRisk].badge}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${RISK_STYLES[structured.overallRisk].dot}`}
                  />
                  {structured.overallRisk}
                </span>
                <p className="text-xs font-medium text-white/90 leading-snug">
                  {renderBoldMarkdown(structured.headline)}
                </p>
              </div>

              {/* Structured sections */}
              <div className="space-y-2">
                {structured.sections.map((section, idx) => {
                  const fullDetail = section.details[0] || section.summary;
                  const hasMore = fullDetail.length > section.summary.length;
                  const isExpanded = !!expandedSections[idx];
                  const riskStyle = RISK_STYLES[section.risk];

                  return (
                    <div
                      key={idx}
                      className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-white/90">
                          {section.title}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-semibold uppercase border shrink-0 ${riskStyle.badge}`}
                        >
                          {section.risk}
                        </span>
                      </div>
                      <p className="text-[12.5px] text-white/80 leading-relaxed">
                        {renderBoldMarkdown(isExpanded ? fullDetail : section.summary)}
                        {!isExpanded && hasMore ? '…' : ''}
                      </p>
                      {hasMore && (
                        <button
                          type="button"
                          onClick={() => toggleSection(idx)}
                          className="text-[11px] text-[#32ADE6] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          {isExpanded ? (
                            <>
                              <span>Show less</span>
                              <ChevronUp className="w-3 h-3" />
                            </>
                          ) : (
                            <>
                              <span>Read full note</span>
                              <ChevronDown className="w-3 h-3" />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action items */}
              {structured.actions.length > 0 && (
                <div className="rounded-xl bg-[#32ADE6]/[0.08] border border-[#32ADE6]/25 p-2.5 space-y-1.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#32ADE6] flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Next-24h Actions</span>
                  </div>
                  <ul className="space-y-1 text-xs text-white/85 leading-snug">
                    {structured.actions.map((action, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-[#32ADE6] shrink-0">•</span>
                        <span>{renderBoldMarkdown(action)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-2 text-[13px] text-white/85 leading-relaxed">
              {briefing.bullets.map((bullet, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-[#32ADE6] font-bold leading-snug shrink-0">•</span>
                  <span>{renderBoldMarkdown(bullet)}</span>
                </li>
              ))}
            </ul>
          )}

          {briefing.citations.length > 0 && (
            <div className="pt-2.5 border-t border-white/10 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/60 flex items-center gap-1">
                <Globe className="w-3 h-3 text-white/60" />
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

          <GroundingStatusBar
            grounding={briefing.grounding}
            feedHealth={briefing.feedHealth}
          />

          <div className="text-[10px] font-mono text-white/60 flex items-center justify-between pt-2 border-t border-white/10 tabular-nums">
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

      {/* Follow-up chat toggle & panel */}
      <div className="pt-2 border-t border-white/10 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setChatOpen((prev) => !prev)}
            className="text-xs font-medium text-white/80 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#32ADE6]" />
            <span>Ask a corridor question</span>
            {chatOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-white/60" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-white/60" />
            )}
          </button>

          {chatOpen && chatTurns.length > 0 && (
            <button
              type="button"
              onClick={handleClearChat}
              className="text-[11px] text-white/60 hover:text-white/80 inline-flex items-center gap-1 cursor-pointer"
              title="Clear follow-up chat"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {chatOpen && (
          <div className="space-y-2.5">
            {chatTurns.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isChatStreaming}
                    onClick={() => void sendChatMessage(q)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/80 transition-colors cursor-pointer text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {chatTurns.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {chatTurns.map((turn, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      turn.role === 'user'
                        ? 'bg-[#32ADE6]/20 border border-[#32ADE6]/30 text-white ml-6'
                        : 'bg-white/[0.05] border border-white/[0.07] text-white/85 mr-3 space-y-2'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {turn.text ? (
                        renderBoldMarkdown(turn.text)
                      ) : (
                        <span className="text-white/60 italic">Checking live feeds…</span>
                      )}
                      {turn.isStreaming && turn.text && (
                        <span className="inline-block w-1.5 h-3 bg-[#32ADE6] ml-0.5 align-middle animate-pulse" />
                      )}
                    </div>

                    {turn.citations && turn.citations.length > 0 && (
                      <div className="pt-1.5 border-t border-white/10 flex flex-wrap gap-x-2.5 gap-y-1">
                        {turn.citations.slice(0, 3).map((c) => (
                          <a
                            key={c.uri}
                            href={c.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-[#32ADE6] hover:underline inline-flex items-center gap-0.5 max-w-[180px] truncate"
                          >
                            <span className="truncate">{c.title}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        ))}
                      </div>
                    )}

                    {turn.role === 'model' && !turn.isStreaming && (turn.grounding || turn.feedHealth) && (
                      <GroundingStatusBar
                        grounding={turn.grounding}
                        feedHealth={turn.feedHealth}
                      />
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {chatError && (
              <div className="rounded-lg border border-[#ff3b30]/40 bg-[#ff3b30]/15 px-2.5 py-2 text-[11px] text-rose-100 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-[#ff3b30] shrink-0 mt-0.5" />
                <span>{chatError}</span>
              </div>
            )}

            <form onSubmit={handleChatSubmit} className="flex items-center gap-1.5">
              <input
                id="briefing-chat-input"
                name="briefing-chat-question"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isChatStreaming}
                placeholder={`Ask about ${selectedLocation.name}…`}
                className="flex-1 min-w-0 rounded-xl bg-white/[0.06] border border-white/[0.1] px-3 py-1.5 text-xs text-white placeholder:text-white/60 focus:outline-none focus:border-[#32ADE6]/60"
              />
              <button
                type="submit"
                disabled={isChatStreaming || !chatInput.trim()}
                className="p-2 rounded-xl bg-[#32ADE6] hover:bg-[#4cbdf0] disabled:bg-white/10 disabled:text-white/30 text-[#111113] transition-colors shrink-0 cursor-pointer"
                aria-label="Send follow-up question"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
