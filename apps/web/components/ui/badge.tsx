import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold tabular-nums",
    // Specific properties only — never `transition-colors` alone if
    // the badge is inside an interactive context (the parent should
    // handle hover via group classes).
    "transition-[background-color,border-color,color] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10)] hover:bg-destructive/80",
        outline:
          "border-border/60 text-foreground hover:border-foreground/30 hover:bg-foreground/[0.04]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
