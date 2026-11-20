/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { SheetSnap } from '../../state/AppDataContext';

/** Fallback peek height until the header (handle + summary row) has been measured. */
const SHEET_PEEK_FALLBACK_PX = 136;
/** Space kept free at the top for the map control stack when at "half". */
const CONTROL_STACK_RESERVE_PX = 12 + 3 * 44 + 2 * 8 + 16;
const FLING_VELOCITY = 0.45; // px per ms
const DRAG_SLOP_PX = 6;
const SNAP_ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const SNAP_TRANSITION = 'transform 320ms cubic-bezier(0.22, 0.9, 0.24, 1)';

interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Height (px) of the fixed tab bar below the sheet. */
  bottomInset: number;
  /** Drag area: always visible, including at peek. */
  header: ReactNode;
  children: ReactNode;
  /** Scroll position resets when this changes (e.g. the active tab). */
  contentKey?: string;
}

function useViewportHeight() {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    // Deliberately window.innerHeight (not visualViewport) so the on-screen keyboard doesn't resize the sheet.
    const onResize = () => setH(window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return h;
}

/**
 * Three-stop mobile bottom sheet (peek / half / full).
 * Only the header drags (so it never fights content scrolling). Publishes the visible height,
 * including the tab bar, as the `--sheet-h` CSS variable on <html> for map chrome to sit above it.
 */
// Note: the sheet transform is driven imperatively (applyHeight) so re-renders never fight an in-progress drag.
export function BottomSheet({ snap, onSnapChange, bottomInset, header, children, contentKey }: BottomSheetProps) {
  const viewportH = useViewportHeight();
  const sheetRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const safeTopProbeRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [safeTop, setSafeTop] = useState(0);
  // Peek shows exactly the header, so no clipped sliver of the content peeks out above the tab bar.
  const [peekH, setPeekH] = useState(SHEET_PEEK_FALLBACK_PX);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      if (el.offsetHeight > 0) setPeekH(el.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    setSafeTop(safeTopProbeRef.current?.offsetHeight ?? 0);
  }, [viewportH]);

  const heights = useMemo(() => {
    const full = Math.max(peekH + 120, viewportH - safeTop - 8 - bottomInset);
    const halfTarget = Math.min(Math.round(viewportH * 0.5), viewportH - bottomInset - safeTop - CONTROL_STACK_RESERVE_PX);
    const half = Math.min(full, Math.max(peekH + 60, halfTarget));
    return { peek: peekH, half, full } as Record<SheetSnap, number>;
  }, [viewportH, safeTop, bottomInset, peekH]);

  const currentH = useRef(heights[snap]);

  const applyHeight = useCallback(
    (h: number, animate: boolean) => {
      currentH.current = h;
      const el = sheetRef.current;
      if (el) {
        el.style.transition = animate ? SNAP_TRANSITION : 'none';
        el.style.transform = `translate3d(0, ${Math.round(heights.full - h)}px, 0)`;
      }
      document.documentElement.style.setProperty('--sheet-h', `${Math.round(Math.max(0, h) + bottomInset)}px`);
    },
    [heights.full, bottomInset]
  );

  const hasPositioned = useRef(false);
  useLayoutEffect(() => {
    applyHeight(heights[snap], hasPositioned.current);
    hasPositioned.current = true;
  }, [snap, heights, applyHeight]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--sheet-h');
      delete document.documentElement.dataset.sheetDragging;
    },
    []
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [contentKey]);

  // ---- Drag handling (header only) ----
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startH: number;
    active: boolean;
    samples: Array<{ y: number; t: number }>;
  } | null>(null);
  const suppressClick = useRef(false);

  const finishDrag = (target: SheetSnap) => {
    delete document.documentElement.dataset.sheetDragging;
    if (target === snap) applyHeight(heights[snap], true);
    else onSnapChange(target);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClick.current = false;
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startH: currentH.current,
      active: false,
      samples: [{ y: e.clientY, t: e.timeStamp }],
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.documentElement.dataset.sheetDragging = '1';
    }
    const raw = d.startH - dy;
    // Light rubber-banding past the ends.
    const h =
      raw > heights.full
        ? heights.full + (raw - heights.full) * 0.2
        : raw < heights.peek
        ? heights.peek - (heights.peek - raw) * 0.3
        : raw;
    applyHeight(h, false);
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;

    if (!d.active) {
      // Tap on the header background (not one of its buttons) steps the sheet up.
      const el = e.target as HTMLElement;
      if (el.closest('button:not([data-sheet-handle]), a, input')) return;
      onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }

    suppressClick.current = true;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const velocity = (last.y - first.y) / dt; // + = downwards
    const h = currentH.current;

    let target: SheetSnap;
    if (Math.abs(velocity) > FLING_VELOCITY) {
      const candidates = SNAP_ORDER.filter((s) => (velocity < 0 ? heights[s] > h + 1 : heights[s] < h - 1));
      target = candidates.length
        ? velocity < 0
          ? candidates[0]
          : candidates[candidates.length - 1]
        : velocity < 0
        ? 'full'
        : 'peek';
    } else {
      target = SNAP_ORDER.reduce((best, s) => (Math.abs(heights[s] - h) < Math.abs(heights[best] - h) ? s : best), snap);
    }
    finishDrag(target);
  };

  const onPointerCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    finishDrag(snap);
  };

  const onClickCapture = (e: ReactMouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const contentPadBottom = Math.max(0, heights.full - heights[snap]) + 16;

  return (
    <>
      <div
        ref={safeTopProbeRef}
        aria-hidden="true"
        className="fixed top-0 left-0 w-px invisible pointer-events-none"
        style={{ height: 'env(safe-area-inset-top)' }}
      />
      <section
        ref={sheetRef}
        aria-label="Weather details"
        className="fixed left-0 right-0 z-30 flex flex-col rounded-t-[24px] ios-sidebar-surface border-t border-white/10 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] text-white will-change-transform"
        style={{ bottom: bottomInset, height: heights.full }}
      >
        <div
          ref={headerRef}
          className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={onClickCapture}
        >
          <button
            type="button"
            data-sheet-handle
            className="w-full h-7 flex items-center justify-center cursor-grab"
            aria-label={snap === 'full' ? 'Collapse weather panel' : 'Expand weather panel'}
            onClick={(e) => {
              // Keyboard activation (pointer taps are handled in onPointerUp).
              if (e.detail === 0) onSnapChange(snap === 'full' ? 'peek' : snap === 'peek' ? 'half' : 'full');
            }}
          >
            <span className="block w-10 h-[5px] rounded-full bg-white/35" />
          </button>
          {header}
        </div>

        <div
          ref={scrollRef}
          className={`flex-1 min-h-0 overscroll-contain no-scrollbar border-t border-white/[0.06] ${
            snap === 'peek' ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
          style={{ paddingBottom: contentPadBottom }}
        >
          {children}
        </div>
      </section>
    </>
  );
}
