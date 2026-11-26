/**
 * One-time notice for first-time visitors:
 *  - explains which features run on the owner's Google billing (map, place search,
 *    Cyclone Mode / WeatherNext 3, AI briefing) and asks people to save the paid
 *    features for cyclones, flooding and severe weather;
 *  - shows how to add the app to the Home Screen on iPhone (Safari) and Android (Chrome),
 *    with a one-tap install button when Chrome offers `beforeinstallprompt`.
 * Dismissal is remembered per browser in localStorage (bump STORAGE_KEY to show it again).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  CircleDollarSign,
  CloudLightning,
  EllipsisVertical,
  Share,
  Smartphone,
  Sparkles,
  SquarePlus,
  Wind,
} from 'lucide-react';

const STORAGE_KEY = 'nq-weather:first-run-notice:v1';

type Platform = 'ios' | 'android' | 'other';

/** Chrome's install prompt event (not in lib.dom yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function hasSeenNotice(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'seen';
  } catch {
    return false;
  }
}

function rememberNotice(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'seen');
  } catch {
    /* private mode / blocked storage: notice may show again next visit */
  }
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function IosSteps() {
  return (
    <ol className="space-y-1.5 text-white/75">
      <li className="flex items-start gap-2">
        <span className="w-5 shrink-0 text-white/60 tabular-nums">1.</span>
        <span>
          Open this page in <span className="text-white font-medium" translate="no">Safari</span>.
        </span>
      </li>
      <li className="flex items-start gap-2">
        <span className="w-5 shrink-0 text-white/60 tabular-nums">2.</span>
        <span>
          Tap <span className="text-white font-medium">Share</span>{' '}
          <Share aria-hidden="true" className="inline w-4 h-4 -mt-0.5 text-[#32ADE6]" /> at the bottom of the screen.
        </span>
      </li>
      <li className="flex items-start gap-2">
        <span className="w-5 shrink-0 text-white/60 tabular-nums">3.</span>
        <span>
          Scroll down, tap <span className="text-white font-medium">Add to Home Screen</span>{' '}
          <SquarePlus aria-hidden="true" className="inline w-4 h-4 -mt-0.5 text-white/70" />, then{' '}
          <span className="text-white font-medium">Add</span>.
        </span>
      </li>
    </ol>
  );
}

function AndroidSteps() {
  return (
    <ol className="space-y-1.5 text-white/75">
      <li className="flex items-start gap-2">
        <span className="w-5 shrink-0 text-white/60 tabular-nums">1.</span>
        <span>
          Open this page in <span className="text-white font-medium" translate="no">Chrome</span>.
        </span>
      </li>
      <li className="flex items-start gap-2">
        <span className="w-5 shrink-0 text-white/60 tabular-nums">2.</span>
        <span>
          Tap the menu{' '}
          <EllipsisVertical aria-hidden="true" className="inline w-4 h-4 -mt-0.5 text-white/70" />
          <span className="sr-only">(three dots)</span> at the top right.
        </span>
      </li>
      <li className="flex items-start gap-2">
        <span className="w-5 shrink-0 text-white/60 tabular-nums">3.</span>
        <span>
          Tap <span className="text-white font-medium">Add to Home screen</span> (or{' '}
          <span className="text-white font-medium">Install app</span>), then confirm.
        </span>
      </li>
    </ol>
  );
}

