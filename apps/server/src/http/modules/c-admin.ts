/** Modül C: yönetim ve adil oyun — yalnızca bu modülün sahibi düzenler. */
import type { FastifyInstance } from "fastify";
import type { Deps } from "../../deps";
import { registerAdminRoutes } from "../../admin/routes";
import { registerCaseRoutes } from "../../admin/cases";
import { registerPlayerRoutes } from "../../admin/players";
import { registerCatalogRoutes } from "../../admin/catalogAdmin";
import { registerFairplayTasks } from "../../fairplay/detect";

export function register(app: FastifyInstance, deps: Deps): void {
  registerAdminRoutes(app, deps);
  registerCaseRoutes(app, deps);
  registerPlayerRoutes(app, deps);
  registerCatalogRoutes(app, deps);
}

/** registerTask(...) çağrıları */
export function tasks(): void {
  registerFairplayTasks();
}
