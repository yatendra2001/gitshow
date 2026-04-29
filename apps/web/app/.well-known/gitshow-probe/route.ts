import { NextResponse } from "next/server";

/**
 * Custom-domain reachability probe.
 *
 * Used by `/api/domains/verify` (and the daily recheck cron) to confirm
 * a customer's DNS actually points at *our* worker, not at some stale
 * origin from a previous host.
 *
 * Why a probe at all: when a customer adds an apex CNAME on Cloudflare,
 * Cloudflare flattens it to A records. From outside, all you see are
 * A records — there's no easy way via DoH to tell whether those A's
 * resolve to OUR Cloudflare for SaaS edge or to someone else's server
 * (e.g. an old Heroku app that left A records behind). Hard-coding
 * Cloudflare's anycast ranges is brittle. The robust check: fetch the
 * hostname over HTTPS and look for a signature only our worker sends.
 *
 * Response shape: `{ ok: true, signature: "gitshow-probe-v1" }`. The
 * verifier matches both fields exactly. Anything else (404, timeout,
 * different body) → "DNS isn't pointing at us yet."
 *
 * Why `.well-known/`: this path is reserved for non-routing endpoints
 * (RFC 8615) and the middleware doesn't 404 it on custom hostnames.
 * The endpoint is fully read-only and identical for every caller, so
 * exposing it on every customer domain leaks nothing — just confirms
 * the request reached our edge.
 */

export const dynamic = "force-dynamic";

const SIGNATURE = "gitshow-probe-v1";

export async function GET() {
  return NextResponse.json(
    { ok: true, signature: SIGNATURE },
    {
      headers: {
        // No caching — we want every probe to make it to the worker
        // so we can tell when DNS goes live.
        "cache-control": "no-store, max-age=0",
        // Let JS reach this from the verify endpoint regardless of
        // origin (we call it from our own worker, but a third party
        // hitting it learns nothing).
        "access-control-allow-origin": "*",
      },
    },
  );
}
