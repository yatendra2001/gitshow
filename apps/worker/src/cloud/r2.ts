/**
 * Worker-local R2Client that delegates to the shared implementation and
 * injects the Fly worker's pino logger.
 */
import { R2Client as SharedR2Client } from "@gitshow/shared/cloud/r2";
import { logger } from "../util.js";

export class R2Client extends SharedR2Client {
  static fromEnv(): R2Client {
    return SharedR2Client.fromEnv({
      logger: logger.child({ src: "r2" }),
    }) as R2Client;
  }
}
