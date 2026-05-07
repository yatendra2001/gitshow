"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Admin sub-nav. Sits below the dashboard topbar and inside the regular
 * `(dashboard)` shell. Mirrors the analytics range tabs visually so the
 * panel feels like another tab inside the same product, not a different
 * surface.
 *
 * Active = solid background pill (matches the analytics range-tabs pill
 * exactly). Hover on inactive = flat bg-color fade.
 */
const TABS: Array<{ href: string; label: string }> = [
  { href: "/app/admin",        label: "Overview" },
  { href: "/app/admin/users",  label: "Users" },
  { href: "/app/admin/issues", label: "Issues" },
];

export function AdminSubnav() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 p-0.5">
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              scroll={false}
              className={cn(
                "relative px-3 py-1 text-[12px] font-medium rounded-md",
                "transition-[color,transform] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                "active:scale-[0.97] active:duration-[80ms]",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                active
                  ? "bg-background text-foreground shadow-[0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.08),0_1px_2px_-1px_oklch(0_0_0_/_0.06)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/app/admin") return pathname === "/app/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
