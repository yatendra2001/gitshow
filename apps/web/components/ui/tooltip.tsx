"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Premium tooltip — softer easing (ease-out-cubic), 200ms in / 120ms
 * out. The slide-from-side is reduced from 8px to 4px so the
 * tooltip "settles" near the trigger instead of swooping in.
 *
 * Default sideOffset is 6px (was 4) — gives the arrow breathing
 * room and reads more deliberate.
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground",
      "shadow-lg ring-1 ring-foreground/[0.04]",
      "animate-in fade-in-0 zoom-in-[0.96]",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.96]",
      "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1",
      "data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
      "data-[state=open]:duration-200 data-[state=closed]:duration-[120ms]",
      "data-[state=open]:ease-[cubic-bezier(0.215,0.61,0.355,1)]",
      "data-[state=closed]:ease-[cubic-bezier(0.215,0.61,0.355,1)]",
      "origin-[--radix-tooltip-content-transform-origin]",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const TooltipArrow = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Arrow>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>
>(({ className, ...props }, ref) => (
  <TooltipPrimitive.Arrow
    ref={ref}
    className={cn("fill-primary", className)}
    {...props}
  />
));
TooltipArrow.displayName = TooltipPrimitive.Arrow.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TooltipArrow };
