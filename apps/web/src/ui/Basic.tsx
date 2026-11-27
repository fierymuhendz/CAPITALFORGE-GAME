"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { Icon } from "./icons";

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: boolean;
  loading?: boolean;
  href?: string;
  className?: string;
};

export function Button({ variant = "secondary", size = "md", block, icon, loading, href, className, children, disabled, type, ...rest }: BtnProps) {
  const cls = ["btn", variant === "secondary" ? "" : variant, size === "md" ? "" : size, block ? "block" : "", icon ? "icon" : "", className ?? ""].filter(Boolean).join(" ");
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return (
    <button type={type ?? "button"} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = "", onClick, selected, tight, flat, as }: { children: ReactNode; className?: string; onClick?: () => void; selected?: boolean; tight?: boolean; flat?: boolean; as?: "section" | "div" }) {
  const cls = `card ${onClick ? "click" : ""} ${selected ? "sel" : ""} ${tight ? "tight" : ""} ${flat ? "flat" : ""} ${className}`;
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-pressed={selected}>{children}</button>;
  const Tag = as ?? "div";
  return <Tag className={cls}>{children}</Tag>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className={`v ${tone ?? ""}`}>{value}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return <div className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "system" | "good" | "bad" | "warn" | "forge" }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}

export function SystemBadge() {
  const { t } = useT();
  return <span className="badge system" title={t("common.systemHint")}>{t("common.system")}</span>;
}

/** Kâr/zarar: işaret + ok + renk (renk tek bilgi değildir) */
export function Trend({ value, text }: { value: string | number; text: string }) {
  const n = typeof value === "string" ? BigInt(value) : BigInt(Math.round(value));
  const dir = n > 0n ? "up" : n < 0n ? "down" : "flat";
  return (
    <span className={`trend ${dir === "up" ? "good" : dir === "down" ? "bad" : ""}`}>
      <Icon name={dir} size={14} />
      {text}
    </span>
  );
}

export function Notice({ tone, children }: { tone?: "warn" | "bad" | "good" | "steel"; children: ReactNode }) {
  return <div className={`notice ${tone ?? ""}`} role={tone === "bad" ? "alert" : undefined}>{children}</div>;
}

export function EmptyState({ icon = "box", title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="ico" aria-hidden="true"><Icon name={icon} size={32} /></span>
      <h4>{title}</h4>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

export function ProgressBar({ value, steel, label }: { value: number; steel?: boolean; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return <div className={`progress ${steel ? "steel" : ""}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${v}%` }} /></div>;
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skel" style={{ height: h, width: w }} aria-hidden="true" />;
}
export function SkeletonList({ n = 3, h = 64 }: { n?: number; h?: number }) {
  return <div className="col" aria-busy="true">{Array.from({ length: n }, (_, i) => <Skeleton key={i} h={h} />)}</div>;
}

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="col tight" style={{ gap: "var(--sp-3)" }}>
      <div className="row between"><h3 style={{ fontSize: "var(--fs-md)" }}>{title}</h3>{action}</div>
      {children}
    </section>
  );
}

/** Açılır ayrıntı (bir dokunuşla). Yerel <details>: klavye ve ekran okuyucu uyumlu. */
export function Disclosure({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="disc" open={open}>
      <summary>{summary}</summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}

/** Kısa etiket: simge + metin (renk tek bilgi değildir). */
export function Tag({ children, tone, icon, title }: { children: ReactNode; tone?: "good" | "warn" | "forge" | "steel"; icon?: string; title?: string }) {
  return <span className={`tag ${tone ?? ""}`} title={title}>{icon ? <Icon name={icon} size={12} /> : null}{children}</span>;
}

/** Alt eylem çubuğu: panel/diyalog kayarken birincil eylem hep görünür. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="action-bar">{children}</div>;
}

export type StatusKind = "run" | "idle" | "stop" | "road" | "attn" | "build";
/** Durum: renk + şekil + metin (renk körlüğünde ve gri tonda da ayırt edilir). */
export function Status({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return <span className={`st st-${kind}`}><i aria-hidden="true" />{children}</span>;
}
