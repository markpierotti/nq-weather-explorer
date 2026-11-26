import { useState } from 'react';
import { Cloud, CloudRain, Sun, CloudLightning, CloudSnow, History, Sparkles } from 'lucide-react';
import { HourlyForecast } from '../types/weather';

interface HourlyForecastTimelineProps {
  hourly?: HourlyForecast[];
  historyHours?: HourlyForecast[];
}

export function HourlyForecastTimeline({ hourly = [], historyHours = [] }: HourlyForecastTimelineProps) {
  const [viewMode, setViewMode] = useState<'FORECAST' | 'HISTORY'>('FORECAST');

  const hasHistory = Array.isArray(historyHours) && historyHours.length > 0;
  const hasForecast = Array.isArray(hourly) && hourly.length > 0;

  if (!hasForecast && !hasHistory) return null;

  const currentList = viewMode === 'HISTORY' && hasHistory ? historyHours : hourly;

  const getConditionIcon = (type?: string) => {
    const t = (type || '').toLowerCase();
    if (t.includes('rain') || t.includes('shower')) return <CloudRain className="w-4 h-4 text-[#32ADE6]" />;
    if (t.includes('thunder') || t.includes('storm')) return <CloudLightning className="w-4 h-4 text-[#ff9500]" />;
    if (t.includes('snow') || t.includes('ice')) return <CloudSnow className="w-4 h-4 text-sky-200" />;
    if (t.includes('cloud')) return <Cloud className="w-4 h-4 text-white/60" />;
    return <Sun className="w-4 h-4 text-[#ff9500]" />;
  };

  const formatHour = (item: HourlyForecast, idx: number, isHistory: boolean) => {
    if (!isHistory && idx === 0) return 'Now';
    if (item.displayDateTime?.hours !== undefined) {
      const h = item.displayDateTime.hours;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const formatted = h % 12 === 0 ? 12 : h % 12;
      return `${formatted}${ampm}`;
    }
    if (item.interval?.startTime) {
      const d = new Date(item.interval.startTime);
      return d.toLocaleTimeString([], { hour: 'numeric', hour12: true });
    }
    return isHistory ? `-${idx + 1}h` : `+${idx}h`;
  };

  return (
    <div className="ios-bento-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center bg-white/[0.08] p-0.5 rounded-lg border border-white/10 text-xs font-medium">
          <button
            type="button"
            onClick={() => setViewMode('FORECAST')}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px] whitespace-nowrap shrink-0 ${
              viewMode === 'FORECAST'
                ? 'bg-[#32ADE6] text-[#111113] font-semibold'
                : 'text-white/65 hover:text-white'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Next 24h</span>
          </button>
          {hasHistory && (
            <button
              type="button"
              onClick={() => setViewMode('HISTORY')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px] whitespace-nowrap shrink-0 ${
                viewMode === 'HISTORY'
                  ? 'bg-[#5856d6] text-white font-semibold'
                  : 'text-white/65 hover:text-white'
              }`}
            >
              <History className="w-3 h-3" />
              <span>Past 24h</span>
            </button>
          )}
        </div>

        <span className="text-[11px] text-white/60 font-mono">HOURLY</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar select-none tabular-nums">
        {currentList.slice(0, 24).map((h, idx) => {
          const temp = h.temperature?.degrees !== undefined ? Math.round(h.temperature.degrees) : '--';
          const precipProb = h.precipitation?.probability?.percent ?? 0;
          const conditionType = h.weatherCondition?.type;
          const isHistory = viewMode === 'HISTORY';

          return (
            <div
              key={idx}
              className={`shrink-0 flex flex-col items-center justify-between p-2.5 rounded-2xl border transition-colors ${
                !isHistory && idx === 0
                  ? 'bg-[#32ADE6]/20 border-[#32ADE6]/45 text-white min-w-[60px]'
                  : 'bg-white/[0.05] border-white/[0.08] text-white/85 min-w-[58px]'
              }`}
            >
              <span className="text-[11px] font-medium text-white/65">
                {formatHour(h, idx, isHistory)}
              </span>

              <div className="my-2 flex flex-col items-center gap-1">
                {getConditionIcon(conditionType)}
                {precipProb > 10 && (
                  <span className="text-[11px] font-bold text-[#32ADE6]">{precipProb}%</span>
                )}
              </div>

              <span className="text-xs font-semibold text-white">{temp}°</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
