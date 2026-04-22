import { siteConfig } from "@/lib/marketing-config";
import { AuthCta } from "@/components/marketing/auth-cta";

export function CTASection() {
    const { ctaSection } = siteConfig;

    return (
        <section
            id={ctaSection.id}
            className="relative flex flex-col items-center justify-center px-4 py-20 md:py-32 overflow-hidden"
        >
            <div className="absolute inset-0 -z-1 h-full w-full bg-radial-[at_45%_85%] from-[#2CD5FF]/40 via-[#2C30FF]/4 mask-[linear-gradient(to_bottom,transparent,black_100%)]" />
            <div className="absolute inset-0 -z-1 h-full w-full bg-radial-[at_45%_68%] from-[#2CD5FF]/68 via-[#2C30FF]/3 mask-[linear-gradient(to_bottom,transparent,black_100%)] blur-[50px]" />

            <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-6 max-w-4xl mx-auto">
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-medium tracking-tighter text-balance">
                    {ctaSection.title}
                </h2>
                <p className="text-muted-foreground text-center text-balance font-medium max-w-2xl mx-auto">
                    {ctaSection.subtext}
                </p>
                <div className="pt-2">
                    <AuthCta variant="pill" />
                </div>
            </div>
        </section>
    );
}
