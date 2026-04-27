/**
 * Reusable motion primitives. See DESIGN.md §1, §11.
 *
 * - <Reveal>          IntersectionObserver-driven fade+slide on enter
 * - <Stagger>/<StaggerItem>  Sequenced reveal of child siblings
 * - <AnimatedNumber>  Tabular-num counter that tweens between values
 *
 * For richer motion (drag, layoutId morph, springs), reach for
 * `motion/react` directly instead.
 */

export { Reveal } from "./reveal";
export { Stagger, StaggerItem } from "./stagger";
export { AnimatedNumber } from "./animated-number";
