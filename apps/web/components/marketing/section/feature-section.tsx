"use client";

import {
    SiGithub,
    SiTypescript,
    SiPython,
    SiRust,
    SiGo,
    SiReact,
    SiPostgresql,
    SiDocker,
} from "@icons-pack/react-simple-icons";
import { Button } from "@/components/marketing/ui/button";
import { siteConfig } from "@/lib/marketing-config";
import { SectionHeader } from "../section-header";
import { Icons } from "../icons";
import { HeaderBadge } from "../header-badge";
import { LazyDither } from "@/components/marketing/animations/lazy-dither";
import { CornerPlus } from "@/components/marketing/ui/corner-plus";
import { OrbitingIconsBurst } from "@/components/marketing/animations/orbiting-icons-burst";
import { DottedMap } from "@/components/marketing/ui/dotted-map";

const featureConfig = siteConfig.featureSection;

/**
 * "Written from your work" — credibility section.
 *
 * Right column uses two abstract product-agnostic visualizations
 * (mirrors the codeforge template approach):
 *
 *   1. OrbitingIconsBurst — real tech logos orbiting GitHub. Reads as
 *      "we ingest your whole stack" without inventing fake product UI.
 *   2. DottedMap — geographic-spread world map for the
 *      "found by recruiters" / SEO indexed angle.
 *
 * No gradients on the surfaces (the user pushed back on those). The
 * radial background under the orbit comes from a soft mask, not a
 * gradient overlay.
 */

const ORBIT_ITEMS = [
    {
        id: 1,
        delay: 0,
        rayIndex: 10,
        distance: 152,
        className: "",
        icon: <SiTypescript className="size-full text-[#3178C6]" />,
    },
    {
        id: 2,
        delay: 0.08,
        rayIndex: 14,
        distance: 138,
        className: "",
        icon: <SiPython className="size-full text-[#3776AB]" />,
    },
    {
        id: 3,
        delay: 0.16,
        rayIndex: 19,
        distance: 178,
        className: "",
        icon: <SiRust className="size-full text-foreground" />,
    },
    {
        id: 4,
        delay: 0.24,
        rayIndex: 22,
        distance: 144,
        className: "",
        icon: <SiGo className="size-full text-[#00ADD8]" />,
    },
    {
        id: 5,
        delay: 0.48,
        rayIndex: 4,
        distance: 156,
        className: "",
        icon: <SiReact className="size-full text-[#61DAFB]" />,
    },
    {
        id: 6,
        delay: 0.56,
        rayIndex: 7,
        distance: 170,
        className: "",
        icon: <SiPostgresql className="size-full text-[#4169E1]" />,
    },
    {
        id: 7,
        delay: 0.32,
        rayIndex: 1,
        distance: 162,
        className: "",
        icon: <SiDocker className="size-full text-[#2496ED]" />,
    },
];

const RECRUITER_MARKERS = [
    { lat: 40.7128, lng: -74.006, size: 0.4 }, // New York
    { lat: 37.7749, lng: -122.4194, size: 0.4 }, // San Francisco
    { lat: 47.6062, lng: -122.3321, size: 0.4 }, // Seattle
    { lat: 51.5074, lng: -0.1278, size: 0.4 }, // London
    { lat: 52.52, lng: 13.405, size: 0.4 }, // Berlin
    { lat: 48.8566, lng: 2.3522, size: 0.4 }, // Paris
    { lat: 1.3521, lng: 103.8198, size: 0.4 }, // Singapore
    { lat: 35.6762, lng: 139.6503, size: 0.4 }, // Tokyo
    { lat: 28.6139, lng: 77.209, size: 0.4 }, // Delhi
    { lat: 12.9716, lng: 77.5946, size: 0.4 }, // Bangalore
    { lat: -33.8688, lng: 151.2093, size: 0.4 }, // Sydney
    { lat: 19.076, lng: 72.8777, size: 0.4 }, // Mumbai
    { lat: 43.6532, lng: -79.3832, size: 0.4 }, // Toronto
    { lat: 55.7558, lng: 37.6176, size: 0.3 }, // Moscow
    { lat: -23.5505, lng: -46.6333, size: 0.3 }, // São Paulo
];

export function FeatureSection() {
    const blocks = featureConfig.sections.blocks;

    return (
        <section id="features" className="w-full relative">
            <SectionHeader>
                <div className="flex flex-col items-center justify-center">
                    <HeaderBadge icon={featureConfig.badge.icon} text={featureConfig.badge.text} />
                    <div className="flex flex-col items-center justify-center gap-4 mt-4">
                        <h2 className="text-3xl md:text-4xl lg:text-6xl font-medium tracking-tighter text-center text-balance">
                            {featureConfig.title}
                        </h2>
                        <p className="text-muted-foreground md:text-lg text-center text-balance mx-auto">
                            {featureConfig.description}
                        </p>
                    </div>
                </div>
            </SectionHeader>
            <div className="relative h-14 overflow-hidden">
                <div className="absolute inset-0">
                    <LazyDither enableMouseInteraction={true} />
                </div>
            </div>
            <div className="mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-6">
                    <div className="col-span-1 md:col-span-2 p-8 md:p-10 lg:p-14 md:sticky md:top-20 md:self-start flex flex-col gap-7">
                        <h3 className="text-3xl lg:text-4xl font-medium tracking-tighter text-left text-balance">
                            {featureConfig.sections.title}
                        </h3>
                        <p className="text-muted-foreground text-left text-balance">
                            {featureConfig.sections.description}
                        </p>
                        <Button asChild variant="secondary" className="w-fit border border-border">
                            <a href={featureConfig.sections.ctaButton.href}>
                                {featureConfig.sections.ctaButton.text}
                                <Icons.arrowRight className="size-4 text-foreground" />
                            </a>
                        </Button>
                    </div>

                    <div className="col-span-1 md:col-span-4 w-full border-t md:border-t-0 md:border-l border-border relative">
                        <CornerPlus position="all" className="text-muted-foreground/50" />
                        <div className="w-full divide-y divide-border">
                            <div className="relative">
                                <OrbitingIconsBurst
                                    items={ORBIT_ITEMS}
                                    lineCount={22}
                                    centerIcon={<SiGithub className="size-full text-foreground" />}
                                    className="relative min-h-[300px] md:min-h-[400px] mask-[radial-gradient(ellipse_at_center,black_40%,black_60%,transparent_85%)]"
                                />
                                <div className="max-w-xl text-left items-start p-6">
                                    <p className="text-sm text-muted-foreground flex items-center gap-3 justify-start">
                                        {blocks[0].icon}
                                        {blocks[0].title}
                                    </p>
                                    <p className="text-base text-foreground leading-relaxed mt-2">
                                        {blocks[0].description}
                                    </p>
                                </div>
                            </div>

                            <div className="relative">
                                <CornerPlus position="top-left" className="text-muted-foreground/50" />
                                <CornerPlus position="top-right" className="text-muted-foreground/50" />
                                <div className="relative min-h-[300px] md:min-h-[400px] overflow-hidden mask-[radial-gradient(ellipse_at_center,black_40%,black_60%,transparent_85%)]">
                                    <DottedMap
                                        markers={RECRUITER_MARKERS}
                                        markerColor="var(--primary)"
                                    />
                                </div>
                                <div className="max-w-xl text-left items-start p-6">
                                    <p className="text-sm text-muted-foreground flex items-center gap-3 justify-start">
                                        {blocks[1].icon}
                                        {blocks[1].title}
                                    </p>
                                    <p className="text-base text-foreground leading-relaxed mt-2">
                                        {blocks[1].description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
