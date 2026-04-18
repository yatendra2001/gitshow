/**
 * Tiny shared helpers used by the cloud clients + worker entrypoints.
 * Pure functions, no runtime deps — safe to import from anywhere in
 * apps/worker, including scripts.
 */
import { pino } from "pino";

/** Read an env var, throw if missing or empty. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}

/** Non-blocking sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared pino logger.
 *
 * Production (NODE_ENV=production, i.e. inside Fly): line-delimited JSON
 * on stdout, ISO timestamps, no pid/hostname bindings, level as a name
 * instead of a number. Fly's log shipper picks it up as-is.
 *
 * Dev (local CLI): pretty-printed with pino-pretty, colorized, compact
 * timestamps. Readable without piping through jq.
 *
 * Use `logger.info({ scan_id, ... }, "boot")` style — first arg is
 * structured fields, second is the human message.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(process.env.NODE_ENV === "production"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
});
