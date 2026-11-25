/**
 * Arayüz uçtan uca testleri için ortak yardımcılar (yalnızca test kodu).
 * Önkoşul: web http://localhost:3100 (üretim derlemesi, /api sunucuya vekil), sunucu :2600
 * (ALLOW_TIME_TRAVEL=1, DISABLE_RATE_LIMIT=1, ADMIN_SETUP_CODE=e2e-admin-setup-code-0123456789).
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const { chromium, devices } = require("playwright");

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const WEB = process.env.E2E_WEB ?? "http://localhost:3100";
export const SETUP_CODE = process.env.ADMIN_SETUP_CODE ?? "e2e-admin-setup-code-0123456789";
export const SHOTS = `${ROOT}/docs/screenshots`;
export const PASSWORD = "E2ePassw0rd!xyz";
mkdirSync(SHOTS, { recursive: true });

// ---------- i18n sözlükleri (paylaşılan pakette tek kaynak) ----------
const dump = execFileSync(`${ROOT}/node_modules/.bin/tsx`, ["-e", `import {DICTS} from "${ROOT}/packages/shared/src/i18n/index.ts"; process.stdout.write(JSON.stringify(DICTS))`], { encoding: "utf8", maxBuffer: 1 << 26 });
export const DICTS = JSON.parse(dump);
export function T(locale, key, params) {
  let cur = DICTS[locale];
  for (const p of key.split(".")) { if (cur === undefined || typeof cur === "string") { cur = undefined; break; } cur = cur[p]; }
  if (typeof cur !== "string") throw new Error(`i18n anahtarı yok: ${locale}:${key}`);
  let s = cur;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
const NAMESPACES = Object.keys(DICTS.en).filter((k) => typeof DICTS.en[k] === "object");
/** Görünen metinde çözülmemiş çeviri anahtarı ("market.buy" gibi) arar */
export const RAW_KEY_RE = new RegExp(`(?<![\\w/@.-])(?:${NAMESPACES.join("|")})\\.[A-Za-z_][\\w]*(?:\\.[A-Za-z_]\\w*)*`, "g");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP istemcisi (çerez kavanozlu) ----------
let seq = 0;
const key = () => `e2e-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export class Api {
  constructor() { this.cookie = ""; }
  async req(method, path, body) {
    const res = await fetch(`${WEB}/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-cf-intent": "1", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: method === "GET" ? undefined : JSON.stringify(method === "POST" && body && !body.idempotencyKey ? { idempotencyKey: key(), ...body } : body ?? {}),
    });
    const set = res.headers.get("set-cookie");
    if (set) { const m = /cf_session=([^;]*)/.exec(set); if (m) this.cookie = m[1] ? `cf_session=${m[1]}` : ""; }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* düz metin */ }
    return { status: res.status, json, text };
  }
  async ok(method, path, body) {
    const r = await this.req(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
    return r.json;
  }
  get(path, q) { return this.ok("GET", path + (q ? `?${new URLSearchParams(q)}` : "")); }
  post(path, body) { return this.ok("POST", path, body ?? {}); }
}

