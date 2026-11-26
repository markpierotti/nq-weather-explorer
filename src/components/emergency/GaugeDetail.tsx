/**
 * River gauge detail: height, trend, flood class, thresholds and a 24h sparkline (inline SVG).
 * Used in the map InfoWindow (light) and the Emergency list (dark).
 */
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { FloodClass, RiverGaugeReading } from '../../types/weather';

export const FLOOD_CLASS_COLOR: Record<FloodClass, string> = {
  major: '#ff3b30',
  moderate: '#ff9500',
  minor: '#ffcc00',
  below_minor: '#34c759',
  unknown: '#8e8e93',
};

export const FLOOD_CLASS_LABEL: Record<FloodClass, string> = {
  major: 'Major',
  moderate: 'Moderate',
  minor: 'Minor',
  below_minor: 'Below minor',
  unknown: 'Unclassified',
};

const THRESHOLD_COLOR = { minor: FLOOD_CLASS_COLOR.minor, moderate: FLOOD_CLASS_COLOR.moderate, major: FLOOD_CLASS_COLOR.major };

const timeFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Brisbane',
  hour: 'numeric',
  minute: '2-digit',
  day: 'numeric',
  month: 'short',
});

export function formatGaugeTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : timeFmt.format(d);
}

function TrendIcon({ trend, className }: { trend: RiverGaugeReading['trend']; className?: string }) {
  if (trend === 'rising') return <TrendingUp className={className} aria-hidden="true" />;
  if (trend === 'falling') return <TrendingDown className={className} aria-hidden="true" />;
  return <Minus className={className} aria-hidden="true" />;
}

/** Next threshold above the current height, if any. */
function nextThreshold(g: RiverGaugeReading): { name: 'minor' | 'moderate' | 'major'; level: number } | null {
  if (g.heightM === null) return null;
  for (const name of ['minor', 'moderate', 'major'] as const) {
    const level = g.thresholds[name];
    if (level !== null && level > g.heightM) return { name, level };
  }
  return null;
}

export function GaugeSparkline({
  gauge,
  width = 240,
  height = 56,
  tone = 'dark',
}: {
  gauge: RiverGaugeReading;
  width?: number;
  height?: number;
  tone?: 'dark' | 'light';
}) {
  const pts = gauge.history;
  if (pts.length < 2) return null;

  const hs = pts.map((p) => p.heightM);
  let lo = Math.min(...hs);
  let hi = Math.max(...hs);
  // Pull in any threshold that sits reasonably close above the data, so headroom is visible
  // without flattening the line when the river is metres below minor.
  const span0 = Math.max(hi - lo, 0.2);
  const thresholds = (['minor', 'moderate', 'major'] as const)
    .map((k) => ({ k, v: gauge.thresholds[k] }))
    .filter((t): t is { k: 'minor' | 'moderate' | 'major'; v: number } => t.v !== null);
  for (const t of thresholds) {
    if (t.v >= lo - span0 && t.v <= hi + span0 * 1.5) {
      lo = Math.min(lo, t.v);
      hi = Math.max(hi, t.v);
    }
  }
  const pad = Math.max((hi - lo) * 0.12, 0.05);
  lo -= pad;
  hi += pad;

  const t0 = new Date(pts[0].time).getTime();
  const t1 = new Date(pts[pts.length - 1].time).getTime();
  const tSpan = Math.max(t1 - t0, 1);
  const x = (iso: string) => ((new Date(iso).getTime() - t0) / tSpan) * width;
  const y = (h: number) => height - ((h - lo) / (hi - lo)) * height;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.heightM).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const stroke = FLOOD_CLASS_COLOR[gauge.floodClass === 'unknown' ? 'below_minor' : gauge.floodClass];
  const last = pts[pts.length - 1];
  const gridColor = tone === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)';
  const gradId = `gauge-grad-${gauge.stationId}-${tone}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${gauge.stationName} river height, last 24 hours, from ${hs[0].toFixed(2)} m to ${last.heightM.toFixed(2)} m`}
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke={gridColor} strokeWidth="1" />
      {thresholds
        .filter((t) => t.v >= lo && t.v <= hi)
        .map((t) => (
          <line
            key={t.k}
            x1="0"
            x2={width}
            y1={y(t.v)}
            y2={y(t.v)}
            stroke={THRESHOLD_COLOR[t.k]}
            strokeWidth="1"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            opacity="0.85"
          />
        ))}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.time)} cy={y(last.heightM)} r="3" fill={stroke} />
    </svg>
  );
}

export function GaugeDetail({ gauge, tone = 'dark' }: { gauge: RiverGaugeReading; tone?: 'dark' | 'light' }) {
  const dark = tone === 'dark';
  const muted = dark ? 'text-white/60' : 'text-slate-500';
  const strong = dark ? 'text-white' : 'text-slate-900';
  const color = FLOOD_CLASS_COLOR[gauge.floodClass];
  const next = nextThreshold(gauge);
  const observed = formatGaugeTime(gauge.observedAt);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-lg font-bold tabular-nums ${strong}`}>
          {gauge.heightM !== null ? `${gauge.heightM.toFixed(2)} m` : '—'}
        </span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium capitalize ${muted}`}>
          <TrendIcon trend={gauge.trend} className="w-3.5 h-3.5" />
          {gauge.trend}
        </span>
        <span
          className="ml-auto px-1.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide"
          style={{ background: `${color}33`, color: dark ? color : '#0f172a', boxShadow: `inset 0 0 0 1px ${color}88` }}
        >
          {FLOOD_CLASS_LABEL[gauge.floodClass]}
        </span>
      </div>

      <GaugeSparkline gauge={gauge} tone={tone} />

      <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums ${muted}`}>
        {(['minor', 'moderate', 'major'] as const).map((k) =>
          gauge.thresholds[k] !== null ? (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="w-2 h-0.5 rounded" style={{ background: THRESHOLD_COLOR[k] }} aria-hidden="true" />
              {FLOOD_CLASS_LABEL[k]} {gauge.thresholds[k]!.toFixed(1)} m
            </span>
          ) : null,
        )}
        {next && gauge.heightM !== null && (
          <span className={dark ? 'text-white/80' : 'text-slate-700'}>
            {(next.level - gauge.heightM).toFixed(2)} m below {next.name}
          </span>
        )}
      </div>
      {observed && <div className={`text-[11px] ${muted}`}>Observed {observed} · 24h trace</div>}
    </div>
  );
}
