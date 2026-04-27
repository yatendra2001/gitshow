# GitShow Design Guidelines

A single source of truth for how GitShow looks, feels, and animates. Every UI decision should reference this document. Based on Emil Kowalski's design engineering principles, adapted for our developer tools aesthetic.

## North Star

GitShow is a **premium developer tool**. The interface should feel:

- **Quiet**: Nothing competes for attention until it's earned.
- **Fast**: Sub-300ms for any UI animation; speed > delight in product surfaces.
- **Tactile**: Every interactive element responds — hover, press, focus, success.
- **Confident**: Generous whitespace, restrained color, decisive typography.

We're closer to **Linear / Raycast / Vercel** than **Notion / Figma / Stripe**. Spirit, not pixel-perfect copy.

---

## 1. Motion Tokens

All easing curves, durations, and shadows are CSS variables defined in [`apps/web/app/globals.css`](apps/web/app/globals.css). Reference the tokens — never hand-roll a `cubic-bezier()` in a component.

### Easing — pick by intent

| Intent | Token | When |
| --- | --- | --- |
| Element entering / exiting screen | `--ease-out-cubic` | Dropdowns, tooltips, modals, toasts, popovers |
| Strong entrance (more snap) | `--ease-out-quint`, `--ease-out-expo` | Hero reveals, marketing CTAs |
| Movement of on-screen element | `--ease-in-out-cubic` | Sidebar drawer, layout morph, sortable rows |
| Hover / color transition | `--ease-soft` | All hover states, color fades, pressed feedback |
| Linear | (avoid) | Only marquees, progress timers |
| Ease-in | (never) | Always feels sluggish — slow start delays feedback |

### Duration — pick by element type

| Element | Token | ms |
| --- | --- | --- |
| Tap feedback, focus ring | `--duration-instant` | 80 |
| Hover, color change | `--duration-fast` | 140 |
| Tooltip, dropdown, popover | `--duration-base` | 220 |
| Dialog, drawer, sheet | `--duration-slow` | 320 |
| Page-level reveal | `--duration-page` | 420 |

**Rules**:

- UI animations stay under 300ms.
- Larger surface = longer duration (small badge: 140ms, full dialog: 320ms).
- Exit can be faster than entrance.
- Things users see 100+ times/day → don't animate at all (Raycast never animates its menu toggle).

### Paired elements rule

If two things move as a unit (modal + overlay, drawer + backdrop), they share the same easing **and** duration.

```css
.modal   { transition: transform 320ms var(--ease-out-cubic); }
.overlay { transition: opacity   320ms var(--ease-out-cubic); }
```

### Springs (motion/react)

Use springs only when the gesture must feel physically responsive (drag-to-dismiss, dock zoom, layoutId morph). Apple's bounce model:

```ts
{ type: "spring", duration: 0.5, bounce: 0.1 }
```

Keep `bounce` at **0.1–0.2** — playful interfaces use 0.3+; ours never should.

---

## 2. Color

OKLCH-based scale lives in `globals.css`. Do **not** introduce raw `#hex`/`rgb()` in components — always reference the token.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.18 0 0)` | Page bg |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | Body text, primary fg |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | Surface bg |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Secondary bg |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` | Secondary text |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` | Hairlines |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` | Focus rings |
| `--gradient-primary` / `--gradient-secondary` | sky / indigo | brighter | Highlights only |

### Hover & state opacities

Use `oklch(from var(--foreground) l c h / X%)` to create state layers — they auto-adapt to the theme:

| State | Opacity |
| --- | --- |
| Default surface hover | `0.04` |
| Active surface (selected nav, pressed) | `0.06` – `0.08` |
| Strong focus / hold | `0.12` |
| Selection background | `0.18` |
| Hairline / divider | `0.06` – `0.10` |

### Don't

- **Never** use Tailwind's `dark:` modifier to swap arbitrary colors. Flip CSS variables instead.
- No saturated chroma in product UI — accents only for highlights and the primary CTA.
- No custom focus outline color other than the ring token.

---

## 3. Typography

Geist Sans + Geist Mono. Configured in `app/layout.tsx`.

### Scale

```
Display      48–60px  font-semibold tracking-tighter
H1           32–48px  font-semibold tracking-tight
H2           24–32px  font-semibold tracking-tight
H3           18–20px  font-semibold tracking-tight
Body         14–15px  font-normal
Caption      12–13px  text-muted-foreground
Eyebrow      10–11px  uppercase tracking-[0.08em] text-muted-foreground/60
Mono         12–14px  font-mono text-muted-foreground (paths, slugs)
```

