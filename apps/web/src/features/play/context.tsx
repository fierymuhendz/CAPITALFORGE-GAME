"use client";
import { createContext, useContext } from "react";
import type { CompanyDto, WorldMapDto } from "@capitalforge/shared";
import type { CitySelection } from "../../scene";
import type { Resource } from "@/lib/data";

export type PanelId = "company" | "facilities" | "inventory" | "market" | "catalog" | "contracts" | "logistics" | "finance" | "research" | "notifications" | "account";

export const PANEL_IDS: PanelId[] = ["company", "facilities", "inventory", "market", "catalog", "contracts", "logistics", "finance", "research", "notifications", "account"];

/** Veri panelleri geniş yan panel alır (tablolar). */
export const WIDE_PANELS: PanelId[] = ["market", "inventory", "contracts", "logistics", "finance"];

export interface PlayCtx {
  company: Resource<CompanyDto>;
  map: Resource<WorldMapDto>;
  selection: CitySelection | null;
  select: (s: CitySelection | null) => void;
  /** `params`: panel içi derin bağlantı (ör. facility, recipe, view). */
  open: (p: PanelId | null, opts?: { focusCity?: string; params?: Record<string, string> }) => void;
  panel: PanelId | null;
  focusCityId: string | null;
  setFocusCity: (id: string) => void;
}
const C = createContext<PlayCtx | null>(null);
export const PlayProvider = C.Provider;
export function usePlay(): PlayCtx {
  const c = useContext(C);
  if (!c) throw new Error("PlayProvider yok");
  return c;
}