export const uniq = (p) => `${p}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24);
export const companyName = (p) => `${p} ${Math.random().toString(36).slice(2, 7)}`.replace(/[0-9]/g, (d) => "abcdefghij"[+d]).slice(0, 40);

export async function register(locale = "tr", prefix = "e2e") {
  const api = new Api();
  const username = uniq(prefix);
  await api.post("/auth/register", { username, password: PASSWORD, locale });
  return { api, username };
}
export async function foundViaApi(api, { sector = "manufacturing", cityId = "korfezkent", name }) {
  const q = { cityId, sector, ...(sector === "manufacturing" ? { starterBuilding: "food_plant" } : {}) };
  const onb = await api.get("/world/onboarding", q);
  const plot = onb.plots.filter((p) => p.eligible).sort((a, b) => Number(a.price) - Number(b.price))[0];
  if (!plot) throw new Error("uygun arsa yok");
  await api.post("/company", { name: name ?? companyName("Test Sirket"), cityId, sector, plotId: plot.id, ...(sector === "manufacturing" ? { starterBuilding: "food_plant" } : {}) });
  return plot;
}

// ---------- TOTP (RFC 6238, node crypto) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32dec(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, "")) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totp(secret, nowMs) { return totpStep(secret, Math.floor(nowMs / 30000)); }
export function totpStep(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", b32dec(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  return ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** Yönetici hesabı: kurulum kodu tek kullanımlık olduğundan bilgiler .admin-state.json içinde saklanıp yeniden kullanılır. */
const STATE = process.env.E2E_ADMIN_STATE ?? `${ROOT}/e2e/ui/.admin-state.json`;
export class Admin {
  static async getOrCreate() {
    const a = new Admin();
    a.api = new Api();
    if (existsSync(STATE)) {
      Object.assign(a, JSON.parse(readFileSync(STATE, "utf8")));
      await a.api.post("/auth/login", { username: a.username, password: PASSWORD });
    } else {
      a.username = uniq("e2eadm");
      a.lastStep = 0;
      await a.api.post("/auth/register", { username: a.username, password: PASSWORD, locale: "en" });
      await a.api.post("/auth/admin/claim", { setupCode: SETUP_CODE });
      const s = await a.api.post("/auth/totp/setup");
      a.secret = s.secret;
      await a.api.post("/auth/totp/enable", { code: await a.nextCode() });
      a.save();
      return a;
    }
    await a.api.post("/auth/totp/verify", { code: await a.nextCode() });
    a.save();
    return a;
  }
  save() { writeFileSync(STATE, JSON.stringify({ username: this.username, secret: this.secret, lastStep: this.lastStep })); }
  async serverNow() { return Date.parse((await this.api.get("/auth/me")).serverTime); }
  /** Sunucu saatine göre, daha önce kullanılmamış (adım > son adım) ve sunucunun kabul ettiği (şimdiki veya +1) TOTP kodu */
  async nextCode() {
    for (;;) {
      const cur = Math.floor((await this.serverNow()) / 30000);
      const step = Math.max((this.lastStep ?? 0) + 1, cur);
      if (step <= cur + 1) { this.lastStep = step; return totpStep(this.secret, step); }
      await sleep(2000);
    }
  }
  advance(minutes) { return this.api.post("/admin/time/advance", { minutes }); }
}

// ---------- Tarayıcı ----------
export const PROFILES = {
  phone: { name: "phone", ctx: { ...devices["iPhone 13"], deviceScaleFactor: 1 } },
  desktop: { name: "desktop", ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
};

/** Her sayfa için konsol/ağ hatalarını toplar. `expect` ile beklenen doğrulama hataları ayıklanır. */
export class Monitor {
  constructor(tag) { this.tag = tag; this.consoleErrors = []; this.api4xx5xx = []; this.pageErrors = []; this.expectedStatus = []; }
  attach(page) {
    page.on("console", (m) => { if (m.type() === "error") this.consoleErrors.push({ text: m.text().slice(0, 300), url: page.url() }); });
    page.on("pageerror", (e) => this.pageErrors.push({ text: String(e.message).slice(0, 300), url: page.url() }));
    page.on("response", async (r) => {
      const u = r.url();
      if (!u.includes("/api/") || r.status() < 400) return;
      const req = r.request();
      let code = "";
      try { code = (await r.json())?.error?.code ?? ""; } catch { /* gövde yok */ }
      this.api4xx5xx.push({ status: r.status(), method: req.method(), path: new URL(u).pathname.replace(/^\/api/, ""), code, page: new URL(page.url()).pathname + new URL(page.url()).search });
    });
  }
  /** Bir adımda beklenen hataları (ör. 401 oturum yok) bu işaretle yut */
  mark() { return { c: this.consoleErrors.length, a: this.api4xx5xx.length, p: this.pageErrors.length }; }
  since(m) { return { console: this.consoleErrors.slice(m.c), api: this.api4xx5xx.slice(m.a), page: this.pageErrors.slice(m.p) }; }
}

export async function newPage(browser, profile, locale, mon, initLocale = locale) {
  const ctx = await browser.newContext({ ...profile.ctx, locale: locale === "tr" ? "tr-TR" : "en-US", timezoneId: "Europe/Istanbul" });
  await ctx.addInitScript((l) => { try { if (!localStorage.getItem("cf-locale")) localStorage.setItem("cf-locale", l); } catch { /* */ } }, initLocale);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  mon?.attach(page);
  return { ctx, page };
}

/** Tarayıcı bağlamına API ile giriş (çerez bağlamda saklanır) */
export async function loginCtx(ctx, username, password = PASSWORD) {
  const r = await ctx.request.post(`${WEB}/api/auth/login`, { headers: { "x-cf-intent": "1", "content-type": "application/json" }, data: { username, password } });
  if (!r.ok()) throw new Error(`giriş başarısız ${r.status()}`);
}

export async function shot(page, name) {
  const file = `${SHOTS}/e2e-${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  return `docs/screenshots/e2e-${name}.png`;
}

/** Görünen metinde ham çeviri anahtarı / undefined / NaN / [object Object] ara */
export async function scanText(page) {
  const txt = await page.evaluate(() => document.body.innerText);
  const raw = [...new Set(txt.match(RAW_KEY_RE) ?? [])];
  const junk = [];
  if (/\bundefined\b/.test(txt)) junk.push("undefined");
  if (/\bNaN\b/.test(txt)) junk.push("NaN");
  if (/\[object Object\]/.test(txt)) junk.push("[object Object]");
  return { raw, junk };
}

/** Telefonda yatay taşma (sayfa genişliğinden taşan öğe) */
export async function overflowX(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

export function saveJson(file, data) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(data, null, 2)); }
