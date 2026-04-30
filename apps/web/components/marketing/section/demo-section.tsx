import { Feature } from "@/components/marketing/animations/feature-slide";
import { siteConfig } from "@/lib/marketing-config";
import { SectionHeader } from "@/components/marketing/section-header";
import { HeaderBadge } from "@/components/marketing/header-badge";
import { Icons } from "@/components/marketing/icons";

export function DemoSection() {
    const { title, description, items } = siteConfig.demoSection;

    return (
        <section id="demo" className="w-full relative">
            {/* <SectionHeader>
                <div className="flex flex-col items-center justify-center">
                    <HeaderBadge
                        icon={<Icons.stackedIcons className="size-4 text-muted-foreground" />}
                        text="Interactive demo"
                    />
                    <div className="flex flex-col items-center justify-center gap-4 mt-4">
                        <h2 className="text-3xl md:text-4xl lg:text-6xl font-medium tracking-tighter text-center text-balance">
                            {title}
                        </h2>
                        <p className="text-muted-foreground md:text-lg text-center text-balance mx-auto">
                            {description}
                        </p>
                    </div>
                </div>
            </SectionHeader> */}
            <Feature
                collapseDelay={5000}
                linePosition="bottom"
                featureItems={items}
                lineColor="bg-sky-500"
                showCaption
            />
        </section>
    );
}
