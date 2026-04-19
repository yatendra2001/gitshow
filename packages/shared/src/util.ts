/**
 * Cross-runtime helpers shared between the Fly worker (Node.js) and the
 * Cloudflare Workers web app. No Node-only imports — this file must be
 * safe to bundle into a Workers script.
 */

/** Read an env var, throw if missing or empty. */
export function requireEnv(name: string): string {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
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
 * Structural logger interface. Cloud clients accept any object matching it
 * so the Fly worker can inject its pino logger while the Cloudflare Worker
 * can fall back to `console` without pulling pino into the bundle.
 */
export interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn?(obj: object, msg?: string): void;
  child(bindings: object): Logger;
}

/**
 * Minimal console-backed logger. Used when no pino-style logger is injected
 * (e.g. inside Cloudflare Workers where we want zero deps).
 */
export const consoleLogger: Logger = {
  info: (obj, msg) => {
    if (msg) console.log(msg, obj);
    else console.log(obj);
  },
  error: (obj, msg) => {
    if (msg) console.error(msg, obj);
    else console.error(obj);
  },
  debug: (obj, msg) => {
    if (msg) console.debug(msg, obj);
    else console.debug(obj);
  },
  warn: (obj, msg) => {
    if (msg) console.warn(msg, obj);
    else console.warn(obj);
  },
  child: () => consoleLogger,
};
