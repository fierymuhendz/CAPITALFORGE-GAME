import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  AdminClaimReq, ChangePasswordReq, LoginReq, PrefsReq, RegisterReq, TotpCodeReq, type AccountDto, type MeDto,
} from "@capitalforge/shared";
import { accounts, adminSetupCodes, sessions } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { companySummary } from "../company/summary";
import { decrypt, encrypt, hashPassword, sha256, verifyPassword } from "./crypto";
import { clearSessionCookie, createSession, sessionToken, type SessionInfo } from "./session";
import { newTotpSecret, otpauthUrl, verifyTotp } from "./totp";
import { rateLimit } from "../security/rateLimit";

export function accountDto(a: typeof accounts.$inferSelect, s: SessionInfo | null): AccountDto {
  return {
    id: a.id,
    username: a.username,
    locale: a.locale,
    graphics: a.graphics,
    role: a.role,
    totpEnabled: a.totpEnabled,
    adminVerified: !!s?.adminVerified,
    canReviewConnections: a.canReviewConnections,
    frozen: !!a.frozenAt,
    createdAt: a.createdAt.toISOString(),
  };
}

// Kullanıcı adı numaralandırmasını zorlaştırmak için sabit maliyetli sahte karma
const DUMMY_HASH = hashPassword("bos-parola-karsilastirma");

