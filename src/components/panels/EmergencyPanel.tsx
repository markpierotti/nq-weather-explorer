/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Layers } from 'lucide-react';
import { useAppData } from '../../state/AppDataContext';
import { EmergencyDrawer } from '../EmergencyDrawer';

/** "Emergency" tab: feed list + filters. Map overlay toggles live in the Layers menu. */
export function EmergencyPanel() {
  const d = useAppData();
  return (
    <div className="space-y-3">
      {d.emergencyDashboardEnabled && d.isMapAvailable && (
        <button
          type="button"
          onClick={() => d.onSetLayersMenuOpen(true)}
          className="w-full min-h-11 lg:min-h-0 ios-bento-card px-3.5 py-2.5 flex items-center gap-2 text-xs text-white/80 hover:text-white cursor-pointer"
        >
          <Layers className="w-4 h-4 text-[#32ADE6] shrink-0" />
          <span className="flex-1 text-left">Choose which emergency overlays show on the map</span>
          <span className="text-[#32ADE6] font-semibold shrink-0">Layers →</span>
        </button>
      )}
      <EmergencyDrawer
        isEnabled={d.emergencyDashboardEnabled}
        onToggleEnabled={d.onToggleEmergencyDashboard}
        bundle={d.emergencyBundle}
        isLoading={d.isLoadingEmergency}
        proxyUrl={d.emergencyProxyUrl}
        onChangeProxyUrl={d.onChangeEmergencyProxyUrl}
        onRefresh={d.onRefreshEmergency}
        onFocusItem={d.onFocusEmergencyItem}
      />
    </div>
  );
}
