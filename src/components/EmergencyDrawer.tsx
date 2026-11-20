/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import {
  Search,
  RefreshCw,
  AlertTriangle,
  Zap,
  Car,
  Flame,
  Fuel,
  ShieldAlert,
  Settings2,
  MapPin,
  ChevronDown,
  ChevronUp,
  Waves,
  TrafficCone,
  Megaphone,
} from 'lucide-react';
import {
  EmergencyBundle,
  EmergencyCategory,
  EmergencyFeatureItem,
} from '../types/weather';
import { DEFAULT_EMERGENCY_PROXY } from '../services/emergencyApi';
import { IosSwitch } from './panels/ModeToggles';
import { GaugeDetail } from './emergency/GaugeDetail';

interface EmergencyDrawerProps {
  isEnabled: boolean;
  onToggleEnabled: () => void;
  bundle: EmergencyBundle | null;
  isLoading: boolean;
  proxyUrl: string;
  onChangeProxyUrl: (url: string) => void;
  onRefresh: () => void;
  onFocusItem: (item: EmergencyFeatureItem) => void;
}

type CategoryFilter = 'all' | 'corridor' | 'road' | 'outage' | 'warning' | 'gauges' | 'qfd' | 'support';

const isRoad = (i: EmergencyFeatureItem) => i.category === 'road' || i.category === 'traffic';
const isWarning = (i: EmergencyFeatureItem) =>
  i.category === 'warning' || i.category === 'cyclone' || i.category === 'bom_warning';

