"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Dot-matrix loader. 5×5 SVG grid animated entirely via CSS — one
 * @keyframes definition (a pulse, breath, trail, etc.) applied to every
 * lit cell with per-cell `animation-delay` to produce coordinated motion
 * (rings, sweeps, sparkles, agent states). Adapted from the dot/matrix
 * collection at https://icons.icantcode.fyi/
 * (https://github.com/icantcodefyi/dot-matrix-animations).
 *
 * Replaces the previous in-house Matrix component. Wins:
 *   - GPU-composited (opacity only) instead of JS-driven brightness arrays
 *   - ~4 KB rendered SVG vs. 750+ lines of grid code
 *   - Honors `prefers-reduced-motion` automatically
 *   - 17 curated patterns across agent / ambient / spinner / progress /
 *     status, picked deterministically per call-site so a long live
 *     timeline shows varied "alive" indicators instead of a single dot
 *     pattern repeated 14 times.
 */

// ── Grid geometry (5×5, padded so the dots breathe) ────────────────────
const GRID = 5;
const PAD = 6;
const SPACING = 11;
const VIEWBOX = PAD * 2 + SPACING * (GRID - 1); // 50
const DOT_R_BASE = 2.4;
const DOT_R_LIT = 3.1;
const CENTER = (GRID - 1) / 2;

function dotPosition(col: number, row: number): [number, number] {
  return [PAD + col * SPACING, PAD + row * SPACING];
}

// ── Easings & keyframes (shared across patterns) ───────────────────────
const EASE_OUT_QUART = "cubic-bezier(0.25, 1, 0.5, 1)";
const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

const KF = {
  pulse: "0%{opacity:0;}8%{opacity:1;}36%{opacity:0.05;}100%{opacity:0;}",
  breath: "0%{opacity:0.05;}20%{opacity:1;}55%{opacity:0.18;}100%{opacity:0.05;}",
  heart: "0%{opacity:0.18;}6%{opacity:0.95;}14%{opacity:0.30;}22%{opacity:1;}34%{opacity:0.20;}70%{opacity:0.18;}100%{opacity:0.18;}",
  trail: "0%{opacity:0;}4%{opacity:1;}26%{opacity:0.08;}100%{opacity:0;}",
  slowBreath: "0%{opacity:0.10;}50%{opacity:0.85;}100%{opacity:0.10;}",
  beacon: "0%{opacity:0.12;}14%{opacity:1;}40%{opacity:0.12;}100%{opacity:0.12;}",
  bloom: "0%{opacity:0;}10%{opacity:1;}55%{opacity:0.85;}100%{opacity:0;}",
  ring: "0%{opacity:0.10;}20%{opacity:1;}60%{opacity:0.20;}100%{opacity:0.10;}",
  synapse: "0%{opacity:0.05;}30%{opacity:0.05;}40%{opacity:1;}55%{opacity:0.10;}100%{opacity:0.05;}",
  cipher: "0%{opacity:0;}8%{opacity:1;}22%{opacity:0.05;}46%{opacity:0.85;}58%{opacity:0.05;}100%{opacity:0;}",
  fill: "0%{opacity:0.08;}14%{opacity:1;}72%{opacity:0.95;}100%{opacity:0.08;}",
} as const;

// ── Cell-order helpers used by patterns ────────────────────────────────
const EDGE_ORDER: Array<readonly [number, number]> = [];
for (let c = 0; c < GRID; c++) EDGE_ORDER.push([c, 0]);
for (let r = 1; r < GRID; r++) EDGE_ORDER.push([GRID - 1, r]);
for (let c = GRID - 2; c >= 0; c--) EDGE_ORDER.push([c, GRID - 1]);
for (let r = GRID - 2; r > 0; r--) EDGE_ORDER.push([0, r]);

const findIndex = (
  list: ReadonlyArray<readonly [number, number]>,
  col: number,
  row: number,
) => list.findIndex(([c, r]) => c === col && r === row);

const hash01 = (idx: number, salt = 1): number => {
  const h =
    ((idx * 2654435761) ^ (idx * idx * 40503) ^ (salt * 374761393)) >>> 0;
  return (h % 1000) / 1000;
};

// ── Patterns ───────────────────────────────────────────────────────────
type DelayFn = (col: number, row: number) => number;

interface PatternSpec {
  title: string;
  durationMs: number;
  easing: string;
  keyframes: string;
  /** Returns 0..1 within cycle, or -1 to skip the cell (stays at base). */
  delay: DelayFn;
}

const PATTERNS: Record<string, PatternSpec> = {
  // Agent — "AI is doing something"
  thinking: {
    title: "Thinking",
    durationMs: 1800,
    easing: EASE_IN_OUT,
    keyframes: KF.synapse,
    delay: (col, row) => {
      if (col < 1 || col > 3 || row < 1 || row > 3) return -1;
      return hash01((row - 1) * 3 + (col - 1), 7);
    },
  },
  stream: {
    title: "Stream",
    durationMs: 2400,
    easing: EASE_OUT_QUART,
    keyframes: KF.trail,
    delay: (col, row) => (row * GRID + col) / 28,
  },
  cipher: {
    title: "Cipher",
    durationMs: 1600,
    easing: EASE_OUT_QUART,
    keyframes: KF.cipher,
    delay: (col, row) => {
      const idx = row * GRID + col;
      const h = ((idx * 1103515245 + 12345) ^ (idx * idx * 2654435761)) >>> 0;
      return (h % 4) / 4;
    },
  },
  listening: {
    title: "Listening",
    durationMs: 2200,
    easing: EASE_OUT_EXPO,
    keyframes: KF.pulse,
    delay: (col, row) => {
      const d = Math.max(Math.abs(col - CENTER), Math.abs(row - CENTER));
      return (2 - d) / 6;
    },
  },
  radar: {
    title: "Radar",
    durationMs: 2200,
    easing: "linear",
    keyframes: KF.trail,
    delay: (col, row) => {
      if (col === CENTER && row === CENTER) return 0;
      const idx = findIndex(EDGE_ORDER, col, row);
      return idx < 0 ? -1 : idx / EDGE_ORDER.length;
    },
  },
  // Ambient — quieter "alive" indicators
  pulseRings: {
    title: "Pulse Rings",
    durationMs: 2200,
    easing: EASE_OUT_EXPO,
    keyframes: KF.pulse,
    delay: (col, row) =>
      Math.max(Math.abs(col - CENTER), Math.abs(row - CENTER)) / 6,
  },
  wave: {
    title: "Wave",
    durationMs: 2400,
    easing: EASE_IN_OUT,
    keyframes: KF.breath,
    delay: (col, row) => col / 5 + row * 0.02,
  },
  crossExpand: {
    title: "Cross Expand",
    durationMs: 2200,
    easing: EASE_OUT_EXPO,
    keyframes: KF.pulse,
    delay: (col, row) => (Math.abs(col - CENTER) + Math.abs(row - CENTER)) / 10,
  },
  diamond: {
    title: "Diamond",
    durationMs: 2200,
    easing: EASE_OUT_EXPO,
    keyframes: KF.bloom,
    delay: (col, row) => (Math.abs(col - CENTER) + Math.abs(row - CENTER)) / 12,
  },
  breath: {
    title: "Breath",
    durationMs: 2800,
    easing: EASE_IN_OUT,
    keyframes: KF.slowBreath,
    delay: () => 0,
  },
  ringPulse: {
    title: "Ring Pulse",
    durationMs: 2000,
    easing: EASE_OUT_QUART,
    keyframes: KF.ring,
    delay: (col, row) => (findIndex(EDGE_ORDER, col, row) >= 0 ? 0 : -1),
  },
  echo: {
    title: "Echo",
    durationMs: 2600,
    easing: EASE_OUT_EXPO,
    keyframes: KF.ring,
    delay: (col, row) =>
      Math.max(Math.abs(col - CENTER), Math.abs(row - CENTER)) / 3,
  },
  aperture: {
    title: "Aperture",
    durationMs: 2400,
    easing: EASE_IN_OUT,
    keyframes: KF.bloom,
    delay: (col, row) =>
      Math.max(Math.abs(col - CENTER), Math.abs(row - CENTER)) / 6,
  },
  // Status — single-point "heartbeat" feel
  heartbeat: {
    title: "Heartbeat",
    durationMs: 1600,
    easing: EASE_OUT_QUART,
    keyframes: KF.heart,
    delay: (col, row) =>
      Math.min(Math.hypot(col - CENTER, row - CENTER) * 0.015, 0.06),
  },
  beacon: {
    title: "Beacon",
    durationMs: 1800,
    easing: EASE_OUT_EXPO,
    keyframes: KF.beacon,
    delay: (col, row) => (col === CENTER && row === CENTER ? 0 : -1),
  },
  // Progress / spinner — "doing structured work" feel
  compile: {
    title: "Compile",
    durationMs: 2400,
    easing: EASE_IN_OUT,
    keyframes: KF.fill,
    delay: (col, row) => col * 0.04 + (GRID - 1 - row) * 0.1,
  },
  bar: {
    title: "Bar",
    durationMs: 1800,
    easing: EASE_OUT_QUART,
    keyframes: KF.pulse,
    delay: (col, row) => {
      if (col < 1 || col > 3) return -1;
      return row / 6;
    },
  },
  boot: {
    title: "Boot",
    durationMs: 2400,
    easing: EASE_OUT_QUART,
    keyframes: KF.fill,
    delay: (_col, row) => row / 6,
  },
} as const;

export type DotMatrixPattern = keyof typeof PATTERNS;

// ── Curated pools by call-site ─────────────────────────────────────────
// Each call-site picks from a hand-tuned subset so the visual register is
// consistent (e.g. `subtle` is tiny + quiet, `agent` reads as "AI working").
const POOLS = {
  agent: [
    "thinking",
    "stream",
    "cipher",
    "listening",
    "radar",
    "pulseRings",
    "crossExpand",
    "echo",
    "aperture",
    "diamond",
    "wave",
    "ringPulse",
  ],
  subtle: ["beacon", "breath", "heartbeat", "pulseRings"],
  thinking: ["thinking", "stream", "cipher", "listening"],
  tool: ["stream", "compile", "cipher", "bar", "boot"],
} satisfies Record<string, ReadonlyArray<DotMatrixPattern>>;

export type DotMatrixVariant = keyof typeof POOLS;

function hashSeed(seed: string | number | undefined): number {
  if (seed == null) return 0;
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickDotMatrixPattern(
  variant: DotMatrixVariant,
  seed: string | number | undefined,
): DotMatrixPattern {
  const pool = POOLS[variant];
  return pool[hashSeed(seed) % pool.length]!;
}

// ── Component ──────────────────────────────────────────────────────────
export interface DotMatrixProps
  extends Omit<React.SVGProps<SVGSVGElement>, "color"> {
  /** Explicit pattern to render. Takes precedence over `variant`. */
  pattern?: DotMatrixPattern;
  /** Pick from a curated pool deterministically using `seed`. */
  variant?: DotMatrixVariant;
  /** Stable seed for deterministic picks within a variant. */
  seed?: string | number;
  /** SVG square size in px. Default 24. */
  size?: number;
  /** Lit-cell color. Defaults to `currentColor`. */
  color?: string;
  /** Resting/background dot color. Defaults to `color`. */
  baseColor?: string;
  /** 1 = native; 2 = 2× faster. */
  speedMultiplier?: number;
  /** When false, dots stay in their resting state. */
  autoPlay?: boolean;
  /** Title used as accessible label. */
  ariaLabel?: string;
}

export function DotMatrix({
  pattern,
  variant = "agent",
  seed,
  size = 24,
  color = "currentColor",
  baseColor,
  speedMultiplier = 1,
  autoPlay = true,
  ariaLabel,
  className,
  style,
  ...props
}: DotMatrixProps) {
  const slug = pattern ?? pickDotMatrixPattern(variant, seed);
  const spec = PATTERNS[slug];
  const rawId = React.useId();
  const id = `dm-${rawId.replace(/[:]/g, "")}-${slug}`;

  const speed = speedMultiplier > 0 ? speedMultiplier : 1;
  const scaledDuration = Math.round(spec.durationMs / speed);
  const animation = autoPlay
    ? `${id}-kf ${scaledDuration}ms ${spec.easing} infinite both`
    : "none";
  const restOpacity = autoPlay ? 0 : 0.45;

  const styleSheet = `
    .${id}-bg { fill: ${baseColor ?? color}; opacity: 0.07; }
    .${id}-lit { fill: ${color}; opacity: ${restOpacity}; animation: ${animation}; }
    @keyframes ${id}-kf {${spec.keyframes}}
    @media (prefers-reduced-motion: reduce) {
      .${id}-lit { animation: none; opacity: 0.45; }
    }
  `;

  const dots: React.ReactNode[] = [];
  const litDots: React.ReactNode[] = [];
  const cellRules: string[] = [];

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const [cx, cy] = dotPosition(col, row);
      dots.push(
        <circle
          key={`bg-${row}-${col}`}
          className={`${id}-bg`}
          cx={cx}
          cy={cy}
          r={DOT_R_BASE}
        />,
      );
      const delay = spec.delay(col, row);
      if (delay < 0) continue;
      const delayMs = Math.round((delay * spec.durationMs) / speed);
      const dotClass = `${id}-d${row}${col}`;
      cellRules.push(`.${dotClass} { animation-delay: ${delayMs}ms; }`);
      litDots.push(
        <circle
          key={`lit-${row}-${col}`}
          className={`${id}-lit ${dotClass}`}
          cx={cx}
          cy={cy}
          r={DOT_R_LIT}
        />,
      );
    }
  }

  const label = ariaLabel ?? spec.title;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      style={style}
      {...props}
    >
      <title>{label}</title>
      <style>{styleSheet + cellRules.join("\n")}</style>
      {dots}
      {litDots}
    </svg>
  );
}
