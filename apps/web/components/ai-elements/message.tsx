"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Message — one turn in the conversation. Minimal port of the AI
 * Elements primitive: `from` picks the variant (user right-aligned,
 * assistant left-aligned). Children are free-form; long text should
 * pass through `MessageResponse` for streamed markdown.
 */

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: "user" | "assistant";
}

export function Message({
  from,
  className,
  children,
  ...props
}: MessageProps) {
  const isUser = from === "user";
  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-2.5",
        isUser ? "flex-row-reverse" : "flex-row",
        className,
      )}
      data-from={from}
      {...props}
    >
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold",
          isUser
            ? "bg-foreground text-background"
            : "bg-gradient-to-br from-blue-500 to-violet-500 text-white",
        )}
      >
        {isUser ? "you" : "gs"}
      </div>
      <div
        className={cn(
          "max-w-[85%] overflow-hidden",
          isUser ? "text-right" : "text-left",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function MessageContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-block rounded-lg bg-card px-3 py-2 text-sm leading-relaxed text-foreground border border-border shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

/**
 * MessageResponse — streamed assistant response. For MVP we render
 * plain text with preserved whitespace. When we wire up the AI SDK
 * `useChat`, this will switch to `streamdown` for live markdown.
 */
export function MessageResponse({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "whitespace-pre-wrap text-sm leading-relaxed text-foreground",
        className,
      )}
      {...props}
    />
  );
}
