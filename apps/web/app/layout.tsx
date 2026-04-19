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
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          sans.variable,
          serif.variable,
          mono.variable,
          "font-sans bg-background text-foreground min-h-screen antialiased",
        )}
      >
        {children}
      </body>
    </html>
  );
}
