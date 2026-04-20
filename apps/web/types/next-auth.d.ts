/**
 * Module augmentation so `session.user.login` is typed across the app.
 * Populated by the session callback in auth.ts.
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      /** GitHub login / username, e.g. "yatendra2001". */
      login?: string;
    };
  }

  interface User {
    /** Populated via the D1 adapter's createUser + backfilled in signIn callback. */
    login?: string | null;
  }
}
