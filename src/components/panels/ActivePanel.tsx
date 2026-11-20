/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppData } from '../../state/AppDataContext';
import { OverviewPanel } from './OverviewPanel';
import { ModelsPanel } from './ModelsPanel';
import { EmergencyPanel } from './EmergencyPanel';
import { AlertsPanel } from './AlertsPanel';

/** Renders the panel for the current tab (shared by the desktop sidebar and mobile sheet). */
export function ActivePanel() {
  const { activeTab } = useAppData();
  switch (activeTab) {
    case 'models':
      return <ModelsPanel />;
    case 'emergency':
      return <EmergencyPanel />;
    case 'alerts':
      return <AlertsPanel />;
    default:
      return <OverviewPanel />;
  }
}

/** Quiet attribution footer shown under every panel. */
export function AttributionFooter() {
  const { multiModelBundle } = useAppData();
  return (
    <footer className="pt-6 pb-2 text-center font-mono text-[10px] tracking-wider text-white/40 uppercase tabular-nums space-y-1">
      <div>OPEN-METEO · BOM · RAINVIEWER · QLD ARCGIS</div>
      <div>
        {new Date(multiModelBundle?.lastUpdated || Date.now()).toLocaleTimeString('en-AU', {
          timeZone: 'Australia/Brisbane',
          hour: '2-digit',
          minute: '2-digit',
        })}{' '}
        AEST · AUSTRALIA/BRISBANE
      </div>
    </footer>
  );
}
