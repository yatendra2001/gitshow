"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { FlickeringGrid } from "@/components/marketing/ui/flickering-grid";
import { cn } from "@/lib/utils";

const FLICKER_COLOR = "#2CD5FF";

type FeatureItem = {
    id: number;
    title: string;
    content: string;
    image?: string;
    video?: string;
    mockup?: React.ReactNode;
};

type FeatureProps = {
    collapseDelay?: number;
    linePosition?: "left" | "right" | "top" | "bottom";
    lineColor?: string;
    featureItems: FeatureItem[];
    showCaption?: boolean;
};

const LINE_POSITION_CLASSES = {
    left: "left-0 top-0 bottom-0 w-px",
    right: "right-0 top-0 bottom-0 w-px",
    top: "top-0 left-0 right-0 h-px",
    bottom: "bottom-0 left-0 right-0 h-px",
} as const;

const MEDIA_TRANSITION = {
    duration: 0.3,
    ease: "easeInOut" as const,
};

export const Feature = ({
    collapseDelay = 5000,
    linePosition = "left",
    lineColor = "bg-neutral-500 dark:bg-white",
    featureItems,
    showCaption = false,
}: FeatureProps) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const [trigger, setTrigger] = useState(0); // Used to reset the interval

    const isInView = useInView(containerRef, { amount: "some" });
    const isVertical = linePosition === "left" || linePosition === "right";
    const currentItem = featureItems[currentIndex];

    const handleTabClick = useCallback(
        (index: number) => {
            setCurrentIndex(index);
            setTrigger((prev) => prev + 1);
        },
        []
    );

    useEffect(() => {
        if (!isInView || featureItems.length === 0) return;

        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % featureItems.length);
        }, collapseDelay);

        return () => clearInterval(interval);
    }, [isInView, featureItems.length, collapseDelay, trigger]);

    const renderMedia = () => {
        if (!currentItem) {
            return (
                <motion.div
                    key={`empty-${currentIndex}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={MEDIA_TRANSITION}
                    className="min-h-[400px] w-full rounded-xl border border-border bg-muted p-1"
                />
            );
        }

        if (currentItem.mockup) {
            return (
                <motion.div
                    key={`mockup-${currentIndex}-${currentItem.id}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={MEDIA_TRANSITION}
                    className="min-h-[400px] md:min-h-[440px] w-full rounded-xl border border-border bg-muted/30 dark:bg-muted/10 flex items-center justify-center p-6 md:p-10 overflow-hidden"
                >
                    {currentItem.mockup}
                </motion.div>
            );
        }

        if (currentItem.image) {
            return (
                <motion.div
                    key={`image-${currentIndex}-${currentItem.id}`}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={MEDIA_TRANSITION}
                    className="relative w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40 ring-1 ring-foreground/5"
                >
                    <div className="aspect-[2920/1710] w-full">
                        <img
                            src={currentItem.image}
                            alt={currentItem.title}
                            className="h-full w-full object-cover object-top"
                        />
                    </div>
                    <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-foreground/10 rounded-xl" />
                </motion.div>
            );
        }

        if (currentItem.video) {
            return (
                <motion.video
                    key={`video-${currentIndex}-${currentItem.id}`}
                    src={currentItem.video}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={MEDIA_TRANSITION}
                    className="min-h-[400px] h-full w-full rounded-lg object-cover"
                    autoPlay
                    loop
                    muted
                    playsInline
                />
            );
        }

        return (
            <motion.div
                key={`fallback-${currentIndex}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={MEDIA_TRANSITION}
                className="min-h-[400px] w-full rounded-xl border border-border bg-muted p-1"
            />
        );
    };

    return (
        <div ref={containerRef} className="w-full flex flex-col">
            <div className="w-full grid grid-cols-2 lg:grid-cols-4 overflow-hidden border-b">
                {featureItems.map((item, index) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => handleTabClick(index)}
                        className="relative cursor-pointer overflow-hidden w-full min-h-[44px] p-5 text-sm font-semibold whitespace-nowrap transition-colors text-center group flex items-center justify-center touch-manipulation before:absolute before:left-0 before:top-0 before:z-10 before:h-screen before:w-px first:before:bg-transparent before:bg-border before:content-[''] after:absolute after:-left-px after:-top-px after:z-10 after:w-screen after:h-px last:after:bg-transparent after:bg-border after:content-['']"
                    >
                        {currentIndex === index && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={MEDIA_TRANSITION}
                                className="absolute inset-0 w-[calc(100%+1rem)] h-10 -z-10 mask-[linear-gradient(to_bottom,white,transparent)]"
                            >
                                <FlickeringGrid
                                    className="absolute inset-0 z-0 size-full"
                                    squareSize={3}
                                    gridGap={2}
                                    color={FLICKER_COLOR}
                                    maxOpacity={0.5}
                                    flickerChance={0.2}
                                />
                            </motion.div>
                        )}
                        {item.title}
                        {currentIndex === index && (
                            <span
                                aria-hidden
                                className={cn(
                                    "pointer-events-none absolute",
                                    LINE_POSITION_CLASSES[linePosition]
                                )}
                            >
                                <motion.span
                                    key={`${currentIndex}-${trigger}`}
                                    className={cn(
                                        "absolute inset-0 -top-px",
                                        isVertical ? "origin-top" : "origin-left",
                                        lineColor,
                                        isVertical ? "w-px h-full" : "h-px w-full"
                                    )}
                                    initial={isVertical ? { scaleY: 0 } : { scaleX: 0 }}
                                    animate={isVertical ? { scaleY: 1 } : { scaleX: 1 }}
                                    transition={{
                                        duration: collapseDelay / 1000,
                                        ease: "linear",
                                    }}
                                />
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div className="w-full p-4 md:p-6 relative overflow-hidden">
                <AnimatePresence mode="wait">{renderMedia()}</AnimatePresence>
                {showCaption && currentItem?.content ? (
                    <AnimatePresence mode="wait">
                        <motion.p
                            key={`caption-${currentIndex}-${currentItem.id}`}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={MEDIA_TRANSITION}
                            className="mx-auto mt-6 max-w-2xl text-balance text-center text-sm md:text-base text-muted-foreground"
                        >
                            {currentItem.content}
                        </motion.p>
                    </AnimatePresence>
                ) : null}
            </div>
        </div>
    );
};

