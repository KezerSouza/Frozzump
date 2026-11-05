import { IN_LEFT, IN_RIGHT } from "../sim";

const MAP: Record<string, number> = {
  ArrowLeft: IN_LEFT, KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT, KeyD: IN_RIGHT,
};

export class Keys {
  private mask = 0;
  onRestart: () => void = () => {};
  onToggleGhost: () => void = () => {};

  constructor() {
    window.addEventListener("keydown", (e) => {
      const bit = MAP[e.code];
      if (bit !== undefined) {
        this.mask |= bit;
        e.preventDefault(); // keep the arrow keys from scrolling the page
      } else if (e.code === "KeyR" && !e.repeat) this.onRestart();
      else if (e.code === "KeyG" && !e.repeat) this.onToggleGhost();
    });
    window.addEventListener("keyup", (e) => {
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
