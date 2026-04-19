"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";

/**
 * Conversation — auto-scrolling, bottom-pinned chat container.
 * Minimal port of the AI Elements primitive. Watches its own scroll
 * position and surfaces a "scroll to bottom" button when the user
 * drifts up. No deps beyond React.
 */

interface ConversationContextValue {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: (smooth?: boolean) => void;
}

const ConversationContext = React.createContext<ConversationContextValue | null>(
  null,
);

function useConversationContext() {
  const ctx = React.useContext(ConversationContext);
  if (!ctx)
    throw new Error("Conversation subcomponents must be inside <Conversation>");
  return ctx;
}

export function Conversation({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const scrollToBottom = React.useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  // Autoscroll to bottom whenever content grows, as long as the user
  // hasn't scrolled away.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (isAtBottom) scrollToBottom(false);
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [isAtBottom, scrollToBottom]);

  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAtBottom(atBottom);
  }, []);

  return (
    <ConversationContext.Provider
      value={{ containerRef, isAtBottom, scrollToBottom }}
    >
      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden",
          className,
        )}
        {...props}
      >
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="gs-chat-scroll flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-2 py-4", className)}
      {...props}
    />
  );
}

export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useConversationContext();
  if (isAtBottom) return null;
  return (
    <button
      type="button"
      onClick={() => scrollToBottom(true)}
      className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background shadow-md transition hover:opacity-90"
      aria-label="Scroll to latest"
    >
      <ArrowDown className="size-4" />
    </button>
  );
}

export function ConversationEmptyState({
  title,
  description,
  action,
  className,
  ...props
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 px-6 text-center",
        className,
      )}
      {...props}
    >
      <h2 className="font-serif text-xl leading-tight">{title}</h2>
      {description && (
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
