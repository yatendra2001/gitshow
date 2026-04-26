"use client";

/**
 * Dashboard shell — sidebar + main content layout used by every page
 * inside `app/app/(dashboard)/*`.
 *
 * Desktop: fixed 248px left rail, content scrolls in the right column.
 * Mobile: rail collapses behind a slide-in drawer triggered by the
 *         hamburger in the topbar.
 *
 * Active state for the current route uses our gradient-accent surface
 * (`gs-accent-surface` in globals.css) instead of a solid black pill —
 * it reads as "gitshow", not "generic shadcn block".
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
  PencilLine,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";

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
  publicSlug: string | null;
  isPublished: boolean;
  planLabel: string;
  /** Trailing content slot for the topbar (right side). */
  topbarTrailing?: React.ReactNode;
  /** Trailing content slot at the bottom of the sidebar (e.g. SignOut). */
  sidebarFooterTrailing?: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardShell({
  handle,
  publicSlug,
  isPublished,
  planLabel,
  topbarTrailing,
  sidebarFooterTrailing,
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
      publicSlug={publicSlug}
      isPublished={isPublished}
      planLabel={planLabel}
      currentPath={pathname}
      onNavigate={() => setMobileOpen(false)}
      sidebarFooterTrailing={sidebarFooterTrailing}
    />
  );

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Desktop rail — fixed at md+ */}
      <aside
        aria-label="Primary"
        className="hidden md:flex fixed inset-y-0 left-0 z-30 w-[248px] flex-col border-r border-border/40 bg-sidebar/95 backdrop-blur-sm"
      >
        {railContent}
      </aside>

      {/* Mobile drawer overlay */}
      <div
        aria-hidden={!mobileOpen}
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm transition-opacity duration-200",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileOpen(false)}
      />
      <aside
        aria-label="Primary (mobile)"
        aria-hidden={!mobileOpen}
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col border-r border-border/50 bg-sidebar shadow-2xl transition-transform duration-220 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
        {railContent}
      </aside>

      {/* Right column */}
      <div className="md:pl-[248px]">
        {/* Topbar — only renders the hamburger on mobile, otherwise a
         *  thin sticky band so the trailing slot has somewhere to live. */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="md:hidden inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground"
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
  publicSlug,
  isPublished,
  planLabel,
  currentPath,
  onNavigate,
  sidebarFooterTrailing,
}: {
  handle: string;
  publicSlug: string | null;
  isPublished: boolean;
  planLabel: string;
  currentPath: string;
  onNavigate: () => void;
  sidebarFooterTrailing: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-border/30">
        <Logo href="/" size={22} />
      </div>

      {/* User card */}
      <div className="px-3 pt-4 pb-2">
        <div className="rounded-xl border border-border/40 bg-card/60 p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background text-[12px] font-semibold uppercase">
              {(handle?.[0] ?? "g").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-tight">
                @{handle || "you"}
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight">
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
              className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/60 px-2.5 py-1.5 text-[11.5px] font-medium hover:bg-background/90 transition-colors"
            >
              <span className="truncate font-mono text-muted-foreground">
                gitshow.io/{publicSlug}
              </span>
              <ArrowUpRight
                className="size-3 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
            </Link>
          ) : null}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pt-1 pb-3 gs-pane-scroll">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mt-3">
            <div className="px-2 pb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {section.title}
            </div>
            <ul className="flex flex-col gap-0.5">
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
      <div className="border-t border-border/30 px-3 py-3 flex items-center justify-between gap-2">
        <ModeToggle />
        {sidebarFooterTrailing}
      </div>
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
  const className = cn(
    "group flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-[13px] font-medium leading-none transition-colors",
    active
      ? "gs-accent-surface text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );

  if (item.external) {
    return (
      <a href={item.href} className={className} onClick={onNavigate}>
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-foreground" : "text-muted-foreground/80",
          )}
          strokeWidth={2}
        />
        <span>{item.label}</span>
      </a>
    );
  }

  return (
    <Link href={item.href} className={className} onClick={onNavigate}>
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-foreground" : "text-muted-foreground/80",
        )}
        strokeWidth={2}
      />
      <span>{item.label}</span>
    </Link>
  );
}

function isActive(currentPath: string, href: string) {
  if (href === "/app") return currentPath === "/app";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}