### Rules

- **Never change font weight on hover or when selected**. Layout shift. Use color or a side indicator instead.
- Use `text-balance` on headings (already in `@layer base`).
- Use `text-pretty` on paragraphs.
- Use `tabular-nums` (or the `.tabular` utility) for any number that updates: counters, prices, timers, percentages, file sizes.
- Use `…` (real ellipsis) and curly quotes (`'` `"`), not `...` and `'` `"`.

---

## 4. Layout & Spacing

### Spacing scale

Use Tailwind's default scale (`1` = 4px). Round numbers only — no `gap-[7px]`.

- Tight clusters: `gap-1`, `gap-1.5`, `gap-2`
- Component internals: `gap-2`, `gap-3`, `gap-4`
- Section internals: `gap-6`, `gap-8`
- Page sections: `py-16`, `py-24`

### Borders

Prefer **box-shadow inset** to `border` when the element sits on top of a colored surface — it blends better:

```css
box-shadow: 0 0 0 1px oklch(from var(--foreground) l c h / 0.08);
```

Use the `.border-hairline` utility for 0.5px borders on retina (1px fallback).

### Z-index — fixed scale

Defined in `globals.css`. Never use `z-index: 9999`.

```
dropdown:  100
modal:     200
tooltip:   300
toast:     400
```

Better: avoid z-index entirely with `isolation: isolate` or a new stacking context.

### Radii

| Size | Use |
| --- | --- |
| `rounded-md` (8px) | Inputs, buttons, list rows |
| `rounded-lg` (10px) — base | Cards, sidebar surfaces |
| `rounded-xl` (14px) | Dialogs, sheets |
| `rounded-2xl` (16px) | Hero CTAs, marketing tiles |
| `rounded-full` | Pills, avatars, icon buttons |

---

## 5. Hover & Press — every interactive element

Every clickable surface gets **at least three feedback states**: hover, active (press), focus-visible.

### Quick table

| Element | Hover | Press | Focus |
| --- | --- | --- | --- |
| Primary button | bg fade `+/− 10%` lightness, `shadow-lift-sm` | `scale(0.97)` 80ms | ring 2px @ ring/60 |
| Outline / ghost | bg `--foreground / 0.04`, `lift-on-hover` -1px | `scale(0.97)` | ring 2px |
| Card (interactive) | `lift-on-hover` -1px + `shadow-lift-md` | bounce-back at 0 | ring 2px |
| Sidebar nav row | bg `--foreground / 0.04`, color → fg | (no press) | ring inset |
| Icon button | bg `--foreground / 0.04`, color → fg | scale 0.94 | ring 2px |
| Link | underline-offset-4 underline | (no press) | ring 2px |

### Utilities (pre-built in `globals.css`)

- `.lift-on-hover` — translate -1px + soft shadow, only on `hover: hover` devices, springs back on press.
- `.press` — `scale(0.97)` on `:active`, 80ms.
- `.soft-hover` — bg/color/border transition only (never `transition: all`).
- `.shine-on-hover` — diagonal sheen sweep, useful on premium CTAs (not everywhere — frequency principle).
- `.focus-ring` — premium 2px ring with 2px offset spacer.

### Don'ts

- **No hover effects on touch devices**. Wrap in `@media (hover: hover) and (pointer: fine)`. Already handled by `.lift-on-hover`.
- **No font-weight change on hover or when selected**. Layout shift.
- **Never use `transition: all`**. Specify exact properties.

---

## 6. Component-level guidance

### Buttons

- Default size: `h-9 px-4` (36px tap height); on touch screens, parents should give it `min-h-11` (44px) hit area.
- Primary CTA gets a 1px inset light highlight (`inset 0 1px 0 rgb(255 255 255 / 0.10)`) so it reads as "raised" in both themes.
- Loading state: text stays in place, spinner appears in left slot. **No layout shift.** Use a fixed-width slot.
- Press scale 0.97; lift on hover only for outlined / ghost variants (a pressed primary CTA shouldn't appear to "lift" — it's already raised).

### Cards

- Default: `rounded-lg border border-border/40 bg-card`.
- Interactive: add `.lift-on-hover` and `.press`.
- Header / Title / Content / Footer slots — keep `gap-1.5` between title and description.
- Stat cards: tabular-nums on the number, fade-in the value after data loads (not the card frame).

