import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Root layout — verbatim parity with the reference portfolio template's
 * `layout.tsx`, but stripped of template-specific metadata. Typography and
 * theme tokens cascade from here into every route (dashboard, signin,
 * `/{handle}`). Portfolio-specific chrome (FlickeringGrid header, Navbar)
 * lives in `app/[handle]/layout.tsx` so it doesn't bleed into the app
 * chrome routes.
 */

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://gitshow.io",
  ),
  title: "GitShow — stop applying. get hired.",
  description:
    "The job-search system for developers who'd rather ship than spam recruiters. Portfolio, custom domain, analytics, build-in-public engine, tailored resumes — one opinionated stack.",
  openGraph: {
    title: "GitShow — stop applying. get hired.",
    description:
      "The opinionated job-search stack for developers. Build → Show → Close.",
    url: "/",
    siteName: "GitShow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitShow — stop applying. get hired.",
    description:
      "The opinionated job-search stack for developers. Build → Show → Close.",
  },
  icons: {
    // Browsers pick by media query: light-mode tabs get icon-light,
    // dark-mode tabs get icon-dark. The unsuffixed `icon` is the
    // fallback for clients that ignore media (older Safari, etc.) —
    // icon-dark renders fine on both backgrounds.
    icon: [
      { url: "/icon-dark.png", type: "image/png" },
      {
        url: "/icon-light.png",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark.png",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/icon-dark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased relative overflow-x-hidden",
          geist.variable,
          geistMono.variable,
        )}
        /**
         * Browser extensions (Grammarly, ad-blockers, password managers) inject
         * attributes like `bis_register` and `__processed_*` into <body> before
         * React hydrates. Those mutations don't come from our code, so we tell
         * React to stop shouting about the diff.
         */
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="dark">
          <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
