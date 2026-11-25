import type { AccountKind } from "../db/schema";

/** Şirket hesap planı. Yeni hesap kodu eklemek mevcut kayıtları etkilemez. */
export const COMPANY_ACCOUNTS: Record<string, AccountKind> = {
  cash: "asset",
  inventory: "asset",
  wip: "asset",
  escrow: "asset",
  prepaid_freight: "asset",
  fixed_assets: "asset",
  loans: "liability",
  arrears: "liability",
  equity: "equity",
  revenue_sales: "revenue",
  revenue_freight: "revenue",
  revenue_other: "revenue",
  cogs: "expense",
  exp_freight: "expense",
  exp_fees: "expense",
  exp_interest: "expense",
  exp_upkeep: "expense",
  exp_research: "expense",
  exp_penalties: "expense",
  exp_fleet: "expense",
  exp_other: "expense",
};

/**
 * Defter kuralı: her işlemin satırları şirket bazında dengelidir (borç + alacak = 0).
 * Sistemle yapılan alışverişte (arsa, enerji, ücret, araç) yalnızca şirketin kendi satırları yazılır;
 * karşı tarafın türü işlem türünden (kind) bellidir. Sistem şirketleriyle ticarette her iki şirketin
 * satırları aynı işlemdedir. Saf sistem hesapları gelecekte gerekirse burada tanımlanır.
 */
export const SYSTEM_ACCOUNTS: Record<string, AccountKind> = {};

export const REVENUE_CODES = ["revenue_sales", "revenue_freight", "revenue_other"] as const;
export const EXPENSE_CODES = ["cogs", "exp_freight", "exp_fees", "exp_interest", "exp_upkeep", "exp_research", "exp_penalties", "exp_fleet", "exp_other"] as const;

export function kindOf(companyId: string | null, code: string): AccountKind {
  const k = companyId ? COMPANY_ACCOUNTS[code] : SYSTEM_ACCOUNTS[code];
  if (!k) throw new Error(`Bilinmeyen hesap kodu: ${code}`);
  return k;
}
