"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CityViewProps } from "./types";
import { SceneEngine } from "./engine";
import CityMap2D from "../map2d/CityMap2D";

export interface CityViewExtraProps {
  /** oyuncunun şirket seviyesi: verilirse seviyesi yetmeyen boş arsalar kilitli görünür */
  myLevel?: number;
  /** WebGL başlatılamazsa veya bağlam kaybolursa çağrılır (bileşen kendi 2D haritasına düşer) */
  onWebglFail?: () => void;
}

const ARIA = {
  tr: "Şehir haritası 3D görünümü. Sürükleyerek kaydırın, iki parmakla yakınlaştırın. Klavye için 2D haritayı kullanın.",
  en: "3D city map. Drag to pan, pinch to zoom. Use the 2D map for keyboard access.",
};

/**
 * 3D sahne. quality "lite" veya WebGL başarısızsa SVG haritaya düşer.
 * Sahne yalnızca quality veya şehir/yol düzeni değişince yeniden kurulur;
 * veri, seçim ve odak değişimleri motora iletilir.
 */
export default function CityView(props: CityViewProps & CityViewExtraProps) {
  const { world, map, serverOffsetMs, quality, myCompanyId, focusCityId, selected, onSelect, locale, myLevel, onWebglFail } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const [failed, setFailed] = useState(false);

  const latest = useRef({ map, myCompanyId, myLevel, serverOffsetMs, selected, focusCityId, locale, onSelect, onWebglFail });
  latest.current = { map, myCompanyId, myLevel, serverOffsetMs, selected, focusCityId, locale, onSelect, onWebglFail };

  const layoutSig = useMemo(
    () => JSON.stringify([world.cities.map((c) => [c.id, c.map.x, c.map.z, c.color]), world.roads.map((r) => [r.a, r.b]), world.products.map((p) => [p.id, p.color])]),
    [world.cities, world.roads, world.products],
  );
  const worldRef = useRef(world);
  worldRef.current = world;

  const use3d = quality !== "lite" && !failed;

  useEffect(() => {
    if (!use3d) return;
    const host = hostRef.current, layer = labelsRef.current;
    if (!host || !layer) return;
    let engine: SceneEngine;
    const fail = () => { setFailed(true); latest.current.onWebglFail?.(); };
    try {
      engine = new SceneEngine({
        host, labelLayer: layer, world: worldRef.current, quality: quality === "high" ? "high" : "low", locale: latest.current.locale,
        cb: { onSelect: (s) => latest.current.onSelect(s), onFail: fail },
      });
    } catch {
      fail();
      return;
    }
    engineRef.current = engine;
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __cfScene: engine });
    const l = latest.current;
    engine.setServerOffset(l.serverOffsetMs);
    engine.setData(l.map, l.myCompanyId, l.myLevel);
    engine.setSelected(l.selected);
    engine.setFocus(l.focusCityId, true);

    let visible = true;
    let inView = true;
    const sync = () => engine.setActive(visible && inView);
    const onVis = () => { visible = document.visibilityState === "visible"; sync(); };
    document.addEventListener("visibilitychange", onVis);
    const io = new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); sync(); });
    io.observe(host);
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(host);
    onVis();

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io.disconnect();
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [use3d, quality, layoutSig]);

  useEffect(() => { engineRef.current?.setServerOffset(serverOffsetMs); }, [serverOffsetMs]);
  useEffect(() => { engineRef.current?.setData(map, myCompanyId, myLevel); }, [map, myCompanyId, myLevel, use3d, quality, layoutSig]);
  useEffect(() => { engineRef.current?.setSelected(selected); }, [selected]);
  useEffect(() => { engineRef.current?.setFocus(focusCityId); }, [focusCityId]);
  useEffect(() => { engineRef.current?.setLocale(locale); }, [locale]);

  if (!use3d) return <CityMap2D {...props} myLevel={myLevel} />;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#0b121b" }}>
      <div ref={hostRef} role="img" aria-label={ARIA[locale]} style={{ position: "absolute", inset: 0 }} />
      <div ref={labelsRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />
    </div>
  );
}
