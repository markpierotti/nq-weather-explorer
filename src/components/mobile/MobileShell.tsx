/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { useAppData } from '../../state/AppDataContext';
import { SummaryWidgets } from '../SummaryWidgets';
import { LocationBar } from '../panels/LocationBar';
import { CurrentPeek } from '../panels/CurrentSummary';
import { ModeToggles } from '../panels/ModeToggles';
import { ActivePanel, AttributionFooter } from '../panels/ActivePanel';
import { BottomSheet } from './BottomSheet';
import { MobileTabBar } from './MobileTabBar';

const TAB_TITLES = { overview: '', models: 'Model comparison', emergency: 'Emergency', alerts: 'Alerts' } as const;

/** Mobile (< 1024px) shell: full-screen map behind a draggable bottom sheet + tab bar. */
export function MobileShell() {
  const { activeTab, sheetSnap, onChangeSheetSnap, weatherBundle, unitSystem, isLoadingWeather } = useAppData();
  const tabBarRef = useRef<HTMLElement>(null);
  const [tabBarH, setTabBarH] = useState(56);

  useLayoutEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const measure = () => setTabBarH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <BottomSheet
        snap={sheetSnap}
        onSnapChange={onChangeSheetSnap}
        bottomInset={tabBarH}
        header={<CurrentPeek />}
        contentKey={activeTab}
      >
        <div className="px-4 pt-3 space-y-3">
          {activeTab === 'overview' ? (
            <>
              <LocationBar />
              <SummaryWidgets weatherBundle={weatherBundle} unitSystem={unitSystem} isLoading={isLoadingWeather} />
              <ModeToggles />
            </>
          ) : (
            <h2 className="text-base font-semibold text-white">{TAB_TITLES[activeTab]}</h2>
          )}
          <ActivePanel />
          <AttributionFooter />
        </div>
      </BottomSheet>
      <MobileTabBar ref={tabBarRef} />
    </>
  );
}
