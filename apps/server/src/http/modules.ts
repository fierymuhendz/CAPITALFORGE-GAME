/**
 * Modül kayıt listesi. Her modül http/modules/<ad>.ts içinde register() ve tasks() sağlar.
 */
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";
import { registerAuthRoutes } from "../auth/routes";
import { registerWorldRoutes } from "../world/routes";
import { registerCompanyFoundRoutes } from "../company/routes";
import * as economy from "./modules/a-economy";
import * as trade from "./modules/b-trade";
import * as admin from "./modules/c-admin";
import { registerIdempotencyTasks } from "../security/idempotency";

export function registerModules(app: FastifyInstance, deps: Deps): void {
  registerAuthRoutes(app, deps);
  registerWorldRoutes(app, deps);
  registerCompanyFoundRoutes(app, deps);
  economy.register(app, deps);
  trade.register(app, deps);
  admin.register(app, deps);
}

export function registerTasks(): void {
  economy.tasks();
  trade.tasks();
  admin.tasks();
  registerIdempotencyTasks();
}
