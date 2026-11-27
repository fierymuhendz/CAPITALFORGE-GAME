"use client";
import type { ComponentType } from "react";
import type { PanelId } from "./context";
import { CompanyPanel } from "../company/CompanyPanel";
import { FacilitiesPanel } from "../facilities/FacilitiesPanel";
import { InventoryPanel } from "../inventory/InventoryPanel";
import { MarketPanel } from "../market/MarketPanel";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { ContractsPanel } from "../contracts/ContractsPanel";
import { LogisticsPanel } from "../logistics/LogisticsPanel";
import { FinancePanel } from "../finance/FinancePanel";
import { ResearchPanel } from "../more/ResearchPanel";
import { NotificationsPanel } from "../more/NotificationsPanel";
import { AccountPanel } from "../more/AccountPanel";

export const PANELS: Array<{ id: PanelId; icon: string; Comp: ComponentType }> = [
  { id: "company", icon: "building", Comp: CompanyPanel },
  { id: "facilities", icon: "factory", Comp: FacilitiesPanel },
  { id: "inventory", icon: "box", Comp: InventoryPanel },
  { id: "market", icon: "chart", Comp: MarketPanel },
  { id: "catalog", icon: "book", Comp: CatalogPanel },
  { id: "contracts", icon: "doc", Comp: ContractsPanel },
  { id: "logistics", icon: "truck", Comp: LogisticsPanel },
  { id: "finance", icon: "wallet", Comp: FinancePanel },
  { id: "research", icon: "flask", Comp: ResearchPanel },
  { id: "notifications", icon: "bell", Comp: NotificationsPanel },
  { id: "account", icon: "user", Comp: AccountPanel },
];
