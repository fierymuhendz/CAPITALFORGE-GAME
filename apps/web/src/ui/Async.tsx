"use client";
import type { ReactNode } from "react";
import type { Resource } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Button, EmptyState, SkeletonList } from "./Basic";

/** Yükleniyor → iskelet; hata → açıklama + tekrar dene (çökmez); veri → çocuk fonksiyon */
export function Async<T>({ res, children, skeleton }: { res: Resource<T>; children: (d: T) => ReactNode; skeleton?: ReactNode }) {
  const i = useT();
  if (res.data) return <>{children(res.data)}</>;
  if (res.error) {
    return (
      <EmptyState icon="x" title={i.err(res.error)} text={i.t(res.error.status === 404 ? "common.notReady" : "common.loadFailed")}
        action={<Button onClick={res.reload}>{i.t("common.retry")}</Button>} />
    );
  }
  return <>{skeleton ?? <SkeletonList />}</>;
}
