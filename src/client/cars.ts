// ─────────────────────────────────────────────────────────────
// Car models (visual only). The simulation knows a single collision circle (CAR_RADIUS);
// every model is drawn inside the same box as the original car, -0.8..0.8 × -0.45..0.45 in
// local units (× CAR_SCALE in world meters), facing +x.
//
// Each model has:
//   sil(ctx)        one path (several sub-paths) used for the faded cars: the personal ghost
//                   and the other players' light shadows
//   solid(ctx, col) the full drawing with details, for our own car (and the garage previews)
// ─────────────────────────────────────────────────────────────

import type { CarModel } from "../net/protocol";

const C = {
  car: "#e5412d",
  carDark: "#9c2417",
  glass: "#12202e",
  metal: "#1b2836", // skis, track, runners
  metalLite: "#4a6075",
  headlight: "#fff1b8",
  taillight: "#ff3b2e",
  visor: "#bfe3ff",
};

/**
 * Darker shade of a "#rrggbb" body color for the rear of the car: each channel scaled by 0.66, which keeps
 * the hue and the "feel" of the color. The original red keeps the hand-picked C.carDark.
 */
export function darken(hex: string): string {
  if (hex.toLowerCase() === C.car) return C.carDark;
  const ch = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.66).toString(16).padStart(2, "0");
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}
function disc(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/** Snowmobile body: wide, rounded towards the nose. */
function sledBody(ctx: Ctx) {
  ctx.moveTo(-0.55, -0.4); ctx.lineTo(0.12, -0.4);
  ctx.quadraticCurveTo(0.7, -0.36, 0.72, 0); ctx.quadraticCurveTo(0.7, 0.36, 0.12, 0.4);
  ctx.lineTo(-0.55, 0.4); ctx.closePath();
}

/** Bobsled body: bullet nose, flat rear. */
function bobBody(ctx: Ctx) {
  ctx.moveTo(-0.72, -0.37); ctx.lineTo(0.18, -0.37);
  ctx.bezierCurveTo(0.58, -0.37, 0.8, -0.17, 0.8, 0); ctx.bezierCurveTo(0.8, 0.17, 0.58, 0.37, 0.18, 0.37);
  ctx.lineTo(-0.72, 0.37); ctx.quadraticCurveTo(-0.8, 0.37, -0.8, 0.29); ctx.lineTo(-0.8, -0.29);
  ctx.quadraticCurveTo(-0.8, -0.37, -0.72, -0.37); ctx.closePath();
}

interface ModelDraw {
  sil: (ctx: Ctx) => void;
  solid: (ctx: Ctx, col: string) => void;
}

const MODELS: Record<CarModel, ModelDraw> = {
  normal: {
    sil(ctx) { ctx.roundRect(-0.8, -0.45, 1.6, 0.9, 0.28); },
    solid(ctx, col) {
      const body = () => { ctx.beginPath(); ctx.roundRect(-0.8, -0.45, 1.6, 0.9, 0.28); };
      ctx.fillStyle = col; body(); ctx.fill();
      ctx.save(); body(); ctx.clip();
      ctx.fillStyle = darken(col); ctx.fillRect(-0.8, -0.45, 0.35, 0.9); // rear (rounded by the clip)
      ctx.fillStyle = C.headlight; rr(ctx, 0.72, -0.32, 0.08, 0.12, 0.03); rr(ctx, 0.72, 0.2, 0.08, 0.12, 0.03);
      ctx.fillStyle = C.taillight; rr(ctx, -0.8, -0.32, 0.05, 0.12, 0.02); rr(ctx, -0.8, 0.2, 0.05, 0.12, 0.02);
      ctx.restore();
      ctx.fillStyle = C.glass; rr(ctx, 0.05, -0.3, 0.5, 0.6, 0.12); // windshield
    },
  },
  snowmobile: {
    sil(ctx) {
      ctx.roundRect(0.1, -0.45, 0.6, 0.08, 0.04); ctx.roundRect(0.1, 0.37, 0.6, 0.08, 0.04); // skis
      ctx.rect(0.27, -0.42, 0.07, 0.84); // ski strut
      ctx.roundRect(-0.8, -0.4, 0.5, 0.8, 0.1); // track
      sledBody(ctx);
    },
    solid(ctx, col) {
      ctx.fillStyle = C.metalLite; ctx.fillRect(0.27, -0.42, 0.07, 0.84); // ski strut
      ctx.fillStyle = C.metal;
      rr(ctx, 0.1, -0.45, 0.6, 0.08, 0.04); rr(ctx, 0.1, 0.37, 0.6, 0.08, 0.04); // skis
      rr(ctx, -0.8, -0.4, 0.5, 0.8, 0.1); // track
      ctx.strokeStyle = C.metalLite; ctx.lineWidth = 0.035;
      for (let x = -0.74; x < -0.33; x += 0.08) { ctx.beginPath(); ctx.moveTo(x, -0.36); ctx.lineTo(x, 0.36); ctx.stroke(); }
      ctx.fillStyle = col; ctx.beginPath(); sledBody(ctx); ctx.fill();
      ctx.fillStyle = darken(col); rr(ctx, -0.56, -0.25, 0.5, 0.5, 0.14); // seat
      ctx.fillStyle = C.glass; ctx.beginPath(); // windshield
      ctx.moveTo(0.22, -0.28); ctx.quadraticCurveTo(0.64, 0, 0.22, 0.28); ctx.quadraticCurveTo(0.4, 0, 0.22, -0.28); ctx.fill();
      ctx.fillStyle = C.headlight; disc(ctx, 0.68, 0, 0.04);
    },
  },
  bobsled: {
    sil(ctx) {
      ctx.roundRect(-0.74, -0.45, 1.26, 0.06, 0.03); ctx.roundRect(-0.74, 0.39, 1.26, 0.06, 0.03); // runners
      bobBody(ctx);
    },
    solid(ctx, col) {
      const dk = darken(col);
      ctx.fillStyle = C.metal;
      rr(ctx, -0.74, -0.45, 1.26, 0.06, 0.03); rr(ctx, -0.74, 0.39, 1.26, 0.06, 0.03); // runners
      ctx.fillStyle = col; ctx.beginPath(); bobBody(ctx); ctx.fill();
      ctx.save(); ctx.beginPath(); bobBody(ctx); ctx.clip();
      ctx.fillStyle = dk; ctx.fillRect(-0.8, -0.5, 0.17, 1); // rear band
      ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.fillRect(0.14, -0.065, 0.8, 0.13); // stripe on the nose
      ctx.restore();
      ctx.fillStyle = C.glass; ctx.beginPath(); ctx.ellipse(-0.12, 0, 0.28, 0.23, 0, 0, Math.PI * 2); ctx.fill(); // cockpit
      ctx.fillStyle = dk; disc(ctx, -0.06, 0, 0.125); // helmet
      ctx.fillStyle = C.visor; ctx.beginPath(); ctx.arc(-0.06, 0, 0.125, -0.85, 0.85); ctx.closePath(); ctx.fill();
    },
  },
};

/** Draws a car body in the current transform (origin = car center, +x = forward, local units). */
export function drawCarBody(ctx: Ctx, model: CarModel, color: string, faded: { fill: string; alpha: number } | null) {
  const m = MODELS[model] ?? MODELS.normal;
  if (faded) {
    ctx.globalAlpha = faded.alpha;
    ctx.fillStyle = faded.fill;
    ctx.beginPath(); m.sil(ctx); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    m.solid(ctx, color);
  }
}

/** Garage previews: a solid car of `model`, centered at (cx, cy), `len` px long, rotated by `angle`. */
export function drawCarPreview(ctx: Ctx, model: CarModel, color: string, cx: number, cy: number, len: number, angle = 0) {
  const k = len / 1.6;
  ctx.save();
  ctx.fillStyle = "rgba(5,12,20,0.22)"; // ground shadow
  ctx.beginPath(); ctx.ellipse(cx + 0.1 * k, cy + 0.12 * k, 0.95 * k, 0.55 * k, angle, 0, Math.PI * 2); ctx.fill();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(k, k);
  drawCarBody(ctx, model, color, null);
  ctx.restore();
}
