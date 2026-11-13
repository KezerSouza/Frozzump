// ─────────────────────────────────────────────────────────────
// Phones and tablets: play in landscape.
//
// - Android app (Capacitor): the activity is locked to landscape and fullscreen natively, nothing to do here.
// - Mobile browser: on the first tap we go fullscreen and lock the screen to landscape (Chrome / Android).
//   Browsers that can't (iPhone Safari, or the user said no) get a "rotate your phone" notice while in
//   portrait, which can be dismissed to play upright anyway.
// - The screen is kept awake while the page is visible (Wake Lock), so it doesn't dim mid-race.
// ─────────────────────────────────────────────────────────────

import { isTouchDevice } from "./input";

interface CapacitorGlobal { isNativePlatform?: () => boolean }

/** Running inside the Android app (Capacitor injects window.Capacitor into its WebView). */
export const isNativeApp = (): boolean =>
  !!(window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.();

const DISMISS_KEY = "snowgo:portrait-ok";

/** Fullscreen + landscape lock. Must run inside a user gesture. Resolves to false when the browser refuses. */
async function goLandscape(): Promise<boolean> {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
  } catch { /* not allowed (iPhone) or refused */ }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o?.lock) {
      await o.lock("landscape");
      return true;
    }
  } catch { /* only works in fullscreen, and not on every browser */ }
  return false;
}

function keepAwake() {
  type WakeLockApi = { request: (t: "screen") => Promise<unknown> };
  const wl = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  if (!wl) return;
  const request = () => { if (!document.hidden) wl.request("screen").catch(() => {}); };
  request();
  // the lock is released when the page is hidden; take it again when we come back
  document.addEventListener("visibilitychange", request);
}

/**
 * Side safe-area insets in CSS px (a camera cutout on the left / right edge of a phone in landscape).
 * Read from CSS env() through a hidden probe, refreshed on resize / rotation; 0 where the browser has none.
 */
export const safeArea = { left: 0, right: 0 };
function trackSafeArea() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);";
  document.body.appendChild(probe);
  const read = () => {
    const cs = getComputedStyle(probe);
    safeArea.left = parseFloat(cs.paddingLeft) || 0;
    safeArea.right = parseFloat(cs.paddingRight) || 0;
  };
  read();
  window.addEventListener("resize", read);
  window.addEventListener("orientationchange", () => setTimeout(read, 300));
  screen.orientation?.addEventListener?.("change", read);
}

export function setupMobile() {
  trackSafeArea();
  if (!isTouchDevice()) return;
  document.documentElement.classList.add("touch");
  if (isNativeApp()) {
    document.documentElement.classList.add("app");
    keepAwake();
    return; // landscape + fullscreen are set by the Android activity
  }

  let dismissed = false;
  try { dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { /* private mode */ }

  const root = document.createElement("div");
  root.id = "rotate";
  root.innerHTML = `
    <style>
      #rotate {
        position: fixed; inset: 0; z-index: 20; display: none;
        flex-direction: column; align-items: center; justify-content: center; gap: 18px;
        padding: 24px; box-sizing: border-box; text-align: center;
        background: #0c1624; color: #e8f1f7;
        font-family: "Avenir Next","Segoe UI",system-ui,sans-serif;
      }
      #rotate .phone {
        width: 54px; height: 92px; border: 4px solid #e8f1f7; border-radius: 12px;
        animation: snowgo-rot 2.2s ease-in-out infinite;
      }
      @keyframes snowgo-rot { 0%, 25% { transform: rotate(0); } 55%, 100% { transform: rotate(-90deg); } }
      #rotate h2 { margin: 0; font-size: 22px; }
      #rotate p { margin: 0; color: #8aa3b8; font-size: 15px; max-width: 320px; }
      #rotate button {
        border: 0; border-radius: 10px; padding: 14px 20px; font-size: 16px; font-weight: 600;
        background: #3da5ff; color: #07121f;
      }
      #rotate button.link { background: transparent; color: #8aa3b8; text-decoration: underline; font-weight: 500; padding: 6px; }
    </style>
    <div class="phone"></div>
    <h2>Gire o celular</h2>
    <p>Snow Go é jogado na horizontal. Toque na metade esquerda da tela para virar à esquerda e na direita para virar à direita.</p>
    <button id="rot-go">Jogar na horizontal</button>
    <button class="link" id="rot-skip">Continuar na vertical</button>
  `;
  document.body.appendChild(root);

  const portrait = window.matchMedia("(orientation: portrait)");
  const refresh = () => { root.style.display = portrait.matches && !dismissed ? "flex" : "none"; };
  portrait.addEventListener("change", refresh);
  refresh();

  root.querySelector("#rot-go")!.addEventListener("click", () => { void goLandscape(); });
  root.querySelector("#rot-skip")!.addEventListener("click", () => {
    dismissed = true;
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    refresh();
  });

  // First tap anywhere (opening the lobby, steering, …): fullscreen + landscape where the browser allows it.
  // Only once: if the user leaves fullscreen afterwards, that's their call.
  const first = () => {
    window.removeEventListener("pointerup", first, true);
    if (!dismissed) void goLandscape();
  };
  window.addEventListener("pointerup", first, true);

  keepAwake();
}
