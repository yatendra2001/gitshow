/**
 * Module augmentation so `session.user.login` is typed as a string
 * across the app. Populated by `mapProfileToUser` in auth.ts on every
 * GitHub sign-in (see `user.additionalFields.login`).
 *
 * Better Auth infers user shape at runtime from `additionalFields`,
 * but the static types don't pick it up — so we widen `User` here to
 * match. Keep this file in sync with the `additionalFields` in
 * `auth.ts`.
 */

declare module "better-auth" {
  interface User {
    login?: string | null;
  }
}

export {};
