"use client";

import { initialsFor, avatarBgFor } from "@/lib/initials-avatar";

/**
 * Gmail-style initials square/circle. Render-time fallback for any
 * entity that has no uploaded/fetched image. Zero network, always
 * renders.
 */
export function InitialsAvatar({
  name,
  size = 40,
  rounded = "md",
}: {
  name: string;
  size?: number;
  rounded?: "md" | "full";
}) {
  const radius = rounded === "full" ? "rounded-full" : "rounded-md";
  return (
    <div
      className={`flex items-center justify-center text-white font-medium ${radius}`}
      style={{
        backgroundColor: avatarBgFor(name),
        width: size,
        height: size,
        fontSize: size * 0.4,
      }}
      aria-label={name}
    >
      {initialsFor(name)}
    </div>
  );
}
