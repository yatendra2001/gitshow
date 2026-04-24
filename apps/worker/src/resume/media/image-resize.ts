/**
 * Thin sharp wrapper used by the media pipeline to normalize every
 * downloaded or generated image to a consistent WebP output.
 *
 * Design notes:
 *   - Dynamic import keeps typecheck green on dev machines where sharp
 *     isn't installed (e.g. the Cloudflare Worker surface). In Fly's
 *     Linux runtime the binary is present.
 *   - Returns null on any failure instead of throwing. Media fetch is
 *     best-effort; if one project's hero fails we want the pipeline to
 *     keep going, not blow up.
 *   - Quality 80 WebP is the sweet spot for portfolio heros — near
 *     lossless to the eye at ~1/3 the bytes of source PNG/JPEG.
 */
// The sharp fluent API has a minimal shape here so we don't need
// @types/sharp (absent until the package is installed). Expand as
// needed — we only touch resize + webp + toBuffer.
interface SharpInstance {
  resize(opts: {
    width: number;
    height: number;
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
    withoutEnlargement?: boolean;
  }): SharpInstance;
  webp(opts: { quality?: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

type SharpFactory = (input: Uint8Array | Buffer) => SharpInstance;

export async function resizeToWebP(
  input: ArrayBuffer | Uint8Array,
  opts: { width: number; height: number; fit?: "cover" | "contain" },
): Promise<{ buffer: Uint8Array; width: number; height: number } | null> {
  let sharp: SharpFactory;
  try {
    // Dynamic import — if sharp isn't installed or refuses to load
    // (native binding mismatch) we quietly bail to null.
    const mod = (await import("sharp")) as unknown as {
      default?: SharpFactory;
    } & SharpFactory;
    const candidate = mod.default ?? (mod as unknown as SharpFactory);
    if (typeof candidate !== "function") return null;
    sharp = candidate;
  } catch {
    return null;
  }

  try {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    const out = await sharp(buf)
      .resize({
        width: opts.width,
        height: opts.height,
        fit: opts.fit ?? "cover",
        withoutEnlargement: false,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      buffer: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
      width: opts.width,
      height: opts.height,
    };
  } catch {
    return null;
  }
}
