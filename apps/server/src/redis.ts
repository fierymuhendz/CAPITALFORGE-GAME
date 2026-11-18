import { Redis } from "ioredis";
import { config } from "./config";

export type { Redis };

export function createRedis(): Redis {
  return new Redis(config.redisUrl(), { maxRetriesPerRequest: 2 });
}
