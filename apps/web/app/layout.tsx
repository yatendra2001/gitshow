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
  title: "GitShow — portfolios from your git history",
  description:
    "GitShow turns a developer's public git history into a polished, editable portfolio.",
  openGraph: {
    title: "GitShow",
    description: "Portfolios from your git history.",
    type: "website",
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
