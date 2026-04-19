/**
 * Worker-local FlyClient that delegates to the shared implementation and
 * injects the Fly worker's pino logger.
 */
import { FlyClient as SharedFlyClient } from "@gitshow/shared/cloud/fly";
import { logger } from "../util.js";

export type { FlyMachine, SpawnMachineInput, FlyConfig } from "@gitshow/shared/cloud/fly";

export class FlyClient extends SharedFlyClient {
  static fromEnv(): FlyClient {
    return SharedFlyClient.fromEnv({
      logger: logger.child({ src: "fly" }),
    }) as FlyClient;
  }
}
