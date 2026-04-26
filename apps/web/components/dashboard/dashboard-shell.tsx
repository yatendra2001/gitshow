"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Dashboard shell — sidebar + main content layout used by every page
 * inside `app/app/(dashboard)/*`.
 *
 * Desktop: fixed 240px left rail, content scrolls in the right column.
 * Mobile: rail collapses behind a slide-in drawer triggered by the
 *         hamburger in the topbar.
 *
 * Active state: solid `--color-foreground` at very low alpha + a 2px
 * left indicator. No gradient — that read as muddy and "not gitshow"
 * per design feedback. Hover is a flat bg-color transition (Emil:
 * specific properties only, ease for hover).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CreditCard,
  Eye,
  HelpCircle,
  type LucideIcon,
  Menu,
  Moon,
  PencilLine,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "@/components/logo";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  external?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/app", label: "Analytics", icon: BarChart3 },
      { href: "/app/edit", label: "Edit", icon: PencilLine },
      { href: "/app/preview", label: "Preview", icon: Eye },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/app/billing", label: "Billing", icon: CreditCard },
      {
        href: "mailto:hi@gitshow.io",
        label: "Support",
        icon: HelpCircle,
        external: true,
      },
    ],
  },
];

export interface DashboardShellProps {
  handle: string;
  avatarUrl?: string | null;
  publicSlug: string | null;
  isPublished: boolean;
  planLabel: string;
  /** Trailing content slot for the topbar (right side). */
  topbarTrailing?: React.ReactNode;
  /** Click handler for the sign-out button. Component provides the styling. */
  onSignOut?: () => void;
  /** Pre-built sign-out element if you need a server-action form. */
  signOutSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardShell({
  handle,
  avatarUrl,
  publicSlug,
  isPublished,
  planLabel,
  topbarTrailing,
  signOutSlot,
  children,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close drawer when the route changes (clicking a nav item).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const railContent = (
    <SidebarBody
      handle={handle}
      avatarUrl={avatarUrl}
      publicSlug={publicSlug}
      isPublished={isPublished}
      planLabel={planLabel}
      currentPath={pathname}
      onNavigate={() => setMobileOpen(false)}
      signOutSlot={signOutSlot}
    />
  );

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Desktop rail */}
      <aside
        aria-label="Primary"
        className="hidden md:flex fixed inset-y-0 left-0 z-30 w-[240px] flex-col border-r border-border/40 bg-sidebar"
      >
        {railContent}
      </aside>

      {/* Mobile drawer overlay */}
      <button
        type="button"
        aria-label="Close menu"
        aria-hidden={!mobileOpen}
        tabIndex={mobileOpen ? 0 : -1}
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-background/70 backdrop-blur-sm",
          "transition-[opacity] duration-150 ease-out",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileOpen(false)}
      />
      <aside
        aria-label="Primary (mobile)"
        aria-hidden={!mobileOpen}
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col border-r border-border/50 bg-sidebar shadow-2xl",
          "transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className={cn(
            "absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg",
            "text-muted-foreground hover:text-foreground",
            "transition-[background-color,color] duration-150 ease",
            "hover:bg-foreground/[0.04]",
          )}
        >
          <X className="size-4" strokeWidth={2} />
        </button>
        {railContent}
      </aside>

      {/* Right column */}
      <div className="md:pl-[240px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className={cn(
                "md:hidden inline-flex size-9 items-center justify-center rounded-lg",
                "text-muted-foreground hover:text-foreground",
                "transition-[background-color,color] duration-150 ease",
                "hover:bg-foreground/[0.04]",
              )}
            >
              <Menu className="size-4" strokeWidth={2} />
            </button>
            <span className="md:hidden">
              <LogoMark size={22} />
            </span>
          </div>
          <div className="flex items-center gap-2">{topbarTrailing}</div>
        </header>

        <main className="relative">{children}</main>
      </div>
    </div>
  );
}

