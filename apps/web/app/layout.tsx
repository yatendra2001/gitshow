import type { Metadata } from "next";
import { sans, serif, mono } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitShow — portfolios from your git history",
  description:
    "GitShow reads your public git history and writes a hiring-manager-ready portfolio. Every claim links to a commit.",
  openGraph: {
    title: "GitShow",
    description: "Engineering portfolios, backed by every commit.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/*
          Pre-hydration theme script. Reads gs-theme from localStorage
          and sets the <html> class before paint, so a visitor who
          flipped to light on a previous visit doesn't see a dark →
          light flash on reload. Inline + string-literal on purpose;
          must not import anything. Safe no-op on SSR (never runs).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('gs-theme');if(t==='light'){document.documentElement.classList.remove('dark')}else if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body
        className={cn(
          sans.variable,
          serif.variable,
          mono.variable,
          "font-sans bg-background text-foreground min-h-screen antialiased selection:bg-blue-500/30",
        )}
      >
        {children}
      </body>
    </html>
  );
}
