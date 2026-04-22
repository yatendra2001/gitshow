import { ResumeSchema } from "@gitshow/shared/resume";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import Navbar from "@/components/navbar";
import { DataProvider } from "@/components/data-provider";
import { ShareButton } from "@/components/share-button";
import { publishedJson } from "@/lib/constants";

/**
 * `/demo` is a fully-rendered sample portfolio. No R2 hit, no auth, no
 * session — it reads a static Resume JSON out of
 * `lib/constants.ts` and pipes it through the same `<DataProvider>`
 * that powers `/{handle}`. Exists so prospects can see what a GitShow
 * portfolio looks like without first signing up.
 *
 * We parse the JSON through `ResumeSchema` at module load (inside the
 * component, but the const is memoised per request) so any future
 * schema drift is caught here instead of rendering garbage.
 */

const DEMO_HANDLE = "yatendra2001";

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const parsed = ResumeSchema.safeParse(publishedJson);
  if (!parsed.success) {
    // Surface the validation failure loudly in dev — silent-fallback
    // here would hide real breakage.
    throw new Error(
      `Demo resume JSON failed schema validation: ${parsed.error.message}`,
    );
  }
  const resume = parsed.data;

  return (
    <DataProvider resume={resume} handle={DEMO_HANDLE}>
      <ShareButton handle={DEMO_HANDLE} name={resume.person.name} />
      <div className="absolute inset-0 top-0 left-0 right-0 h-[100px] overflow-hidden z-0">
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
      <div className="relative z-10 max-w-2xl mx-auto py-12 pb-24 sm:py-24 px-6">
        {children}
      </div>
      <Navbar />
    </DataProvider>
  );
}
