"use client";

import Link from "next/link";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import { useData } from "@/components/data-provider";

/**
 * Pick the best DM channel available on the resume. Twitter is the
 * canonical pitch ("shoot me a dm on twitter") because that's what
 * the original template assumed; we fall back gracefully when it
 * isn't there. Without a fallback, a missing socials.X used to
 * crash SSR with "TypeError: Cannot read properties of undefined
 * (reading 'url')", which is what ate /app/preview when the worker
 * hadn't yet round-tripped intake socials into the projection.
 */
function pickContactLink(
  social: ReturnType<typeof useData>["contact"]["social"],
): { label: string; url: string } | null {
  if (social.X?.url) return { label: "twitter", url: social.X.url };
  if (social.LinkedIn?.url)
    return { label: "linkedin", url: social.LinkedIn.url };
  if (social.email?.url) return { label: "email", url: social.email.url };
  if (social.GitHub?.url) return { label: "github", url: social.GitHub.url };
  return null;
}

export default function ContactSection() {
  const DATA = useData();
  const link = pickContactLink(DATA.contact.social);
  return (
    <div className="border rounded-xl p-10 relative">
      <div className="absolute -top-4 border bg-primary z-10 rounded-xl px-4 py-1 left-1/2 -translate-x-1/2">
        <span className="text-background text-sm font-medium">Contact</span>
      </div>
      <div className="absolute inset-0 top-0 left-0 right-0 h-1/2 rounded-xl overflow-hidden">
        <FlickeringGrid
          className="h-full w-full"
          squareSize={2}
          gridGap={2}
          style={{
            maskImage: "linear-gradient(to bottom, black, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
          }}
        />
      </div>
      <div className="relative flex flex-col items-center gap-4 text-center">
        <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">
          Get in Touch
        </h2>
        <p className="mx-auto max-w-lg text-muted-foreground text-balance">
          {link ? (
            <>
              Want to chat? Just shoot me a dm{" "}
              <Link
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                with a direct question on {link.label}
              </Link>{" "}
              and I&apos;ll respond whenever I can. I will ignore all
              soliciting.
            </>
          ) : (
            <>
              Want to chat? Find me on the links above and shoot me a dm.
              I&apos;ll respond whenever I can.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
