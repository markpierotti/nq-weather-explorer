import { useAppData } from '../state/AppDataContext';

/**
 * Derived "right now" values for the selected location, shared by the desktop hero
 * and the mobile sheet peek header. Falls back to the multi-model bundle when the
 * Google current-conditions bundle is unavailable.
 */
export function useCurrentConditions() {
  const { weatherBundle, multiModelBundle, unitSystem, isLoadingWeather, isLoadingModels } = useAppData();
  const isMetric = unitSystem === 'METRIC';
  const hasCurrentWeather = !!weatherBundle?.current && !weatherBundle?.isUnsupportedLocation;
  const current = weatherBundle?.current;
  const first3h = multiModelBundle?.hourly3h?.[0];
  const todayRow = multiModelBundle?.daily7d?.[0];

  const rawTempVal = hasCurrentWeather
    ? current?.temperature?.degrees
    : first3h?.weatherNext2.temp ?? first3h?.ecmwf.temp ?? first3h?.gfs.temp;
  const tempUnit = hasCurrentWeather ? current?.temperature?.unit : 'CELSIUS';

  const displayTemp =
    rawTempVal !== null && rawTempVal !== undefined
      ? tempUnit === 'FAHRENHEIT'
        ? Math.round(isMetric ? ((rawTempVal - 32) * 5) / 9 : rawTempVal)
        : tempUnit === 'CELSIUS' || !hasCurrentWeather
        ? Math.round(isMetric ? rawTempVal : (rawTempVal * 9) / 5 + 32)
        : Math.round(rawTempVal)
      : undefined;

  const conditionText = hasCurrentWeather
    ? current?.weatherCondition?.description?.text || 'Clear'
    : todayRow?.bom?.shortText ||
      (first3h?.weatherNext2.precipMm && first3h.weatherNext2.precipMm > 0.5
        ? 'Showers Projected'
        : 'Multi-Model Live');

  const rainChance =
    todayRow?.bom?.rainChance ??
    todayRow?.googleWeather?.rainChance ??
    todayRow?.weatherNext2.rainChance ??
    todayRow?.ecmwf.rainChance ??
    todayRow?.gfs.rainChance ??
    null;

  const fmtRangeTemp = (c: number | null | undefined) => {
    if (c === null || c === undefined || !Number.isFinite(c)) return '—';
    return `${Math.round(isMetric ? c : (c * 9) / 5 + 32)}°`;
  };

  const fmtRainShort = (mm: number | null | undefined) => {
    if (mm === null || mm === undefined || !Number.isFinite(mm)) return '—';
    return isMetric ? `${mm < 10 ? Number(mm.toFixed(1)) : Math.round(mm)}mm` : `${(mm / 25.4).toFixed(2)}in`;
  };

  return {
    isMetric,
    hasCurrentWeather,
    current,
    todayRow,
    displayTemp,
    conditionText,
    rainChance,
    fmtRangeTemp,
    fmtRainShort,
    isAnyLoading: isLoadingWeather || isLoadingModels,
  };
}
