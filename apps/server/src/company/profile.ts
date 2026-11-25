/** Herkese açık şirket profili ve arama. Bakiye, stok, tesis gibi özel veriler yoktur. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { uuid, type PublicCompanyDto } from "@capitalforge/shared";
import { reputationBp } from "@capitalforge/economy";
import type { Db } from "../db/client";
import { companies } from "../db/schema";
import { fail } from "../errors";

type Row = typeof companies.$inferSelect;

export function publicDto(c: Row): PublicCompanyDto {
  return {
    id: c.id, name: c.name, sector: c.sector, homeCityId: c.homeCityId, level: c.level, reputationBp: reputationBp(c.onTimeDeliveries, c.lateOrMissed),
    onTimeDeliveries: c.onTimeDeliveries, lateOrMissed: c.lateOrMissed, isSystem: c.isSystem, createdAt: c.createdAt.toISOString(),
  };
}

export async function publicProfile(db: Db, id: string): Promise<PublicCompanyDto> {
  if (!uuid.safeParse(id).success) fail("NOT_FOUND");
  const c = (await db.select().from(companies).where(and(eq(companies.id, id), isNull(companies.dissolvedAt))).limit(1))[0];
  if (!c) fail("NOT_FOUND");
  return publicDto(c);
}

export async function searchCompanies(db: Db, q: string): Promise<PublicCompanyDto[]> {
  const needle = q.trim().toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = await db
    .select()
    .from(companies)
    .where(and(isNull(companies.dissolvedAt), sql`${companies.nameLower} LIKE ${`%${needle}%`}`))
    .orderBy(sql`(${companies.nameLower} LIKE ${`${needle}%`}) DESC`, companies.nameLower)
    .limit(20);
  return rows.map(publicDto);
}