export function FirstRunNotice() {
  const [open, setOpen] = useState(() => !hasSeenNotice());
  const [platform] = useState<Platform>(detectPlatform);
  const [installed] = useState<boolean>(isStandalone);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const dismiss = () => {
    rememberNotice();
    setOpen(false);
  };

  // Chrome/Edge on Android: capture the install prompt so we can offer a one-tap button.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Desktop: focus the button for keyboard users. Touch: focus the dialog itself so screen
    // readers land inside it without a focus ring flashing on the button.
    if (window.matchMedia?.('(pointer: fine)').matches) primaryRef.current?.focus({ preventScroll: true });
    else dialogRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      // Keep keyboard focus inside the dialog.
      const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    // Keep focus in the modal even if something behind it grabs focus (e.g. a Google Maps
    // InfoWindow auto-focuses itself when it opens).
    const onFocusIn = (e: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && e.target instanceof Node && !dialog.contains(e.target)) {
        (primaryRef.current ?? dialog).focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
  };

  const showInstall = !installed;
  const showIos = platform === 'ios' || platform === 'other';
  const showAndroid = platform === 'android' || platform === 'other';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="first-run-notice"
          className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center overscroll-contain"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="first-run-notice-title"
            aria-describedby="first-run-notice-summary"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="relative w-full lg:max-w-md max-h-[92dvh] flex flex-col outline-none rounded-t-[24px] lg:rounded-[24px] bg-[#1c1c1e] border border-white/10 shadow-2xl text-white"
          >
            {/* Scrollable content; the button below stays pinned so it is always reachable. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[#ff9500]/15 flex items-center justify-center">
                <CircleDollarSign aria-hidden="true" className="w-5 h-5 text-[#ff9500]" />
              </div>
              <h2 id="first-run-notice-title" className="text-lg font-semibold text-balance">
                Before You Start
              </h2>
            </div>

            <div className="mt-3 space-y-3 text-sm text-white/75 leading-relaxed">
              <p id="first-run-notice-summary">
                This app is just for me and a few friends. Some features are billed to my Google account, so
                using them costs me real money.
              </p>

              <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9500]">
                  Save These for Cyclones &amp; Flooding
                </div>
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2">
                    <Wind aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0 text-[#ff3b30]" />
                    <span>
                      <span className="text-white font-medium">Cyclone Mode</span>, the{' '}
                      <span className="text-white font-medium" translate="no">Cyclone WN3</span> switch (
                      <span translate="no">WeatherNext&nbsp;3</span>)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Sparkles aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0 text-[#32ADE6]" />
                    <span>
                      <span className="text-white font-medium">AI Corridor Briefing</span> and follow-up chat
                    </span>
                  </li>
                </ul>
                <p className="text-xs text-white/55">
                  The map and place search cost a little too, so close the app when you’re done.
                </p>
              </div>

              <p className="flex items-start gap-2">
                <CloudLightning aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0 text-white/50" />
                <span>
                  Everyday forecasts, radar, BOM warnings, river gauges and road events are free. Use them as
                  much as you like.
                </span>
              </p>

              {showInstall && (
                <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#32ADE6]">
                    <Smartphone aria-hidden="true" className="w-4 h-4" />
                    Add to Your Home Screen
                  </div>
                  <p className="text-xs text-white/55">
                    It opens full screen, like a normal app.
                    {platform !== 'android' && ' On iPhone, storm alerts only work after you add it.'}
                  </p>

                  {installEvent ? (
                    <button
                      type="button"
                      onClick={install}
                      className="w-full h-11 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 border border-white/15 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      Install App
                    </button>
                  ) : (
                    <>
                      {showIos && (
                        <div className="space-y-1.5">
                          {platform === 'other' && (
                            <div className="text-xs font-semibold text-white" translate="no">iPhone &amp; iPad</div>
                          )}
                          <IosSteps />
                        </div>
                      )}
                      {showAndroid && (
                        <div className="space-y-1.5">
                          {platform === 'other' && (
                            <div className="text-xs font-semibold text-white pt-1" translate="no">Android</div>
                          )}
                          <AndroidSteps />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            </div>

            <div className="shrink-0 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] lg:pb-5 border-t border-white/10">
            <button
              ref={primaryRef}
              type="button"
              onClick={dismiss}
              className="w-full h-12 lg:h-11 rounded-xl bg-[#32ADE6] hover:bg-[#45b8ec] active:bg-[#2a9fd6] text-[#111113] text-sm font-semibold transition-colors cursor-pointer"
            >
              Got It
            </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
