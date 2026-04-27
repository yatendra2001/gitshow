"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal Dialog wrapper over Radix. Matches the GitShow visual system:
 * thin border, card background, rounded-2xl, muted overlay. Use
 * `AlertDialog`-style confirm flows via children; there's no need for a
 * separate primitive — every gitshow modal so far is single-purpose.
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

/**
 * Overlay + Content share easing and duration (paired-elements
 * rule, see DESIGN.md §1). Both fade with ease-out-cubic; content
 * also scales 0.96 → 1. The 200ms in / 150ms out timing matches
 * the dialog's "weight" — slower entry feels deliberate, faster
 * exit feels responsive.
 */
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      "data-[state=open]:duration-200 data-[state=closed]:duration-150",
      "data-[state=open]:ease-[cubic-bezier(0.215,0.61,0.355,1)]",
      "data-[state=closed]:ease-[cubic-bezier(0.215,0.61,0.355,1)]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showClose?: boolean;
  }
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
        "rounded-2xl border border-border/40 bg-card shadow-2xl p-6 flex flex-col gap-4",
        // Premium ring glow — a 1px inset highlight + matching outer
        // 1px ring. Reads as a hairline frame on either theme without
        // looking like a heavy border.
        "ring-1 ring-foreground/[0.04]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        // Scale from 0.96 (not 0) so it doesn't feel like it pops out
        // of nothing — Emil §practical-tips.
        "data-[state=open]:zoom-in-[0.96] data-[state=closed]:zoom-out-[0.96]",
        // Slight slide-down on open to match the focal point.
        "data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2",
        "data-[state=open]:duration-200 data-[state=closed]:duration-150",
        "data-[state=open]:ease-[cubic-bezier(0.215,0.61,0.355,1)]",
        "data-[state=closed]:ease-[cubic-bezier(0.215,0.61,0.355,1)]",
        className,
      )}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4 inline-flex size-7 items-center justify-center rounded-md",
            "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.06]",
            "transition-[background-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            "active:scale-90 active:duration-[80ms]",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          )}
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-2 pt-2", className)}
      {...props}
    />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-[16px] font-semibold leading-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[13px] text-muted-foreground leading-relaxed", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
