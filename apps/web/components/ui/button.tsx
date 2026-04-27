import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button — premium hover, press, focus, and disabled states.
 *
 * Premium feel comes from four subtle additions on top of the
 * shadcn baseline:
 *   1. `transition-[background-color,box-shadow,transform,color]`
 *      — never `transition-all`, never animates layout properties.
 *   2. `active:scale-[0.97]` 80ms — every clickable surface has
 *      tactile press feedback (Emil §5).
 *   3. Inset light highlight on the primary variant — reads as
 *      "raised" without looking 3D.
 *   4. `:focus-visible` ring is keyboard-only (mouse focus stays
 *      clean), 2px on a 2px spacer for double-ring on dark surfaces.
 *
 * Default size grew from `h-9` to `h-9` with adjusted padding so a
 * 36px button still hits the 44px tap target via the parent's grid.
 */

const buttonVariants = cva(
  [
    // Base layout
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md text-sm font-medium leading-none",
    "select-none",
    // Animation — explicit properties only.
    "transition-[background-color,box-shadow,transform,color,border-color]",
    "duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
    // Press feedback — 80ms snap on every click. Springs back via the
    // 140ms base transition. No press on disabled.
    "active:scale-[0.97] active:duration-[80ms]",
    // Premium focus ring — visible only via keyboard.
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // Disabled
    "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
    // Icons inside buttons get a consistent size + don't capture clicks.
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground",
          // Inset light highlight + soft drop — reads as raised.
          "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)]",
          "hover:bg-primary/90 hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.22)]",
        ].join(" "),
        destructive: [
          "bg-destructive text-white",
          "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.12),0_1px_2px_-1px_oklch(0_0_0_/_0.20)]",
          "hover:bg-destructive/90",
          "focus-visible:ring-destructive/40",
        ].join(" "),
        outline: [
          "border border-input bg-background",
          "shadow-[0_1px_2px_-1px_oklch(0_0_0_/_0.06)]",
          "hover:bg-accent hover:text-accent-foreground hover:border-foreground/20",
          "hover:shadow-[0_2px_8px_-3px_oklch(0_0_0_/_0.10)]",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground",
          "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]",
          "hover:bg-secondary/80",
        ].join(" "),
        ghost:
          "hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.08]",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
