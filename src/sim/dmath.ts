// Deterministic maths for the simulation. Only + - * / and sqrt (all IEEE-754 exact)
// are used, so every device and the Durable Object produce identical results.
// Math.sin/cos/atan2/pow/exp/log are banned in src/sim by ESLint.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  let r = a;
  while (r >= PI) r -= TAU;
  while (r < -PI) r += TAU;
  return r;
}

/** sin via range reduction + odd Taylor series (max error ~1e-9). */
export function dsin(x: number): number {
  let a = wrapAngle(x);
  if (a > HALF_PI) a = PI - a;
  else if (a < -HALF_PI) a = -PI - a;
  const a2 = a * a;
  return (
    a *
    (1 +
      a2 *
        (-1 / 6 +
          a2 *
            (1 / 120 +
              a2 * (-1 / 5040 + a2 * (1 / 362880 + a2 * (-1 / 39916800 + a2 * (1 / 6227020800)))))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** atan2 using a polynomial approximation of atan on [0,1] (error < 1e-5). */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const swap = ay > ax;
  const t = swap ? ax / ay : ay / ax;
  const t2 = t * t;
  let a = t * (0.9998660 + t2 * (-0.3302995 + t2 * (0.1801410 + t2 * (-0.0851330 + t2 * 0.0208351))));
  if (swap) a = HALF_PI - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}