### Inputs

- `h-9` minimum, `text-sm` (14px on desktop, **16px on mobile** to prevent iOS zoom).
- Border on focus uses the `--ring` token; subtle 2px ring at 50% opacity.
- Error state: `border-destructive` plus an icon, never just a color.
- Validate on blur, not on every keystroke.

### Dialogs / Drawers

- Overlay and content share easing/duration (paired elements rule).
- Content scales from `0.95 → 1` (never from `0`) and fades in.
- Esc closes, click-outside closes, focus trapped, focus restored on close.
- Mobile: drawer from bottom or fullscreen sheet — never a centered modal that can't be dismissed by swipe.

### Tooltips

- 220ms enter, 100ms exit.
- 200ms delay on first tooltip; sequential tooltips (within 1.5s) skip the delay.
- Position: 4px offset from trigger; arrow optional.
- Never essential for understanding the UI — accessibility fallback required.

### Sidebar nav (dashboard shell)

- Active row: `bg-foreground/[0.06]` + 2px left accent + foreground text.
- Hover: `bg-foreground/[0.04]`, color → foreground (120ms fade).
- Active state itself does **not** transition — toggling routes must feel instant. The 120ms fade is hover-only. Frequency principle: users hit the sidebar 100×/day.
- Section headings: 10px uppercase tracking-[0.08em] muted/60.
- Mobile drawer: 200ms slide + backdrop fade together.
- **Don't** use `motion.span` + `layoutId` to morph the active highlight between rows. The in-between state during navigation feels like flicker — RSC re-renders + the layout animation overlap. A static toggle is faster and reads as more confident.

### Toasts (Sonner)

- Position: bottom-right desktop, top-center mobile.
- Auto-dismiss 4s for success, 6s for error, never for action-required.
- Stack max 3 visible.
- Use `richColors` only for destructive/success — never for info.

---

## 7. Touch & Accessibility

### Touch

- Minimum tap target: **44 × 44px**. Use a pseudo-element to grow the hit area without growing the visual:
  ```css
  .small-icon { position: relative; }
  .small-icon::after {
    content: ""; position: absolute; inset: -10px;
  }
  ```
- Disable hover effects on touch devices via `@media (hover: hover) and (pointer: fine)`.
- Inputs are 16px+ on mobile to prevent iOS zoom.
- Account for safe areas: `padding-bottom: env(safe-area-inset-bottom)` on bottom-fixed bars.

### Keyboard

- Tab order matches reading order.
- Tabbing into a hidden element is forbidden — use `aria-hidden` + `tabindex={-1}` on closed drawers.
- All interactive elements have `:focus-visible` styles.
- Modal focus trap with restore.
- `cmd+enter` submits forms, `esc` closes overlays.

### Screen readers

- Every icon-only button has an `aria-label`.
- Every animated counter has `aria-live="polite"`.
- Every loading state has `role="status"` + visually-hidden label.
- Decorative SVGs get `aria-hidden="true"`.

### Reduced motion

Every animation also handles `prefers-reduced-motion: reduce`. The base utilities (`.gs-*`, `.reveal`, `.lift-on-hover`, `.press`, `.shine-on-hover`) already do — when you write a custom animation, add the media query yourself. Use `transition: none` (no `!important` unless overriding utility classes).

For motion/react:

```tsx
import { useReducedMotion } from "motion/react";
const reduce = useReducedMotion();
<motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} />
```

---

## 8. Performance

### The golden rule

Only animate `transform` and `opacity`. Both skip layout/paint and run on the GPU.

**Never animate**: `width`, `height`, `padding`, `margin`, `top/left`, `box-shadow` (animate via opacity overlay instead), `filter: blur > 20px` (especially Safari).

### Use `will-change` sparingly

Only for elements that animate. Remove it when the animation finishes:

```css
.lift-on-hover { will-change: transform; }
```

### React-specific

- Don't re-render on every animation frame — use refs for direct DOM updates inside motion handlers.
- For long lists, use `react-window` / virtualization above ~100 items.
- Defer below-the-fold content with `<Suspense>` or dynamic imports (the marketing dither effect is a good example — see `lazy-dither.tsx`).
- Pause looping animations when off-screen.

---

## 9. Marketing vs Product