export function EmergencyDrawer({
  isEnabled,
  onToggleEnabled,
  bundle,
  isLoading,
  proxyUrl,
  onChangeProxyUrl,
  onRefresh,
  onFocusItem,
}: EmergencyDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [showFeedStatus, setShowFeedStatus] = useState(false);

  const items = bundle?.items || [];
  const feedStatuses = bundle?.feedStatuses || [];

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'corridor' && !item.isCorridorPriority) return false;
      if (filter === 'road' && !isRoad(item)) return false;
      if (filter === 'outage' && item.category !== 'outage') return false;
      if (filter === 'warning' && !isWarning(item)) return false;
      if (filter === 'gauges' && item.category !== 'river_gauge') return false;
      if (filter === 'qfd' && item.category !== 'qfd' && item.category !== 'fire_danger') return false;
      if (
        filter === 'support' &&
        item.category !== 'fuel' &&
        item.category !== 'evac' &&
        item.category !== 'sandbag' &&
        item.category !== 'bulletin'
      ) {
        return false;
      }

      if (!q) return true;
      const haystack = `${item.title} ${item.subtitle || ''} ${item.description || ''} ${item.sourceLabel} ${item.corridorTags.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, filter, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: items.length,
      corridor: items.filter((i) => i.isCorridorPriority).length,
      road: items.filter(isRoad).length,
      outage: items.filter((i) => i.category === 'outage').length,
      warning: items.filter(isWarning).length,
      gauges: items.filter((i) => i.category === 'river_gauge').length,
      qfd: items.filter((i) => i.category === 'qfd' || i.category === 'fire_danger').length,
      support: items.filter((i) => ['fuel', 'evac', 'sandbag', 'bulletin'].includes(i.category)).length,
    };
  }, [items]);

  const getCategoryIcon = (cat: EmergencyCategory) => {
    switch (cat) {
      case 'road':
        return <Car className="w-3.5 h-3.5 text-[#ff9500] shrink-0" />;
      case 'outage':
        return <Zap className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      case 'warning':
      case 'cyclone':
        return <ShieldAlert className="w-3.5 h-3.5 text-[#ff3b30] shrink-0" />;
      case 'qfd':
      case 'fire_danger':
        return <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
      case 'fuel':
      case 'evac':
      case 'sandbag':
        return <Fuel className="w-3.5 h-3.5 text-[#34c759] shrink-0" />;
      case 'river_gauge':
        return <Waves className="w-3.5 h-3.5 text-[#32ADE6] shrink-0" />;
      case 'traffic':
        return <TrafficCone className="w-3.5 h-3.5 text-[#ff9500] shrink-0" />;
      case 'bom_warning':
        return <Megaphone className="w-3.5 h-3.5 text-[#ff3b30] shrink-0" />;
      default:
        return <AlertTriangle className="w-3.5 h-3.5 text-white/60 shrink-0" />;
    }
  };

  const getCategoryLabel = (cat: EmergencyCategory) => {
    switch (cat) {
      case 'road':
        return 'Road / TMR';
      case 'outage':
        return 'Power Outage';
      case 'warning':
        return 'Flood / Storm';
      case 'cyclone':
        return 'Cyclone';
      case 'qfd':
        return 'QFD Incident';
      case 'fire_danger':
        return 'Fire Danger';
      case 'fuel':
        return 'Fuel Site';
      case 'evac':
        return 'Evac Centre';
      case 'sandbag':
        return 'Sandbags';
      case 'bulletin':
        return 'Bulletin';
      case 'river_gauge':
        return 'River Gauge';
      case 'traffic':
        return 'QLDTraffic';
      case 'bom_warning':
        return 'BOM Warning';
    }
  };

  const blockedCount = feedStatuses.filter((f) => f.status === 'blocked').length;

  return (
    <div className="space-y-3 text-white">
      {/* Header + Emergency Switch */}
      <div className="ios-bento-card p-3.5 flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
            Closures, Outages & Warnings
          </div>
          <p className="text-[11px] text-white/65 mt-0.5">
            QLD ArcGIS · Burdekin & Townsville Guardian IMS
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <IosSwitch
            id="btn-emergency-drawer-toggle"
            checked={isEnabled}
            onToggle={onToggleEnabled}
            activeClass="bg-[#ff9500]"
            title={isEnabled ? 'Turn Emergency Dashboard OFF' : 'Turn Emergency Dashboard ON'}
          />
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className={`w-11 h-11 lg:w-auto lg:h-auto lg:p-1.5 flex items-center justify-center rounded-lg border text-xs transition-colors cursor-pointer ${
              showSettings
                ? 'bg-[#32ADE6]/25 border-[#32ADE6]/50 text-[#32ADE6]'
                : 'bg-white/10 border-white/10 text-white/75 hover:bg-white/15'
            }`}
            title="Configure Guardian IMS CORS Proxy"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          {isEnabled && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="w-11 h-11 lg:w-auto lg:h-auto lg:p-1.5 flex items-center justify-center rounded-lg bg-white/10 border border-white/10 text-white/80 hover:bg-white/15 transition-colors cursor-pointer"
              title="Refresh Emergency Feeds"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#32ADE6]' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {!isEnabled && (
        <div className="ios-bento-card p-6 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-white/10 text-white/65 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-white">Emergency Dashboard is OFF</div>
            <p className="text-xs text-white/60 leading-relaxed">
              Map overlays and live feeds for Bruce Highway road closures, Ergon outages, QFD incidents, and warnings are hidden.
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleEnabled}
            className="min-h-11 lg:min-h-0 px-4 py-2 rounded-xl bg-[#ff9500] hover:bg-amber-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Turn ON Emergency Dashboard
          </button>
        </div>
      )}

      {/* Proxy Settings */}
      {showSettings && (
        <div className="ios-bento-card p-3.5 space-y-2 text-xs">
          <div className="font-semibold text-white">Guardian IMS Council Feed Proxy</div>
          <p className="text-[11px] text-white/60 leading-snug">
            Burdekin & Townsville <code className="font-mono">/dashboard/*</code> feeds route through the built-in server proxy by default.
          </p>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => onChangeProxyUrl(e.target.value)}
            placeholder={DEFAULT_EMERGENCY_PROXY}
            className="w-full px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/15 font-mono text-[11px] text-white focus:outline-none focus:border-[#32ADE6]"
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => onChangeProxyUrl('/api/emergency/proxy?url=')}
              className="px-2.5 py-1 rounded-lg bg-[#32ADE6]/20 border border-[#32ADE6]/40 text-[10px] font-semibold text-[#32ADE6] cursor-pointer"
            >
              Built-in Proxy (Default)
            </button>
            <button
              type="button"
              onClick={() => onChangeProxyUrl('http://localhost:8787/api/emergency')}
              className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/15 text-[10px] font-medium text-white/80 cursor-pointer"
            >
              localhost:8787
            </button>
            <button
              type="button"
              onClick={() => onChangeProxyUrl('https://api.allorigins.win/raw?url=')}
              className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/15 text-[10px] font-medium text-white/80 cursor-pointer"
            >
              AllOrigins
            </button>
          </div>
        </div>
      )}

      {isEnabled && (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/45 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter Bruce Hwy, Ayr, Giru, Home Hill, Townsville..."
              className="w-full pl-8 pr-3 py-2.5 lg:py-2 rounded-xl bg-white/10 border border-white/10 text-base lg:text-xs text-white placeholder:text-white/45 focus:outline-none focus:border-[#32ADE6]"
            />
          </div>

          {/* Category Filters */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {(
              [
                { id: 'all', label: `All (${counts.all})` },
                { id: 'corridor', label: `Corridor (${counts.corridor})` },
                { id: 'road', label: `Roads (${counts.road})` },
                { id: 'outage', label: `Outages (${counts.outage})` },
                { id: 'warning', label: `Warnings (${counts.warning})` },
                { id: 'gauges', label: `Rivers (${counts.gauges})` },
                { id: 'qfd', label: `QFD (${counts.qfd})` },
                { id: 'support', label: `Support (${counts.support})` },
              ] as Array<{ id: CategoryFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-11 lg:min-h-0 px-3 lg:px-2.5 py-1 rounded-lg text-xs lg:text-[11px] font-medium whitespace-nowrap shrink-0 border transition-colors cursor-pointer tabular-nums ${
                  filter === tab.id
                    ? 'bg-white text-[#111113] border-white font-semibold'
                    : 'bg-white/[0.07] border-white/10 text-white/70 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Items List */}
          {isLoading && items.length === 0 ? (
            <div className="space-y-2">
              <div className="h-16 rounded-2xl bg-white/[0.08] animate-pulse" />
              <div className="h-16 rounded-2xl bg-white/[0.08] animate-pulse" />
              <div className="h-16 rounded-2xl bg-white/[0.08] animate-pulse" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="ios-bento-card p-4 text-center text-xs text-white/60">
              {items.length === 0
                ? 'No active closures, outages, or emergency warnings returned for the NQ bbox.'
                : 'No events match your current search or filter.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => {
                const canFocus = item.lat !== null && item.lng !== null;
                return (
                  <div
                    key={item.id}
                    className={`rounded-[18px] border p-3.5 transition-colors backdrop-blur-xl ${
                      item.isCorridorPriority
                        ? 'bg-[#ff3b30]/12 border-[#ff3b30]/35'
                        : 'bg-white/[0.08] border-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className="mt-0.5">{getCategoryIcon(item.category)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-white/55 flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-white/85">
                              {getCategoryLabel(item.category)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{item.sourceLabel}</span>
                            {item.isCorridorPriority && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-[#ff9500]">
                                  Corridor ({item.corridorTags.join(', ')})
                                </span>
                              </>
                            )}
                          </div>

                          <h4 className="text-xs font-semibold text-white mt-0.5 leading-snug">
                            {item.title}
                          </h4>

                          {item.subtitle && item.subtitle !== item.title && (
                            <div className="text-[11px] font-medium text-white/75 mt-0.5">
                              {item.subtitle}
                            </div>
                          )}

                          {item.gauge ? (
                            <div className="mt-1.5">
                              <GaugeDetail gauge={item.gauge} tone="dark" />
                            </div>
                          ) : (
                            item.description && (
                              <p className="text-[11px] text-white/65 mt-1 leading-relaxed line-clamp-3">
                                {item.description}
                              </p>
                            )
                          )}
                        </div>
                      </div>

                      {canFocus && (
                        <button
                          type="button"
                          onClick={() => onFocusItem(item)}
                          className="w-11 h-11 lg:w-auto lg:h-auto lg:p-1.5 flex items-center justify-center rounded-lg bg-white/10 hover:bg-[#32ADE6]/25 text-white/75 hover:text-[#32ADE6] shrink-0 cursor-pointer transition-colors"
                          title="Center map on event"
                          aria-label="Center map on event"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Feed Health */}
          <div className="ios-bento-card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowFeedStatus((v) => !v)}
              className="w-full min-h-11 lg:min-h-0 px-3.5 py-2.5 flex items-center justify-between text-[11px] font-medium text-white/75 hover:text-white cursor-pointer"
            >
              <span>
                Feed Health ({feedStatuses.length - blockedCount}/{feedStatuses.length} reachable
                {blockedCount > 0 ? ` · ${blockedCount} blocked/proxied` : ''})
              </span>
              {showFeedStatus ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showFeedStatus && (
              <div className="px-3.5 pb-3 pt-2 border-t border-white/10 space-y-1 text-[10px] font-mono">
                {feedStatuses.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-white/65">
                    <span className="truncate">{f.label}</span>
                    <span
                      className={`shrink-0 font-semibold ${
                        f.status === 'ok'
                          ? 'text-[#34c759]'
                          : f.status === 'proxied'
                          ? 'text-[#32ADE6]'
                          : f.status === 'empty'
                          ? 'text-white/45'
                          : 'text-[#ff3b30]'
                      }`}
                    >
                      {f.status.toUpperCase()} ({f.count})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
