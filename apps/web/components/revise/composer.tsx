"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * ReviseComposer — the M4 chat composer.
 *
 * Principles from the brainstorm:
 *   - Kill the @mention system. Free-form text only. The backend
 *     classifier figures out which beat to target.
 *   - First-class image attachments (screenshots). Paperclip → R2.
 *   - Mobile-first: full-width on narrow screens, ≥44px tap targets.
 *   - Matches chatbot's composer rhythm: rounded-2xl, border-border/30,
 *     bg-card/70, composer-focus shadow.
 *   - Suggested chips come from the parent (critic's top_fixes).
 */

export interface Attachment {
  id: string;
  file: File;
  preview: string; // object URL
  r2_key?: string;
  uploading: boolean;
  error?: string;
}

interface ReviseComposerProps {
  scanId: string;
  placeholder?: string;
  suggestions?: Array<{ label: string; value: string }>;
  disabled?: boolean;
  onSubmit: (input: {
    guidance: string;
    image_r2_keys: string[];
    claimId?: string;
  }) => Promise<void>;
  claimId?: string;
  className?: string;
}

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — Sonnet's per-image limit

export function ReviseComposer({
  scanId,
  placeholder = "What should I change?",
  suggestions = [],
  disabled,
  onSubmit,
  claimId,
  className,
}: ReviseComposerProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (arr.length === 0) return;
      const remainingSlots = MAX_IMAGES - attachments.length;
      const toAdd = arr.slice(0, remainingSlots);

      const staged: Attachment[] = toAdd.map((file) => ({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: URL.createObjectURL(file),
        uploading: true,
      }));
      setAttachments((prev) => [...prev, ...staged]);

      for (const a of staged) {
        try {
          if (a.file.size > MAX_IMAGE_BYTES) {
            setAttachments((prev) =>
              prev.map((x) =>
                x.id === a.id
                  ? { ...x, uploading: false, error: "too large (5MB max)" }
                  : x,
              ),
            );
            continue;
          }
          const form = new FormData();
          form.append("file", a.file);
          form.append("scanId", scanId);
          const resp = await fetch("/api/revise/upload", {
            method: "POST",
            body: form,
          });
          if (!resp.ok) {
            setAttachments((prev) =>
              prev.map((x) =>
                x.id === a.id
                  ? { ...x, uploading: false, error: "upload failed" }
                  : x,
              ),
            );
            continue;
          }
          const data = (await resp.json()) as { r2_key: string };
          setAttachments((prev) =>
            prev.map((x) =>
              x.id === a.id
                ? { ...x, uploading: false, r2_key: data.r2_key }
                : x,
            ),
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((x) =>
              x.id === a.id
                ? {
                    ...x,
                    uploading: false,
                    error: err instanceof Error ? err.message : "failed",
                  }
                : x,
            ),
          );
        }
      }
    },
    [attachments.length, scanId],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const gone = prev.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const submit = useCallback(async () => {
    const guidance = value.trim();
    if (!guidance && attachments.length === 0) return;
    if (attachments.some((a) => a.uploading)) return;
    setSending(true);
    setError(null);
    try {
      const imageKeys = attachments
        .map((a) => a.r2_key)
        .filter((k): k is string => Boolean(k));
      await onSubmit({
        guidance,
        image_r2_keys: imageKeys,
        ...(claimId ? { claimId } : {}),
      });
      // Reset on success.
      setValue("");
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setSending(false);
    }
  }, [value, attachments, onSubmit, claimId]);

  const pickSuggestion = useCallback(
    (s: { label: string; value: string }) => {
      setValue((prev) => (prev.trim() ? `${prev.trim()}\n${s.value}` : s.value));
      textareaRef.current?.focus();
    },
    [],
  );

  const sendDisabled =
    sending ||
    disabled ||
    (!value.trim() && attachments.length === 0) ||
    attachments.some((a) => a.uploading || a.error);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              onRemove={() => removeAttachment(a.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border/30 bg-card/70 shadow-[var(--shadow-composer)] transition-shadow duration-200 focus-within:shadow-[var(--shadow-composer-focus)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const images: File[] = [];
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              if (it && it.kind === "file" && it.type.startsWith("image/")) {
                const f = it.getAsFile();
                if (f) images.push(f);
              }
            }
            if (images.length > 0) {
              e.preventDefault();
              void addFiles(images);
            }
          }}
          onDrop={(e) => {
            if (e.dataTransfer?.files?.length) {
              e.preventDefault();
              void addFiles(e.dataTransfer.files);
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
          }}
          placeholder={placeholder}
          disabled={disabled || sending}
          rows={3}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none disabled:opacity-50"
        />
        <footer className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach image"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || sending || attachments.length >= MAX_IMAGES}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PaperclipIcon />
            </button>
            <span className="hidden sm:inline text-[11px] text-muted-foreground/70">
              {attachments.length > 0
                ? `${attachments.length}/${MAX_IMAGES}`
                : "Cmd + Enter to send"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {error ? (
              <span className="text-[11px] text-[var(--destructive)]">
                {error}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sendDisabled}
              aria-label="Send"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-opacity duration-200",
                sendDisabled
                  ? "bg-muted text-muted-foreground/30 cursor-not-allowed"
                  : "bg-foreground text-background hover:opacity-85 active:scale-95",
              )}
            >
              {sending ? <DotsIcon /> : <ArrowUpIcon />}
            </button>
          </div>
        </footer>
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => pickSuggestion(s)}
              disabled={disabled || sending}
              className="rounded-xl border border-border/50 bg-card/30 px-3 py-1.5 text-[12px] text-muted-foreground transition-[color,background-color] duration-200 hover:text-foreground hover:bg-card/60 disabled:opacity-50 min-h-9"
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  return (
    <div className="relative rounded-lg border border-border/40 bg-card/60 p-1.5 pr-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.preview}
        alt=""
        className="h-12 w-12 rounded object-cover"
      />
      {attachment.uploading ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70">
          <span className="gs-shimmer text-[10px]">…</span>
        </div>
      ) : null}
      {attachment.error ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-[var(--destructive)]/15 text-[9px] text-[var(--destructive)] text-center px-1">
          {attachment.error}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-foreground"
      >
        <XIcon />
      </button>
    </div>
  );
}

// ─── icons ─────────────────────────────────────────────────────────

function PaperclipIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
    >
      <circle cx="5" cy="12" r="1.5">
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="1s"
          begin="0s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="12" cy="12" r="1.5">
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="1s"
          begin="0.2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="19" cy="12" r="1.5">
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="1s"
          begin="0.4s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