| | Marketing | Product (dashboard, intake, scan) |
| --- | --- | --- |
| Animation duration | 280–600ms ok | < 300ms |
| Reveal-on-scroll | Yes, generously | No (causes lag on dense data UI) |
| Background effects (dither, grain) | Yes, lazy-loaded | No |
| Hero / large display type | Yes | No |
| Testimonials, marquees | Yes | No |
| Speed > delight | Sometimes | Always |

Marketing pages can be more elaborate; product UI must be invisible. A user opens the dashboard 50× a day — every animated transition costs them 5 seconds per session.

---

## 10. Theme switching

When `next-themes` flips the `.dark` class, every transition fires at once (the "theme flash"). To prevent this:

1. Add `.theme-switching` to `<html>` right before flipping the theme.
2. Wait one animation frame.
3. Remove `.theme-switching`.

The `.theme-switching` class disables every transition/animation for the duration. Already wired in `globals.css`. The dashboard `ThemeToggle` and marketing `ThemeToggle` should both call this — see [`apps/web/lib/theme-helpers.ts`](apps/web/lib/theme-helpers.ts).

---

## 11. Reveal-on-scroll

Two options:

**CSS-only** (cheaper — preferred for marketing):
```tsx
<Reveal as="section" delay={120}>...</Reveal>
```
The `<Reveal>` component adds `.reveal` initially and toggles `.is-visible` via IntersectionObserver. No layout shift — opacity + transform only.

**motion/react** (use only when you need orchestration):
```tsx
import { motion } from "motion/react";
<motion.div
  initial={{ opacity: 0, y: 8 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.3 }}
  transition={{ duration: 0.4, ease: [0.215, 0.61, 0.355, 1] }}
/>
```

**Don't reveal-on-scroll inside the dashboard.** It's distracting in dense UIs and adds perceived lag.

---

## 12. Decorative elements

- Decorative SVGs: `pointer-events: none` so they never hijack clicks.
- Code-art illustrations (the matrix dot grid, dither effect): `user-select: none`.
- Background gradients use `mask-image`, not solid colors with opacity — better composition.

---

## 13. The review checklist

Before merging UI work:

- [ ] No layout shift on dynamic content (use fixed widths, tabular numbers, no font-weight swaps).
- [ ] Every animation has `prefers-reduced-motion` support.
- [ ] Touch targets ≥ 44px.
- [ ] Hover effects gated by `@media (hover: hover) and (pointer: fine)`.
- [ ] Keyboard navigation works; `:focus-visible` styles present.
- [ ] Icon buttons have `aria-label`.
- [ ] Inputs are ≥ 16px on mobile.
- [ ] No `transition: all`.
- [ ] Z-index uses fixed scale.
- [ ] Colors via CSS variables, never raw hex.
- [ ] Easing curves via tokens, never raw cubic-bezier in components.
- [ ] `transform` + `opacity` only for animations.

---

## 14. Common mistakes & fixes

| Mistake | Fix |
| --- | --- |
| `transition: all` | Specify exact properties |
| Hover effect that fires on tap | `@media (hover: hover) and (pointer: fine)` |
| Font weight changes on selected tab | Keep weight constant; use color or indicator |
| Animating height/width | Use transform / opacity / `clip-path` |
| Theme flash on toggle | Wrap with `.theme-switching` for one frame |
| `z-index: 9999` | Use the fixed scale or `isolation: isolate` |
| `...` in copy | Use `…` |
| `height` skeleton | Hardcoded dimensions matching final content |
| Loud focus outline | Use the `--ring` token, 2px |
| Animating shadow / blur | Animate the opacity of an overlay layer instead |

---

## 15. File map

```
apps/web/
├── app/globals.css           # All motion tokens, color vars, base typography
├── components/
│   ├── ui/                   # shadcn primitives (Button, Card, Dialog, …)
│   │   └── motion/           # ⭐ Reusable motion primitives (Reveal, FadeIn, etc.)
│   ├── magicui/              # Higher-order animated components (BlurFade, Dock)
│   ├── marketing/            # Marketing components (more elaborate motion)
│   ├── dashboard/            # Dashboard shell, cards, charts (subtle motion)
│   └── ai-elements/          # AI streaming components (gs-stream utilities)
├── lib/
│   ├── utils.ts              # cn() and friends
│   └── theme-helpers.ts      # ⭐ flipTheme() — wraps .theme-switching
DESIGN.md                     # ← you are here
```

---

## 16. When in doubt

Ask: **would Linear ship this?**

If the answer is no — it's too loud, too slow, too clever, or too cute — pull it back. We optimize for the user's seventh visit, not their first.
