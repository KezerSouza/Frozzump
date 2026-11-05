// ─────────────────────────────────────────────────────────────
// Simulation parameters. Any change here alters replay results
// => bump SIM_VERSION (and the leaderboard becomes a new one).
// ─────────────────────────────────────────────────────────────

export const SIM_VERSION = 4;

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;
export const TOTAL_LAPS = 5;

// Input (bitmask, 1 byte per tick). Steering only: the car accelerates on its own.
export const IN_LEFT = 1;
export const IN_RIGHT = 2;

// Longitudinal (automatic acceleration): a = THRUST - DRAG * v  =>  v_max = THRUST / DRAG
// The time constant is 1/DRAG: ~63% of v_max after 1/DRAG s, ~95% after 3/DRAG s.
export const THRUST = 13; //             m/s²
export const DRAG_TRACK = 0.8; //      1/s  -> v_max = 16.25 m/s, ~95% at ≈3.75 s
export const DRAG_SNOW = 2.0; //      1/s  -> v_max = 6.5 m/s (deep snow, 40% of normal)

// Lateral grip. Factor per tick = 1 - grip * DT
// (plain arithmetic on purpose: no Math.exp in the simulation).
export const LAT_KEEP_TRACK = 1 - 9 * DT;
export const LAT_KEEP_SNOW = 1 - 4 * DT;
export const LAT_KEEP_AIR = 1 - 0.5 * DT;

// Steering (keyboard is digital => we smooth the steering)
export const STEER_RATE = 8; //     units/s (0 → 1 in ~0.125 s)
export const MAX_YAW = 3.1; //      rad/s at full lock (raised along with v_max to keep the turning radius)
export const V_REF = 3; //          m/s: below this, yaw is proportional to speed
export const STEER_AIR_SCALE = 0.25;

// Vehicle and walls
export const CAR_RADIUS = 0.72; // 20% larger (the visuals use CAR_SCALE = 1.2 in render.ts)
export const WALL_BOUNCE = 0.15;
export const WALL_KEEP = 0.95; //     fraction of speed kept each tick while in contact (scraping)
export const WALL_IMPACT = 0.03; //   extra loss per m/s of speed "into" the wall (impact)
export const WALL_MIN_KEEP = 0.4; //  an impact never takes more than 60% of the speed at once

// Ramp
export const AIR_TICKS = 66; //     0.55 s airborne (~11 m: enough to clear the snow)
export const BOOST_SPEED = 20.2; // m/s ≈ 1.25 × v_max
