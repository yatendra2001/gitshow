import { Plus_Jakarta_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";

/**
 * Typography locked to the target profile-card design:
 *   - Plus Jakarta Sans — UI chrome, body
 *   - Instrument Serif — hero hook, big KPI numbers
 *   - JetBrains Mono — code, captions, receipts
 */
export const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});
