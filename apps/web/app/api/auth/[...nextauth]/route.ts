import { handlers } from "@/auth";

/**
 * Auth.js v5 route handlers. Exports GET + POST so the provider's OAuth
 * flow (GET /api/auth/signin, POST /api/auth/callback/github, etc.) all
 * route to the correct internal machinery.
 */
export const { GET, POST } = handlers;
