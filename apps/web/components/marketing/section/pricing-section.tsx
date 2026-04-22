import { Check } from "lucide-react";

import { siteConfig } from "@/lib/marketing-config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/marketing/ui/button";
import { LazyDither } from "@/components/marketing/animations/lazy-dither";

/**
 * One plan (Pro), two billing cadences. Show both cards side by side
 * so monthly anchors the annual price — the usual SaaS tactic. No
 * free tier (prospects see `/demo` instead), no enterprise stub.
 */

export function PricingSection() {
    const { pricing } = siteConfig;
    const { features, pricingItems } = pricing;

    return (
        <section id="pricing" className="relative w-full border-b">
            <div className="mx-auto">
                <div className="grid divide-x divide-border md:grid-cols-6">
                    <div className="col-span-2 flex flex-col gap-4 p-8 md:p-14">
                        <div className="space-y-4">
                            <h3 className="text-3xl font-medium tracking-tighter md:text-4xl">
                                {pricing.title}
                            </h3>
                            <p className="text-balance text-muted-foreground">
                                {pricing.description}
                            </p>
                        </div>

                        <ul className="flex flex-col gap-2 pt-4">
                            {features.map((feature) => (
                                <li
                                    key={feature}
                                    className="flex items-start gap-2"
                                >
                                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                                    <span className="text-sm text-secondary-foreground">
                                        {feature}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="col-span-4 flex flex-col">
                        <div className="relative h-14 border-b overflow-hidden">
                            <div className="absolute inset-0">
                                <LazyDither enableMouseInteraction={false} />
                            </div>
                        </div>

                        {/* flex-1 so the cards fill any extra height created
                            when the features list on the left is taller than
                            the cards on the right. Without this, the leftover
                            vertical space renders as a big empty band here. */}
                        <div className="grid flex-1 grid-cols-1 items-stretch md:grid-cols-2 divide-y divide-border md:divide-y-0 md:divide-x">
                            {pricingItems.map((plan) => (
                                <PricingCard
                                    key={plan.cadence}
                                    name={plan.name}
                                    cadence={plan.cadence}
                                    price={plan.price}
                                    period={plan.period}
                                    note={plan.note}
                                    buttonText={plan.buttonText}
                                    href={plan.href}
                                    isPopular={plan.isPopular}
                                />
                            ))}
                        </div>

                        <div className="relative h-14 border-t overflow-hidden">
                            <div className="absolute inset-0">
                                <LazyDither enableMouseInteraction={false} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function PricingCard({
    name,
    cadence,
    price,
    period,
    note,
    buttonText,
    href,
    isPopular,
}: {
    name: string;
    cadence: string;
    price: string;
    period: string;
    note: string;
    buttonText: string;
    href: string;
    isPopular: boolean;
}) {
    return (
        <div
            className={cn(
                "flex h-full flex-col p-8 md:p-10",
                isPopular && "bg-accent/60",
            )}
        >
            <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                    <h4 className="text-xl font-medium">{name}</h4>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                        {cadence}
                    </span>
                </div>
                {isPopular && (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                        Popular
                    </span>
                )}
            </div>

            <div className="mt-8 flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-semibold tracking-tight md:text-5xl">
                        {price}
                    </span>
                    <span className="text-muted-foreground">/{period}</span>
                </div>
                <p className="text-sm text-muted-foreground">{note}</p>
            </div>

            <Button
                size="lg"
                asChild
                className={cn(
                    "mt-auto w-full cursor-pointer rounded-full transition-all duration-300 ease-in-out",
                    isPopular
                        ? "bg-foreground text-background hover:bg-foreground/90 hover:scale-[1.02]"
                        : "bg-muted text-foreground hover:bg-muted/80",
                )}
            >
                <a href={href}>{buttonText}</a>
            </Button>
        </div>
    );
}