function SidebarBody({
  handle,
  avatarUrl,
  publicSlug,
  isPublished,
  planLabel,
  currentPath,
  onNavigate,
  signOutSlot,
}: {
  handle: string;
  avatarUrl: string | null | undefined;
  publicSlug: string | null;
  isPublished: boolean;
  planLabel: string;
  currentPath: string;
  onNavigate: () => void;
  signOutSlot: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-border/30">
        <Logo href="/" size={22} />
      </div>

      {/* User card */}
      <div className="px-3 pt-3 pb-1">
        <UserCard
          handle={handle}
          avatarUrl={avatarUrl}
          publicSlug={publicSlug}
          isPublished={isPublished}
          planLabel={planLabel}
          onNavigate={onNavigate}
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pt-2 pb-3 gs-pane-scroll">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mt-3 first:mt-1">
            <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              {section.title}
            </div>
            <ul className="flex flex-col gap-px">
              {section.items.map((item) => (
                <li key={item.href}>
                  <SidebarLink
                    item={item}
                    active={isActive(currentPath, item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/30 p-2">
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <div className="flex-1">{signOutSlot}</div>
        </div>
      </div>
    </div>
  );
}

function UserCard({
  handle,
  avatarUrl,
  publicSlug,
  isPublished,
  planLabel,
  onNavigate,
}: {
  handle: string;
  avatarUrl: string | null | undefined;
  publicSlug: string | null;
  isPublished: boolean;
  planLabel: string;
  onNavigate: () => void;
}) {
  return (
    <div className="px-1 py-1">
      <div className="flex items-center gap-2.5">
        <Avatar handle={handle} url={avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">
            @{handle || "you"}
          </div>
          <div className="text-[11px] text-muted-foreground/80 leading-tight mt-0.5">
            {planLabel}
          </div>
        </div>
      </div>
      {isPublished && publicSlug ? (
        <Link
          href={`/${publicSlug}`}
          target="_blank"
          rel="noreferrer"
          onClick={onNavigate}
          className={cn(
            "mt-2.5 flex items-center justify-between gap-2 rounded-md px-2 py-1.5",
            "text-[11.5px] font-mono text-muted-foreground",
            "hover:bg-foreground/[0.04] hover:text-foreground",
            "transition-[background-color,color] duration-150 ease",
          )}
        >
          <span className="truncate">gitshow.io/{publicSlug}</span>
          <ArrowUpRight className="size-3 shrink-0" strokeWidth={2} />
        </Link>
      ) : null}
    </div>
  );
}

function Avatar({
  handle,
  url,
}: {
  handle: string;
  url: string | null | undefined;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={32}
        height={32}
        className="size-8 rounded-full object-cover ring-1 ring-border/40"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="flex size-8 items-center justify-center rounded-full bg-foreground text-background text-[12px] font-semibold uppercase">
      {(handle?.[0] ?? "g").toUpperCase()}
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  // Active = solid muted bg + thin left accent strip + foreground text/icon.
  // Hover = subtle bg-color only, single property transition.
  const className = cn(
    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium leading-none",
    "transition-[background-color,color] duration-150 ease",
    active
      ? "bg-foreground/[0.06] text-foreground"
      : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
  );

  const indicator = active ? (
    <span
      aria-hidden
      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full bg-foreground"
    />
  ) : null;

  if (item.external) {
    return (
      <a href={item.href} className={className} onClick={onNavigate}>
        {indicator}
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-foreground" : "text-muted-foreground/70",
          )}
          strokeWidth={2}
        />
        <span>{item.label}</span>
      </a>
    );
  }

  return (
    <Link href={item.href} className={className} onClick={onNavigate}>
      {indicator}
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-foreground" : "text-muted-foreground/70",
        )}
        strokeWidth={2}
      />
      <span>{item.label}</span>
    </Link>
  );
}

/**
 * Two-state sun/moon toggle styled to match the sidebar's nav-row
 * footprint. Avoids the orphan-icon-button look the prior layout had.
 */
function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isDark = (theme === "dark" || (theme === "system" && resolvedTheme === "dark"));
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
      title={isDark ? "Switch to light" : "Switch to dark"}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md",
        "text-muted-foreground hover:text-foreground",
        "transition-[background-color,color] duration-150 ease",
        "hover:bg-foreground/[0.04]",
      )}
    >
      <Sun className="size-4 hidden dark:block" strokeWidth={2} />
      <Moon className="size-4 dark:hidden" strokeWidth={2} />
    </button>
  );
}

function isActive(currentPath: string, href: string) {
  if (href === "/app") return currentPath === "/app";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}