export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "POST", url: "/auth/register", auth: "none", body: RegisterReq, rateKey: "register", rateLimitPerMin: 10,
    handler: async ({ body, reply, ip, req }) => {
      await rateLimit(deps, `register-ip:${ip}`, 8, 3600);
      const code = (req.headers["x-cf-registration-code"] as string | undefined) ?? "";
      if (deps.config.registrationCode && code !== deps.config.registrationCode) fail("FORBIDDEN");
      const lower = body.username.toLowerCase();
      const exists = await deps.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.usernameLower, lower)).limit(1);
      if (exists[0]) fail("USERNAME_TAKEN");
      const passwordHash = await hashPassword(body.password);
      const now = deps.clock.now();
      const ins = await deps.db
        .insert(accounts)
        .values({ username: body.username, usernameLower: lower, passwordHash, locale: body.locale, createdAt: now, lastLoginAt: now })
        .onConflictDoNothing()
        .returning();
      if (!ins[0]) fail("USERNAME_TAKEN");
      await createSession(deps, reply, ins[0].id, ip);
      return { account: accountDto(ins[0], null) };
    },
  });

  route(app, deps, {
    method: "POST", url: "/auth/login", auth: "none", body: LoginReq, rateKey: "login", rateLimitPerMin: 20,
    handler: async ({ body, reply, ip }) => {
      await rateLimit(deps, `login-ip:${ip}`, 30, 600);
      await rateLimit(deps, `login-user:${body.username.toLowerCase()}`, 10, 600);
      const r = await deps.db.select().from(accounts).where(eq(accounts.usernameLower, body.username.toLowerCase())).limit(1);
      const a = r[0];
      let ok = false;
      if (a) ok = await verifyPassword(body.password, a.passwordHash);
      else await verifyPassword(body.password, await DUMMY_HASH);
      if (!a || !ok) fail("INVALID_CREDENTIALS");
      await deps.db.update(accounts).set({ lastLoginAt: deps.clock.now() }).where(eq(accounts.id, a.id));
      await createSession(deps, reply, a.id, ip);
      return { account: accountDto(a, null), needsTotp: a.role === "admin" && a.totpEnabled };
    },
  });

  route(app, deps, {
    method: "POST", url: "/auth/logout", auth: "none",
    handler: async ({ req, reply }) => {
      const t = sessionToken(req);
      if (t) await deps.db.delete(sessions).where(eq(sessions.tokenHash, sha256(t)));
      clearSessionCookie(deps, reply);
      return { ok: true };
    },
  });

  route(app, deps, {
    method: "GET", url: "/auth/me", auth: "none",
    handler: async ({ session, company }): Promise<MeDto> => ({
      account: session ? accountDto(session.account, session) : null,
      company: company ? await companySummary(deps.db, company) : null,
      serverTime: deps.clock.now().toISOString(),
    }),
  });

  route(app, deps, {
    method: "PATCH", url: "/account/prefs", auth: "account", body: PrefsReq,
    handler: async ({ account, body }) => {
      await deps.db.update(accounts).set({ ...(body.locale ? { locale: body.locale } : {}), ...(body.graphics ? { graphics: body.graphics } : {}) }).where(eq(accounts.id, account!.id));
      return { ok: true };
    },
  });

  route(app, deps, {
    method: "POST", url: "/account/password", auth: "account", body: ChangePasswordReq, rateLimitPerMin: 5,
    handler: async ({ account, body }) => {
      if (!(await verifyPassword(body.oldPassword, account!.passwordHash))) fail("INVALID_CREDENTIALS");
      await deps.db.update(accounts).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(accounts.id, account!.id));
      return { ok: true };
    },
  });

  // ---- Yönetici kurulumu ve iki adımlı doğrulama ----
  route(app, deps, {
    method: "POST", url: "/auth/admin/claim", auth: "account", body: AdminClaimReq, rateKey: "admin-claim", rateLimitPerMin: 5,
    handler: async ({ account, body, ip }) => {
      await rateLimit(deps, `admin-claim-ip:${ip}`, 10, 3600);
      const now = deps.clock.now();
      const used = await deps.db
        .update(adminSetupCodes)
        .set({ usedAt: now, usedBy: account!.id })
        .where(and(eq(adminSetupCodes.codeHash, sha256(body.setupCode)), isNull(adminSetupCodes.usedAt)))
        .returning({ id: adminSetupCodes.id });
      if (!used[0]) fail("SETUP_CODE_INVALID");
      await deps.db.update(accounts).set({ role: "admin", canReviewConnections: true }).where(eq(accounts.id, account!.id));
      deps.log.warn({ accountId: account!.id }, "yönetici kurulum kodu kullanıldı");
      return { ok: true };
    },
  });

  route(app, deps, {
    method: "POST", url: "/auth/totp/setup", auth: "account", rateLimitPerMin: 5,
    handler: async ({ account }) => {
      if (account!.role !== "admin") fail("FORBIDDEN");
      if (account!.totpEnabled) fail("CONFLICT");
      const secret = newTotpSecret();
      await deps.db.update(accounts).set({ totpSecretEnc: encrypt(deps.config.totpKey, secret) }).where(eq(accounts.id, account!.id));
      return { secret, otpauthUrl: otpauthUrl(secret, account!.username) };
    },
  });

  const checkCode = async (a: typeof accounts.$inferSelect, code: string): Promise<void> => {
    if (!a.totpSecretEnc) fail("TOTP_REQUIRED");
    const step = verifyTotp(decrypt(deps.config.totpKey, a.totpSecretEnc), code, deps.clock.now().getTime(), a.totpLastStep ?? null);
    if (step === null) fail("TOTP_INVALID");
    await deps.db.update(accounts).set({ totpLastStep: step }).where(eq(accounts.id, a.id));
  };

  route(app, deps, {
    method: "POST", url: "/auth/totp/enable", auth: "account", body: TotpCodeReq, rateKey: "totp", rateLimitPerMin: 10,
    handler: async ({ account, body, session }) => {
      if (account!.role !== "admin" || account!.totpEnabled) fail("FORBIDDEN");
      await checkCode(account!, body.code);
      await deps.db.update(accounts).set({ totpEnabled: true }).where(eq(accounts.id, account!.id));
      await deps.db.update(sessions).set({ adminVerifiedAt: deps.clock.now() }).where(eq(sessions.id, session!.id));
      return { ok: true };
    },
  });

  route(app, deps, {
    method: "POST", url: "/auth/totp/verify", auth: "account", body: TotpCodeReq, rateKey: "totp", rateLimitPerMin: 10,
    handler: async ({ account, body, session }) => {
      if (account!.role !== "admin" || !account!.totpEnabled) fail("FORBIDDEN");
      await checkCode(account!, body.code);
      await deps.db.update(sessions).set({ adminVerifiedAt: deps.clock.now() }).where(eq(sessions.id, session!.id));
      return { ok: true };
    },
  });
}

/** Açılışta: ortamdan gelen kurulum kodunu (karma olarak) kaydet. Kod kullanıldıysa tekrar eklenmez. */
export async function registerAdminSetupCode(deps: Deps): Promise<void> {
  const code = deps.config.adminSetupCode;
  if (!code) return;
  await deps.db.insert(adminSetupCodes).values({ codeHash: sha256(code) }).onConflictDoNothing();
}
