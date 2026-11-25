/** Modül A: üretim, tesis, araştırma, finans, şirket, stok, bildirim — yalnızca bu modülün sahibi düzenler. */
import type { FastifyInstance } from "fastify";
import type { Deps } from "../../deps";
import { registerCompanyViewRoutes } from "../../company/viewRoutes";
import { facilityCompletionTask } from "../../facilities/complete";
import { registerFacilityRoutes } from "../../facilities/routes";
import { loanInstallmentTask } from "../../finance/loans";
import { registerFinanceRoutes } from "../../finance/routes";
import { snapshotTask, upkeepTask } from "../../finance/upkeep";
import { registerInventoryRoutes } from "../../inventory/routes";
import { registerNotificationRoutes } from "../../notifications/routes";
import { registerProductionRoutes } from "../../production/routes";
import { settleDueJobs } from "../../production/settle";
import { researchCompletionTask } from "../../research/research";
import { registerResearchRoutes } from "../../research/routes";
import { registerTask } from "../../scheduler/scheduler";

export function register(app: FastifyInstance, deps: Deps): void {
  registerCompanyViewRoutes(app, deps);
  registerFacilityRoutes(app, deps);
  registerProductionRoutes(app, deps);
  registerResearchRoutes(app, deps);
  registerFinanceRoutes(app, deps);
  registerInventoryRoutes(app, deps);
  registerNotificationRoutes(app, deps);
}

/** registerTask(...) çağrıları */
export function tasks(): void {
  registerTask({ name: "production.settle", everyMs: 0, run: (deps, now) => settleDueJobs(deps, now) });
  registerTask({ name: "facilities.complete", everyMs: 0, run: (deps, now) => facilityCompletionTask(deps, now) });
  registerTask({ name: "research.complete", everyMs: 0, run: (deps, now) => researchCompletionTask(deps, now) });
  registerTask({ name: "finance.loans", everyMs: 30_000, run: (deps, now) => loanInstallmentTask(deps, now) });
  registerTask({ name: "finance.upkeep", everyMs: 30_000, run: (deps, now) => upkeepTask(deps, now) });
  registerTask({ name: "company.snapshot", everyMs: 3_600_000, run: (deps, now) => snapshotTask(deps, now) });
}
