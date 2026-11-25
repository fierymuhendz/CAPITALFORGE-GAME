import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import { accounts, connectionRecords, sessions } from "../db/schema";
import type { Deps } from "../deps";
import { hmacHex, randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "cf_session";
const SESSION_DAYS = 30;
/** yönetici doğrulaması bu kadar geçerli */
export const ADMIN_VERIFY_MS = 12 * 3600_000;

export interface SessionInfo {
  id: string;
  account: typeof accounts.$inferSelect;
  adminVerified: boolean;
}

export async function createSession(deps: Deps, reply: FastifyReply, accountId: string, ip: string | undefined): Promise<string> {
  const token = randomToken();
  const now = deps.clock.now();
  const [s] = await deps.db
    .insert(sessions)
    .values({ accountId, tokenHash: sha256(token), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400_000) })
    .returning({ id: sessions.id });
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: deps.config.secureCookies,
    maxAge: SESSION_DAYS * 86400,
  });
  await recordConnection(deps, accountId, ip, now);
  return s!.id;
}

export function clearSessionCookie(deps: Deps, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: deps.config.secureCookies });
}

export function sessionToken(req: FastifyRequest): string | null {
  return req.cookies?.[SESSION_COOKIE] ?? null;
}

export async function sessionFromRequest(deps: Deps, req: FastifyRequest): Promise<SessionInfo | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const now = deps.clock.now();
  const r = await deps.db
    .select({ s: sessions, a: accounts })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = r[0];
  if (!row) return null;
  // Son görülme ve bağlantı kaydı en fazla 5 dakikada bir güncellenir
  if (now.getTime() - row.s.lastSeenAt.getTime() > 5 * 60_000) {
    await deps.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
    await recordConnection(deps, row.a.id, req.ip, now);
  }
  const adminVerified = !!row.s.adminVerifiedAt && now.getTime() - row.s.adminVerifiedAt.getTime() < ADMIN_VERIFY_MS;
  return { id: row.s.id, account: row.a, adminVerified };
}

/** Ham IP saklanmaz: anahtarlı karma (HMAC-SHA256). */
export async function recordConnection(deps: Deps, accountId: string, ip: string | undefined, now: Date): Promise<void> {
  if (!ip) return;
  const ipHash = hmacHex(deps.config.ipHashKey, ip);
  await deps.db
    .insert(connectionRecords)
    .values({ accountId, ipHash, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [connectionRecords.accountId, connectionRecords.ipHash],
      set: { lastSeenAt: now, hits: sql`${connectionRecords.hits} + 1` },
    });
}
