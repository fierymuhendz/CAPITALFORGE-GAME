"use client";
import type { NotificationDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Button, EmptyState } from "@/ui";
import { useRouter } from "next/navigation";

/** Sunucu bağlantısı: /play?tab=<panel>[&id=...]; yalnızca oyun içi yollar izlenir. */
function playLink(link: string | null): string | null {
  return link && link.startsWith("/play") ? link : null;
}

export function NotificationsPanel() {
  const i = useT();
  const { t } = i;
  const { run, busy } = useAction();
  const router = useRouter();
  const res = useData<NotificationDto[]>("/notifications", undefined, ["notifications"]);
  return (
    <Async res={res}>
      {(list) => !list.length ? <EmptyState icon="bell" title={t("notifications.emptyTitle")} text={t("notifications.emptyText")} /> : (
        <div className="col">
          {list.some((n) => !n.read) ? <Button size="sm" loading={busy} onClick={() => void run(() => api.post("/notifications/read", { all: true }))}>{t("notifications.markAll")}</Button> : null}
          {list.map((n) => {
            const target = playLink(n.link);
            return (
              <div key={n.id} className="li" style={{ alignItems: "flex-start" }}>
                <span className="dot" style={{ background: n.read ? "var(--line-strong)" : "var(--forge)", marginTop: 6 }} aria-label={n.read ? t("notifications.read") : t("notifications.unread")} />
                <div className="grow col tight">
                  <span style={{ fontWeight: n.read ? 400 : 600 }}>{i.notif(n)}</span>
                  <span className="xs muted">{i.date(n.at)}</span>
                </div>
                {target ? <Button size="sm" variant="ghost" onClick={() => { if (!n.read) void api.post("/notifications/read", { ids: [n.id] }).catch(() => undefined); router.push(target); }}>{t("notifications.open")}</Button> : null}
              </div>
            );
          })}
        </div>
      )}
    </Async>
  );
}
