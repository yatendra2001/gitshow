"use client";

import { useRef } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/marketing-config";
import { SectionHeader } from "@/components/marketing/section-header";
import { HeaderBadge } from "@/components/marketing/header-badge";
import {
    ConnectConsole,
    type ConnectStep,
} from "@/components/marketing/animations/connect-console";

/**
 * "Connect · Review · Share" — three-step explainer.
 *
 * Layout follows the rest of the marketing page (sticky preview
 * on the left, scrolling text steps on the right, divided by a
 * vertical border) so it visually matches Workflow / Feature.
 *
 * Critically, this section now uses ONE persistent console card
 * that morphs through three states as the reader scrolls — same
 * narrative pattern codeforge uses with its PlanSearchCard. That
 * keeps the surface visually quiet, on-brand, and tells a single
 * continuous story instead of three competing fake screens.
 */

const connectConfig = siteConfig.connectSection;

export function ConnectSection() {
    const step1Ref = useRef<HTMLDivElement>(null);
    const step2Ref = useRef<HTMLDivElement>(null);
    const step3Ref = useRef<HTMLDivElement>(null);

    const mobileStep1Ref = useRef<HTMLDivElement>(null);
    const mobileStep2Ref = useRef<HTMLDivElement>(null);
    const mobileStep3Ref = useRef<HTMLDivElement>(null);

    // Generous bottom margin so the active step "claims" the
    // sticky console for most of its scroll-through.
    const inViewMargin = "-150px 0px -55% 0px" as const;
    const s1 = useInView(step1Ref, { margin: inViewMargin });
    const s2 = useInView(step2Ref, { margin: inViewMargin });
    const s3 = useInView(step3Ref, { margin: inViewMargin });

    const m1 = useInView(mobileStep1Ref, { margin: "-30% 0px -30% 0px" });
    const m2 = useInView(mobileStep2Ref, { margin: "-30% 0px -30% 0px" });
    const m3 = useInView(mobileStep3Ref, { margin: "-30% 0px -30% 0px" });

    // Bias to the lowest in-view step (matches reading order).
    const desktopStep: ConnectStep = s3 ? 2 : s2 ? 1 : s1 ? 0 : 0;
    const desktopInView = s1 || s2 || s3;

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
                {/* Sticky console column (desktop). No `self-start`: we want
                 * this column to stretch to the height of the right column
                 * so the sticky inner stays pinned through all 3 steps. */}
                <div className="hidden md:block col-span-4 w-full relative">
                    <div className="md:sticky md:top-20 flex items-center justify-center p-8 md:p-14 min-h-[520px]">
                        <ConnectConsole step={desktopStep} inView={desktopInView} />
                    </div>
                </div>

                {/* Mobile: console morphs in line with the active step */}
                <div className="md:hidden flex flex-col gap-16 p-6 sm:p-8">
                    <MobileStep
                        innerRef={mobileStep1Ref}
                        index={1}
                        title={connectConfig.step1.title}
                        description={connectConfig.step1.description}
                        active={m1}
                        step={0}
                    />
                    <MobileStep
                        innerRef={mobileStep2Ref}
                        index={2}
                        title={connectConfig.step2.title}
                        description={connectConfig.step2.description}
                        active={m2}
                        step={1}
                    />
                    <MobileStep
                        innerRef={mobileStep3Ref}
                        index={3}
                        title={connectConfig.step3.title}
                        description={connectConfig.step3.description}
                        active={m3}
                        step={2}
                    />
                </div>

                {/* Desktop: text steps on the right */}
                <div className="hidden md:block col-span-2 w-full border-l border-border">
                    <div className="flex flex-col p-8 md:p-14">
                        <DesktopStep
                            innerRef={step1Ref}
                            index={1}
                            title={connectConfig.step1.title}
                            description={connectConfig.step1.description}
                            active={desktopStep === 0}
                        />
                        <DesktopStep
                            innerRef={step2Ref}
                            index={2}
                            title={connectConfig.step2.title}
                            description={connectConfig.step2.description}
                            active={desktopStep === 1}
                        />
                        <DesktopStep
                            innerRef={step3Ref}
                            index={3}
                            title={connectConfig.step3.title}
                            description={connectConfig.step3.description}
                            active={desktopStep === 2}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}

/* -------------------------------------------------------------------------- */
/* Step blocks                                                                */
/* -------------------------------------------------------------------------- */

function DesktopStep({
    innerRef,
    index,
    title,
    description,
    active,
}: {
    innerRef: React.RefObject<HTMLDivElement | null>;
    index: number;
    title: string;
    description: string;
    active: boolean;
}) {
    return (
        <div ref={innerRef} className="min-h-[50vh] flex flex-col justify-center">
            <StepEyebrow index={index} active={active} />
            <h3
                className={cn(
                    "mt-3 text-2xl md:text-3xl font-medium tracking-tighter text-left transition-colors",
                    active ? "text-foreground" : "text-foreground/70",
                )}
            >
                {title}
            </h3>
            <p className="text-muted-foreground text-left text-balance mt-3">
                {description}
            </p>
        </div>
    );
}

function MobileStep({
    innerRef,
    index,
    title,
    description,
    active,
    step,
}: {
    innerRef: React.RefObject<HTMLDivElement | null>;
    index: number;
    title: string;
    description: string;
    active: boolean;
    step: ConnectStep;
}) {
    return (
        <div ref={innerRef} className="flex flex-col gap-6">
            <StepEyebrow index={index} active />
            <div className="flex items-center justify-center pt-4">
                <ConnectConsole step={step} inView={active} />
            </div>
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

function StepEyebrow({ index, active }: { index: number; active: boolean }) {
    return (
        <div className="flex items-center gap-2">
            <span
                className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full border text-[11px] font-mono transition-colors",
                    active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground",
                )}
            >
                {index}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Step {index} of 3
            </span>
        </div>
    );
}
