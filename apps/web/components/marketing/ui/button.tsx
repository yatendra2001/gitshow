import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Marketing button. Visually a touch heavier than the dashboard
 * Button (this is the landing-page hero CTA territory) but follows
 * the same motion rules: explicit transition properties, 80ms press
 * scale, 140ms hover, premium focus ring.
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0",
    "rounded-md text-sm font-medium leading-none select-none",
    // Explicit, GPU-friendly transitions only.
    "transition-[background-color,box-shadow,transform,color,border-color,opacity]",
    "duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
    // Tactile press.
    "active:scale-[0.97] active:duration-[80ms]",
    // Premium focus ring (keyboard-only).
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground",
          "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)]",
          "hover:bg-primary/90 hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_2px_8px_-3px_oklch(0_0_0_/_0.22)]",
        ].join(" "),
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: [
          "border bg-background shadow-xs",
          "hover:bg-accent hover:text-accent-foreground hover:border-foreground/20",
          "dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        ].join(" "),
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/[0.06] active:bg-foreground/[0.08]",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
