/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Ref } from 'react';
import { BarChart3, Bell, CloudSun, ShieldAlert, type LucideIcon } from 'lucide-react';
import { SidebarTab, useAppData, useTabBadges } from '../../state/AppDataContext';

const TABS: Array<{ id: SidebarTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Weather', icon: CloudSun },
  { id: 'models', label: 'Models', icon: BarChart3 },
  { id: 'emergency', label: 'Emergency', icon: ShieldAlert },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

/** Fixed bottom tab bar for the mobile shell (sits below the bottom sheet). */
export function MobileTabBar({ ref }: { ref?: Ref<HTMLElement> }) {
  const { activeTab, onChangeTab } = useAppData();
  const badges = useTabBadges();
  const badgeFor = (id: SidebarTab) => (id === 'emergency' ? badges.emergency : id === 'alerts' ? badges.alerts : 0);

  return (
    <nav
      ref={ref}
      aria-label="Sections"
      className="fixed left-0 right-0 bottom-0 z-40 bg-[#141416]/95 backdrop-blur-xl border-t border-white/10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-4 h-14">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          const count = badgeFor(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 cursor-pointer transition-colors ${
                active ? 'text-[#32ADE6]' : 'text-white/65 active:text-white'
              }`}
            >
              <span className="relative">
                <Icon className="w-6 h-6" />
                {count > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-[18px] text-center text-white tabular-nums ${
                      id === 'alerts' ? 'bg-[#ff3b30]' : 'bg-[#ff9500]'
                    }`}
                    aria-label={`${count} items`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
