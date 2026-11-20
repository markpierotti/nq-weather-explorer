/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppData } from '../../state/AppDataContext';
import { CycloneThreatPanel } from '../CycloneThreatPanel';
import { MultiModelComparison } from '../MultiModelComparison';

/** WeatherNext 3 cyclone panel, rendered only while Cyclone Mode is on. */
export function CycloneThreatSection() {
  const d = useAppData();
  if (!d.cycloneMode) return null;
  return (
    <CycloneThreatPanel
      cycloneMode={d.cycloneMode}
      onToggleCycloneMode={d.onToggleCycloneMode}
      threatDetection={d.threatDetection}
      wn3ApiKey={d.wn3ApiKey}
      onSaveWn3ApiKey={d.onSaveWn3ApiKey}
      wn3Bundle={d.wn3Bundle}
      cycloneSynthesis={d.cycloneSynthesis}
      isLoading={d.isLoadingCyclone}
      error={d.cycloneError}
      unitSystem={d.unitSystem}
      onRefresh={d.onRefreshCyclone}
      onFallbackToGemini={d.onFallbackCycloneToGemini}
    />
  );
}

/** "Models" tab: cyclone panel (if on) + the 4/5-model comparison matrix. */
export function ModelsPanel() {
  const d = useAppData();
  return (
    <div className="space-y-3">
      <CycloneThreatSection />
      <MultiModelComparison
        bundle={d.multiModelBundle}
        isLoading={d.isLoadingModels}
        unitSystem={d.unitSystem}
        onRefresh={d.onRefreshAll}
        cycloneMode={d.cycloneMode}
        wn3Bundle={d.wn3Bundle}
        cycloneSynthesis={d.cycloneSynthesis}
      />
    </div>
  );
}
