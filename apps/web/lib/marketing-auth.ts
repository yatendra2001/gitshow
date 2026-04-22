/**
 * Shape of the primary landing-page CTA. Computed on the server in
 * `app/page.tsx` from the session cookie and forwarded to every
 * section that renders a sign-in-or-dashboard button.
 */
export type MarketingAuth = {
  label: string;
  href: "/signin" | "/app";
};
