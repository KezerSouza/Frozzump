import { IN_LEFT, IN_RIGHT } from "../sim";

const MAP: Record<string, number> = {
  ArrowLeft: IN_LEFT, KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT, KeyD: IN_RIGHT,
};

/** True when the user is typing into a form field (lobby nickname, room code, …). */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Touch steering: a finger on the left half of the screen steers left, on the right half steers right. */
export function touchSide(x: number, width: number): number {
  return x < width / 2 ? IN_LEFT : IN_RIGHT;
}

/** Steering bits of every finger on the screen (both halves at once = both bits, like holding ← and →). */
export function touchMask(sides: Iterable<number>): number {
  let m = 0;
  for (const s of sides) m |= s;
  return m;
}

/** A phone / tablet: the main pointer is a finger. Touch laptops with a mouse count too if they report touch points. */
export const isTouchDevice = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || (navigator.maxTouchPoints ?? 0) > 0);

export class Keys {
  private mask = 0;
  /** pointerId → side (IN_LEFT / IN_RIGHT) of every finger currently on the game canvas */
  private fingers = new Map<number, number>();
  onRestart: () => void = () => {};
  onToggleGhost: () => void = () => {};
  onToggleOthers: () => void = () => {};
  onToggleFps: () => void = () => {};
  /**
   * A finger landing on a HUD control (the timer: toggles the FPS counter) instead of the track.
   * Returns true when it handled the touch, and then that finger doesn't steer.
   */
  onHudTouch: (x: number, y: number) => boolean = () => false;
  onOpenLobby: () => void = () => {};
  onToggleGarage: () => void = () => {};

  constructor(touchSurface?: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      // let text fields (e.g. the lobby nickname) receive A/D/arrows normally
      if (isTyping(e.target)) return;
      const bit = MAP[e.code];
      if (bit !== undefined) {
        this.mask |= bit;
        e.preventDefault(); // keep the arrow keys from scrolling the page
      } else if (e.code === "KeyR" && !e.repeat) this.onRestart();
      else if (e.code === "KeyG" && !e.repeat) this.onToggleGhost();
      else if (e.code === "KeyO" && !e.repeat) this.onToggleOthers();
      else if (e.code === "KeyF" && !e.repeat) this.onToggleFps();
      else if (e.code === "KeyC" && !e.repeat) this.onToggleGarage();
      else if (e.code === "KeyM" && !e.repeat) {
        e.preventDefault(); // the lobby focuses a text field: don't type the "m" into it
        this.onOpenLobby();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (isTyping(e.target)) return;
      const bit = MAP[e.code];
      if (bit !== undefined) this.mask &= ~bit;
    });
    window.addEventListener("blur", () => {
      this.mask = 0;
      this.fingers.clear();
    });
    if (touchSurface) this.listenTouch(touchSurface);
  }

  /**
   * Fingers on the game surface steer. Only touch/pen pointers: a mouse click on the desktop does nothing.
   * The buttons and overlays are separate elements on top of the canvas, so tapping them never steers.
   */
  private listenTouch(el: HTMLElement) {
    const side = (e: PointerEvent) => touchSide(e.clientX, window.innerWidth);
    const isFinger = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
    el.addEventListener("pointerdown", (e) => {
      if (!isFinger(e)) return;
      e.preventDefault();
      if (this.onHudTouch(e.clientX, e.clientY)) return;
      this.fingers.set(e.pointerId, side(e));
    });
    // a finger sliding across the middle switches sides
    el.addEventListener("pointermove", (e) => {
      if (this.fingers.has(e.pointerId)) this.fingers.set(e.pointerId, side(e));
    });
    const lift = (e: PointerEvent) => { this.fingers.delete(e.pointerId); };
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);
    el.addEventListener("lostpointercapture", lift);
    // long-press would open the context menu / text selection callout
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Current key + touch state, already in the format the simulation expects. */
  read(): number {
    return this.mask | touchMask(this.fingers.values());
  }
}
