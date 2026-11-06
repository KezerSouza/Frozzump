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

export class Keys {
  private mask = 0;
  onRestart: () => void = () => {};
  onToggleGhost: () => void = () => {};
  onToggleOthers: () => void = () => {};
  onOpenLobby: () => void = () => {};
  onToggleGarage: () => void = () => {};

  constructor() {
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
    window.addEventListener("blur", () => (this.mask = 0));
  }

  /** Current key state, already in the format the simulation expects. */
  read(): number {
    return this.mask;
  }
}
