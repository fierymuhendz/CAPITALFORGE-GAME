/**
 * Modül kayıt listesi. Her modül kendi register* fonksiyonunu ve zamanlayıcı görevlerini sağlar.
 * Yeni modül = buraya bir satır.
 */
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";
import { registerAuthRoutes } from "../auth/routes";
import { registerWorldRoutes } from "../world/routes";
import { registerCompanyFoundRoutes } from "../company/routes";

export function registerModules(app: FastifyInstance, deps: Deps): void {
  registerAuthRoutes(app, deps);
  registerWorldRoutes(app, deps);
  registerCompanyFoundRoutes(app, deps);
}

/** Zamanlayıcı görevlerini kaydeden modüller (yan etkili içe aktarımlar yerine açık liste) */
export function registerTasks(): void {
  // modüller burada registerTask(...) çağırır
}
