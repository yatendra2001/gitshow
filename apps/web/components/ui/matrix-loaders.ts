/**
 * Custom Matrix loader presets — designed in-house, not from
 * ElevenLabs' library, to fit GitShow's quiet/premium aesthetic.
 *
 * The stock `loader` is an 8-particle radial chase that reads
 * "spinner" — fine, but loud at small sizes and visually busy. These
 * three are tuned for the live-scan timeline:
 *
 *   - concentricBreath: a slow pulse that radiates outward and back.
 *     Replaces the legacy ping-ring on phase dots without losing the
 *     "wave" energy.
 *   - scanLine: a vertical column sweeps left→right with a soft
 *     trail. Useful inside Reasoning/Tool cards as a tiny "working"
 *     hint without grabbing attention.
 *   - breathingDot: a single centred dot fades 0.25 → 1 → 0.25 on a
 *     2s cycle. The minimum-viable "alive" indicator. Use it where
 *     the surrounding row already has plenty of motion (text
 *     shimmer) and the matrix shouldn't fight for attention.
 *
 * All frames are 5×5 to keep SVG node counts low. They render at
 * size+gap to whatever scale the host picks; we typically use
 * size=3 gap=1 for ~19px diameter and size=2 gap=1 for ~14px.
 */

import type { Frame } from "./matrix";

const N = 5;
const C = 2; // grid centre

function emptyFrame(): Frame {
  return Array.from({ length: N }, () => Array.from({ length: N }, () => 0));
}

function setPx(f: Frame, r: number, c: number, v: number): void {
  if (r < 0 || r >= N || c < 0 || c >= N) return;
  f[r]![c] = Math.max(f[r]![c] ?? 0, v);
}

/**
 * Brightness per ring (Chebyshev distance from centre):
 *   ring 0 = single centre cell
 *   ring 1 = 8 cells at distance 1 (a 3×3 minus centre)
 *   ring 2 = 16 cells at distance 2 (5×5 perimeter)
 *
 * `t` is the phase, 0..1 around the cycle. We render TWO rings
 * simultaneously with a soft cosine falloff so the wave looks
 * continuous rather than a stepped frame-by-frame switch.
 */
function ringBrightness(distance: number, t: number): number {
  // Map t∈[0,1] to peak ring r∈[0,2.4]; the slight overshoot lets the
  // wave fade past the edge before resetting.
  const peak = t * 2.4;
  const delta = Math.abs(distance - peak);
  // Cosine falloff with bandwidth ~1.0. Brightness clamps to [0, 1].
  if (delta > 1) return 0;
  return Math.cos((delta * Math.PI) / 2) * 0.95;
}

export const concentricBreath: Frame[] = (() => {
  const FRAMES = 28;
  const out: Frame[] = [];
  for (let i = 0; i < FRAMES; i++) {
    // Smooth half-sine in/out so the wave breathes (slows at the
    // peaks and accelerates through the middle) instead of running
    // at constant linear speed.
    const t = (1 - Math.cos((i / FRAMES) * Math.PI * 2)) / 2;
    const f = emptyFrame();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const d = Math.max(Math.abs(r - C), Math.abs(c - C));
        const b = ringBrightness(d, t);
        if (b > 0.05) setPx(f, r, c, b);
      }
    }
    out.push(f);
  }
  return out;
})();

export const scanLine: Frame[] = (() => {
  const FRAMES = 20;
  const TRAIL = 2;
  const out: Frame[] = [];
  for (let i = 0; i < FRAMES; i++) {
    // The head ranges across cols [-TRAIL .. N+TRAIL] so the line
    // enters/exits cleanly off-grid. Maps i∈[0..FRAMES) to that.
    const head = (i / FRAMES) * (N + TRAIL * 2) - TRAIL;
    const f = emptyFrame();
    for (let c = 0; c < N; c++) {
      const dist = head - c;
      if (dist < 0) continue; // hasn't reached this column yet
      if (dist > TRAIL) continue;
      // Trailing falloff: front of trail = 1.0, back = 0.2
      const b = 1 - dist / TRAIL;
      for (let r = 0; r < N; r++) {
        // Vignette the line vertically so the middle row is
        // brightest — cleaner than a flat bar.
        const v =
          1 -
          Math.pow((r - C) / C, 2) * 0.4;
        setPx(f, r, c, Math.max(0.15, b * v));
      }
    }
    out.push(f);
  }
  return out;
})();

export const breathingDot: Frame[] = (() => {
  const FRAMES = 24;
  const out: Frame[] = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = (1 - Math.cos((i / FRAMES) * Math.PI * 2)) / 2;
    // 0.25 .. 1.0 range; never goes fully dark so the dot reads as
    // "alive but not flashing".
    const b = 0.25 + t * 0.75;
    const f = emptyFrame();
    setPx(f, C, C, b);
    // Soft halo at peak — adjacent four cells dimly lit.
    if (t > 0.5) {
      const halo = (t - 0.5) * 0.4;
      setPx(f, C - 1, C, halo);
      setPx(f, C + 1, C, halo);
      setPx(f, C, C - 1, halo);
      setPx(f, C, C + 1, halo);
    }
    out.push(f);
  }
  return out;
})();
