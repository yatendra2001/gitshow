import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Feature } from "@/components/marketing/animations/feature-slide";
import { siteConfig } from "@/lib/marketing-config";
import { Button } from "@/components/marketing/ui/button";

export function DemoSection() {
    const { items } = siteConfig.demoSection;

    return (
        <section id="demo" className="w-full relative">
            <Feature
                collapseDelay={5000}
                linePosition="bottom"
                featureItems={items}
                lineColor="bg-sky-500"
            />
        </section>
    );
}
