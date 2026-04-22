"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { siteConfig } from "@/lib/marketing-config";
import { SectionHeader } from "@/components/marketing/section-header";
import { HeaderBadge } from "@/components/marketing/header-badge";
import {
    PipelineFlowMockup,
    PublishFlowMockup,
    SignInFlowMockup,
} from "@/components/marketing/flow-mockups";

/**
 * "Sign in · Generate · Share" section.
 *
 * Desktop: left column sticks and swaps between three real product
 * mockups (GitHub sign-in → pipeline progress → live portfolio) as
 * the user scrolls through the three step explanations on the right.
 *
 * Mobile: stack each step above its matching mockup — no sticky.
 */

const connectConfig = siteConfig.connectSection;

const STEP_MOCKUPS = [
    <SignInFlowMockup key="signin" />,
    <PipelineFlowMockup key="pipeline" />,
    <PublishFlowMockup key="publish" />,
];

export function ConnectSection() {
    const step1Ref = useRef<HTMLDivElement>(null);
    const step2Ref = useRef<HTMLDivElement>(null);
    const step3Ref = useRef<HTMLDivElement>(null);

    const s1 = useInView(step1Ref, { margin: "-150px 0px -50% 0px", once: false });
    const s2 = useInView(step2Ref, { margin: "-150px 0px -50% 0px", once: false });
    const s3 = useInView(step3Ref, { margin: "-150px 0px -50% 0px", once: false });

    // Pick the lowest in-view step (biases to the current one as you scroll).
    const activeIndex = s3 ? 2 : s2 ? 1 : s1 ? 0 : 0;

    return (
        <section id="connect" className="w-full relative">
            <SectionHeader>
                <div className="flex flex-col items-center justify-center">
                    <HeaderBadge
                        icon={connectConfig.badge.icon}
                        text={connectConfig.badge.text}
                    />
                    <div className="flex flex-col items-center justify-center gap-4 mt-4">
                        <h2 className="text-3xl md:text-4xl lg:text-6xl font-medium tracking-tighter text-center text-balance">
                            {connectConfig.title}
                        </h2>
                        <p className="text-muted-foreground text-center text-balance mx-auto">
                            {connectConfig.description}
                        </p>
                    </div>
                </div>
            </SectionHeader>

            <div className="grid md:grid-cols-6">
                {/* Sticky mockup column (desktop only) */}
                <div className="hidden md:block col-span-4 w-full md:sticky md:top-20 md:self-start">
                    <div className="flex items-center justify-center p-8 md:p-14 min-h-[520px]">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeIndex}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.35, ease: "easeOut" }}
                                className="w-full max-w-md flex items-center justify-center"
                            >
                                {STEP_MOCKUPS[activeIndex]}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>

                {/* Mobile: stacked steps with inline mockups */}
                <div className="md:hidden flex flex-col gap-16 p-8">
                    <MobileStep
                        index={1}
                        title={connectConfig.step1.title}
                        description={connectConfig.step1.description}
                        mockup={<SignInFlowMockup />}
                    />
                    <MobileStep
                        index={2}
                        title={connectConfig.step2.title}
                        description={connectConfig.step2.description}
                        mockup={<PipelineFlowMockup />}
                    />
                    <MobileStep
                        index={3}
                        title={connectConfig.step3.title}
                        description={connectConfig.step3.description}
                        mockup={<PublishFlowMockup />}
                    />
                </div>

                {/* Desktop: the three explanatory text blocks on the right */}
                <div className="hidden md:block col-span-2 w-full border-l border-border">
                    <div className="flex flex-col p-8 md:p-14">
                        <DesktopStep
                            index={1}
                            innerRef={step1Ref}
                            title={connectConfig.step1.title}
                            description={connectConfig.step1.description}
                            active={activeIndex === 0}
                        />
                        <DesktopStep
                            index={2}
                            innerRef={step2Ref}
                            title={connectConfig.step2.title}
                            description={connectConfig.step2.description}
                            active={activeIndex === 1}
                        />
                        <DesktopStep
                            index={3}
                            innerRef={step3Ref}
                            title={connectConfig.step3.title}
                            description={connectConfig.step3.description}
                            active={activeIndex === 2}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}

function DesktopStep({
    index,
    innerRef,
    title,
    description,
    active,
}: {
    index: number;
    innerRef: React.RefObject<HTMLDivElement | null>;
    title: string;
    description: string;
    active: boolean;
}) {
    return (
        <div ref={innerRef} className="min-h-[50vh] flex flex-col justify-center">
            <div className="flex items-center gap-2">
                <span
                    className={`inline-flex size-6 items-center justify-center rounded-full border text-[11px] font-mono transition-colors ${active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground"
                        }`}
                >
                    {index}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Step {index} of 3
                </span>
            </div>
            <h3 className="mt-3 text-2xl md:text-3xl font-medium tracking-tighter text-left">
                {title}
            </h3>
            <p className="text-muted-foreground text-left text-balance mt-3">
                {description}
            </p>
        </div>
    );
}

function MobileStep({
    index,
    title,
    description,
    mockup,
}: {
    index: number;
    title: string;
    description: string;
    mockup: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full border border-foreground bg-foreground text-[11px] font-mono text-background">
                    {index}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Step {index} of 3
                </span>
            </div>
            <div className="flex items-center justify-center">{mockup}</div>
            <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-medium tracking-tighter text-left">
                    {title}
                </h3>
                <p className="text-muted-foreground text-left text-balance">
                    {description}
                </p>
            </div>
        </div>
    );
}
