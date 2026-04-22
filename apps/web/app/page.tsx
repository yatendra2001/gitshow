import { LazyDither } from "@/components/marketing/animations/lazy-dither";
import { ConnectSection } from "@/components/marketing/section/connection-section";
import { CTASection } from "@/components/marketing/section/cta-section";
import { DemoSection } from "@/components/marketing/section/demo-section";
import { FAQSection } from "@/components/marketing/section/faq-section";
import { FeatureSection } from "@/components/marketing/section/feature-section";
import { Footer } from "@/components/marketing/section/footer";
import { HeroSection } from "@/components/marketing/section/hero-section";
import { Navbar } from "@/components/marketing/section/navbar";
import { PricingSection } from "@/components/marketing/section/pricing-section";
import { TestimonialSection } from "@/components/marketing/section/testimonial-section";
import { WorkflowConnectSection } from "@/components/marketing/section/workflow-connect-section";
import { WorkflowSection } from "@/components/marketing/section/workflow-section";

/**
 * Marketing landing. Auth detection happens client-side in
 * `<AuthCta/>` (which reads Better Auth's session from the browser
 * cookie) — the server component stays static and uncacheable-free.
 *
 * Earlier we tried calling `getSession()` here, but the Cloudflare
 * context init inside that call stalled for 30+ seconds on cold dev
 * boots, gating the whole page behind an unreliable async. Client-
 * side session is simpler and never blocks SSR.
 */

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto border-x border-border">
      <Navbar />
      <main className="flex flex-col divide-y divide-border pt-16">
        <HeroSection />
        <DemoSection />
        <WorkflowSection />
        <WorkflowConnectSection />
        <FeatureSection />
        <ConnectSection />
        <TestimonialSection />
        <PricingSection />
        <FAQSection />
        <CTASection />
        <Footer />
        <LazyDither />
      </main>
    </div>
  );
}
