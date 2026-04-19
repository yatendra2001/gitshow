/**
 * Demo profile — the "UI exists" milestone.
 *
 * Reads the bundled yatendra2001 14-card.json directly (no R2, no D1) so
 * the page is instant and editable without running a $12 scan. The real
 * /s/[scanId] page will swap the data source for R2 + D1 without
 * touching the rendering layer.
 */
import { getDemoCard } from "@/lib/cards";
import { ProfileCardView } from "@/components/scan/profile-card";

export default function DemoScanPage() {
  const card = getDemoCard();
  return <ProfileCardView card={card} chrome={true} />;
}

export const metadata = {
  title: "Demo profile · gitshow",
  description:
    "A live-rendered GitShow profile generated from real git history. This is what GitShow writes when you hand it your GitHub handle.",
};
