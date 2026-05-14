import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadDashboardContext } from "../_context";
import { listVoiceSamples, loadVoiceProfile } from "@/lib/bip-data";
import { VoiceEditor } from "./_voice-editor";

/**
 * /app/voice — voice calibration.
 *
 * Paste 2-6 things you've written (tweets, LinkedIn posts, blog
 * excerpts) and gitshow extracts a structured voice profile every
 * draft generator pulls from. The voice is the moat: generic-LLM
 * posts read like generic-LLM posts; this is the cheap, durable
 * fix.
 *
 * Pro-gated like every other build-in-public surface.
 */

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");
  if (!ctx.isPro) redirect("/pricing");

  const { env } = await getCloudflareContext({ async: true });
  const [samples, profile] = await Promise.all([
    listVoiceSamples(env.DB, ctx.userId),
    loadVoiceProfile(env.DB, ctx.userId),
  ]);

  const initialSamples = samples.map((s) => ({
    id: s.id,
    kind: s.kind,
    source_url: s.source_url,
    body: s.body,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-8">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Build in public · setup
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
          Your voice
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground max-w-xl">
          Paste 2 to 6 things you&apos;ve actually written — tweets, LinkedIn
          posts, blog paragraphs, even longer Slack messages. We extract a
          structured voice profile that every generated draft uses. This is the
          difference between &quot;sounds like an LLM&quot; and &quot;sounds like you.&quot;
        </p>
      </div>

      <VoiceEditor
        initialSamples={initialSamples}
        initialProfile={profile?.profile ?? null}
        initialGeneratedAt={profile?.generated_at ?? null}
      />
    </div>
  );
}
