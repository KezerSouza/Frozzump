// ─────────────────────────────────────────────────────────────
// Garage overlay: pick your car model and color (button "Carro" in the top bar, or C).
// Colors work like Among Us: squares, and inside a room a color another player already has
// is crossed out (✕) and can't be picked. Car models have no limit: everyone can drive the same one.
// Pure DOM; the host still has the last word on colors (see Room.setLook).
// ─────────────────────────────────────────────────────────────

import { CAR_MODELS, PALETTE, type CarModel, type Look } from "../net/protocol";
import { drawCarPreview } from "./cars";

export interface GarageState {
  car: CarModel;
  color: string;
  /** Colors other players of the room already have → that player's name. Empty in solo. */
  taken: Record<string, string>;
  inRoom: boolean;
}

export interface GarageHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Called every frame: only touches the DOM when something changed. */
  update: (s: GarageState) => void;
}

const CAR_NAMES: Record<CarModel, string> = {
  normal: "Normal",
  snowmobile: "Snowmobile",
  bobsled: "Bobsled",
};

const SNOW = "#cfdee8";

export function mountGarage(onPick: (look: Look) => void): GarageHandle {
  const root = document.createElement("div");
  root.id = "garage";
  root.innerHTML = `
    <style>
      #garage {
        position: fixed; inset: 0; z-index: 11;
        display: none; align-items: center; justify-content: center;
        background: rgba(8,16,28,0.82); backdrop-filter: blur(4px);
        font-family: "Avenir Next","Segoe UI",system-ui,sans-serif; color: #e8f1f7;
      }
      #garage .card {
        width: min(440px, 92vw); max-height: 94vh; overflow-y: auto; box-sizing: border-box;
        background: #11223a; border: 1px solid #22405f; border-radius: 16px; padding: 22px;
        box-shadow: 0 18px 60px rgba(0,0,0,0.45);
      }
      #garage h1 { margin: 0 0 14px; font-size: 22px; }
      #garage .label { font-size: 12px; color: #8aa3b8; margin: 16px 0 8px; }
      #garage canvas { display: block; width: 100%; }
      #garage .preview { height: 132px; border-radius: 12px; }
      #garage .models { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      #garage .model {
        border: 2px solid #2b4866; border-radius: 12px; padding: 0 0 8px; overflow: hidden;
        background: #0c1726; color: #e8f1f7; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
        display: grid; gap: 6px;
      }
      #garage .model canvas { height: 62px; }
      #garage .model.on { border-color: #e8f1f7; }
      #garage .colors { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
      #garage .sw {
        position: relative; aspect-ratio: 1; border-radius: 10px; cursor: pointer;
        border: 3px solid rgba(0,0,0,0.25); padding: 0;
      }
      #garage .sw.on { border-color: #e8f1f7; box-shadow: 0 0 0 2px #11223a inset; }
      #garage .sw:disabled { cursor: not-allowed; }
      #garage .sw.taken::after {
        content: "✕"; position: absolute; inset: 0; display: grid; place-items: center;
        background: rgba(8,16,28,0.55); border-radius: 7px;
        color: #fff; font-size: 26px; font-weight: 700; text-shadow: 0 1px 2px #000;
      }
      #garage button:focus-visible { outline: 2px solid #3da5ff; outline-offset: 2px; }
      #garage .hint { margin-top: 12px; font-size: 12px; color: #6f879c; min-height: 16px; }
      #garage .done {
        width: 100%; margin-top: 16px; border: 0; border-radius: 10px; padding: 12px;
        font-size: 14px; font-weight: 600; cursor: pointer; color: #07121f; background: #3da5ff;
      }
      /* phone in landscape: little height → car on the left, colors on the right, everything on one screen */
      @media (max-height: 500px) {
        #garage .card { width: min(680px, 94vw); padding: 12px 16px; max-height: 96vh; max-height: 96dvh; }
        #garage h1 { font-size: 16px; margin: 0 0 8px; }
        #garage .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        #garage .label { margin: 8px 0 6px; }
        #garage .col:last-child .label { margin-top: 0; }
        #garage .preview { height: min(96px, 24vh); }
        #garage .models { gap: 6px; }
        #garage .model { font-size: 12px; gap: 2px; padding-bottom: 5px; border-radius: 10px; }
        #garage .model canvas { height: min(40px, 10vh); }
        #garage .colors { gap: 6px; }
        #garage .sw { aspect-ratio: auto; height: min(44px, 11vh); border-width: 2px; border-radius: 8px; }
        #garage .sw.taken::after { font-size: 18px; border-radius: 6px; }
        #garage .hint { display: none; }
        #garage .done { margin-top: 10px; padding: 9px; }
      }
    </style>
    <div class="card" role="dialog" aria-label="Escolher carro e cor">
      <h1>Seu carrinho</h1>
      <div class="cols">
        <div class="col">
          <canvas class="preview" id="gr-preview"></canvas>
          <div class="label">Modelo</div>
          <div class="models" id="gr-models"></div>
        </div>
        <div class="col">
          <div class="label">Cor</div>
          <div class="colors" id="gr-colors"></div>
        </div>
      </div>
      <div class="hint" id="gr-hint"></div>
      <button class="done" id="gr-done">Pronto</button>
    </div>
  `;
  document.body.appendChild(root);

  const card = root.querySelector<HTMLDivElement>(".card")!;
  const preview = root.querySelector<HTMLCanvasElement>("#gr-preview")!;
  const modelsEl = root.querySelector<HTMLDivElement>("#gr-models")!;
  const colorsEl = root.querySelector<HTMLDivElement>("#gr-colors")!;
  const hint = root.querySelector<HTMLDivElement>("#gr-hint")!;
  const done = root.querySelector<HTMLButtonElement>("#gr-done")!;

  const models = CAR_MODELS.map((m) => {
    const b = document.createElement("button");
    b.className = "model";
    b.innerHTML = `<canvas></canvas><span>${CAR_NAMES[m]}</span>`;
    b.addEventListener("click", () => onPick({ car: m }));
    modelsEl.appendChild(b);
    return { m, b, cv: b.querySelector("canvas")! };
  });
  const swatches = PALETTE.map((c) => {
    const b = document.createElement("button");
    b.className = "sw";
    b.style.background = c;
    b.addEventListener("click", () => onPick({ color: c }));
    colorsEl.appendChild(b);
    return { c, b };
  });

  let state: GarageState | null = null;
  let lastKey = "";
  const isOpen = () => root.style.display === "flex";

  /** Sizes the canvas backing store to its CSS size and paints the snow ground. */
  function prep(cv: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SNOW;
    ctx.fillRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function render() {
    if (!state || !isOpen()) return;
    const s = state;
    {
      const { ctx, w, h } = prep(preview);
      drawCarPreview(ctx, s.car, s.color, w / 2, h / 2, Math.min(w * 0.42, h * 1.15), -0.3);
    }
    for (const { m, b, cv } of models) {
      b.classList.toggle("on", m === s.car);
      b.setAttribute("aria-pressed", String(m === s.car));
      const { ctx, w, h } = prep(cv);
      drawCarPreview(ctx, m, s.color, w / 2, h / 2, Math.min(w * 0.58, h * 1.1));
    }
    for (const { c, b } of swatches) {
      const owner = s.taken[c];
      b.classList.toggle("on", c === s.color);
      b.classList.toggle("taken", !!owner);
      b.disabled = !!owner;
      b.setAttribute("aria-pressed", String(c === s.color));
      b.setAttribute("aria-label", owner ? `Cor ${c}, em uso por ${owner}` : `Cor ${c}`);
      b.title = owner ? `Em uso por ${owner}` : "";
    }
    hint.textContent = s.inRoom
      ? "Cores com ✕ já são de outro jogador. Modelos podem repetir à vontade."
      : "No solo todas as cores estão livres. Numa sala, cada cor é de um jogador só.";
  }

  function close() {
    root.style.display = "none";
  }
  function open() {
    root.style.display = "flex";
    lastKey = ""; // canvases need a size: draw now that the overlay is visible
    render();
    // keyboard users: Enter closes. Not on a touch screen (it only draws a focus ring there), and never scroll to it
    if (!window.matchMedia("(pointer: coarse)").matches) done.focus({ preventScroll: true });
  }

  done.addEventListener("click", close);
  root.addEventListener("click", (e) => { if (!card.contains(e.target as Node)) close(); });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }); // C closes it too (Keys → toggle)
  window.addEventListener("resize", () => { lastKey = ""; render(); });

  return {
    open,
    close,
    toggle: () => (isOpen() ? close() : open()),
    update: (s) => {
      state = s;
      const key = JSON.stringify(s);
      if (key === lastKey || !isOpen()) return;
      lastKey = key;
      render();
    },
  };
}
