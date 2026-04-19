/**
 * Worker-local D1Client that delegates to the shared implementation and
 * injects the Fly worker's pino logger. Keeps existing `fromEnv()` call
 * sites working without each script importing the logger manually.
 */
import { D1Client as SharedD1Client } from "@gitshow/shared/cloud/d1";
import { logger } from "../util.js";

export type { D1Param, RetryOptions, D1FailureInfo } from "@gitshow/shared/cloud/d1";

export class D1Client extends SharedD1Client {
  static fromEnv(): D1Client {
    return SharedD1Client.fromEnv({
      logger: logger.child({ src: "d1" }),
    }) as D1Client;
  }
}
