"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { translate, type PlotDto, type VehicleMapDto } from "@capitalforge/shared";
import type { CitySelection, CityViewProps } from "../scene/types";
import {
  CELL, PAD_HALF, cityCenters, hashStr, parkIndexes, plotOffset, roadEndpoints, vehiclePose, worldBounds, type CityCenters,
} from "../scene/layout";
import { PAL } from "../scene/palette";

export interface CityMap2DProps extends CityViewProps {
  /** oyuncunun şirket seviyesi (verilirse seviyesi yetmeyen arsalar kilitli görünür) */
  myLevel?: number;
}

const T = {
  tr: {
    map: "Şehir haritası", city: "Şehir", plot: "Arsa", freePlot: "Boş arsa, satılık", level: "seviye", mine: "benim",
    owner: "sahibi", system: "sistem", locked: "şirket seviyesi yetersiz", needsLevel: "gereken seviye",
    moving: "yolda", parked: "park halinde", loading: "yükleniyor", to: "hedef",
    zoomIn: "Yakınlaştır", zoomOut: "Uzaklaştır", reset: "Tüm ülke",
    field: "Tarla", barn: "Ahır", mine_: "Maden ocağı", food_plant: "Gıda fabrikası", steel_mill: "Çelikhane", garage: "Garaj",
    constructing: "inşaatta", working: "çalışıyor", stalled: "durdu", idle: "boşta", upgrading: "yükseltiliyor",
    van: "Kamyonet", truck: "Kamyon", semi: "Tır", vehicle: "Araç",
  },
  en: {
    map: "City map", city: "City", plot: "Plot", freePlot: "Empty plot, for sale", level: "level", mine: "mine",
    owner: "owner", system: "system", locked: "company level too low", needsLevel: "required level",
    moving: "in transit", parked: "parked", loading: "loading", to: "to",
    zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Whole country",
    field: "Field", barn: "Dairy barn", mine_: "Mine", food_plant: "Food plant", steel_mill: "Steel mill", garage: "Garage",
    constructing: "under construction", working: "working", stalled: "stalled", idle: "idle", upgrading: "upgrading",
    van: "Van", truck: "Truck", semi: "Semi-trailer", vehicle: "Vehicle",
  },
} as const;
type Dict = (typeof T)["tr"] | (typeof T)["en"];

function typeName(d: Dict, type: string): string {
  switch (type) {
    case "field": return d.field;
    case "barn": return d.barn;
    case "mine": return d.mine_;
    case "food_plant": return d.food_plant;
    case "steel_mill": return d.steel_mill;
    case "garage": return d.garage;
    default: return type;
  }
}
function statusName(d: Dict, s: string): string {
  switch (s) {
    case "constructing": return d.constructing;
    case "working": return d.working;
    case "stalled": return d.stalled;
    case "upgrading": return d.upgrading;
    default: return d.idle;
  }
}
function modelName(d: Dict, m: string): string { return m === "van" ? d.van : m === "truck" ? d.truck : m === "semi" ? d.semi : d.vehicle; }

const CSS = `
.cf2d-pulse{animation:cf2d-p 1.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.cf2d-dash{animation:cf2d-d 1.2s linear infinite}
@keyframes cf2d-p{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes cf2d-d{to{stroke-dashoffset:-1}}
.cf2d-btn{cursor:pointer;outline:none}
.cf2d-btn:focus-visible .cf2d-focus{stroke:#fff;stroke-width:.07;opacity:1}
.cf2d-focus{fill:none;stroke:none;opacity:0}
@media (prefers-reduced-motion:reduce){.cf2d-pulse,.cf2d-dash{animation:none}}
`;

function activate(e: KeyboardEvent, fn: () => void): void {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
}

/* ---------------------------------------------------------------- bina simgeleri */

function Glyph({ type, level, crop }: { type: string; level: number; crop: string }): ReactNode {
  const ore = crop;
  const L = Math.max(1, Math.min(3, level));
  switch (type) {
    case "field": {
      const n = 3 + L;
      return (
        <g>
          <rect x={-0.5} y={-0.5} width={1} height={1} fill={PAL.soil} />
          {Array.from({ length: n }, (_, i) => (
            <rect key={i} x={-0.42 + (0.84 / n) * i} y={-0.44} width={0.84 / n - 0.05} height={0.88} fill={i % 2 ? crop : "#c79b36"} />
          ))}
        </g>
      );
    }
    case "barn":
      return (
        <g>
          <rect x={-0.4} y={-0.12} width={0.62} height={0.5} fill={PAL.barnRed} />
          <polygon points="-0.46,-0.12 -0.09,-0.46 0.28,-0.12" fill={PAL.roofDark} />
          <circle cx={0.34} cy={0.04} r={0.15} fill={PAL.steel} />
          {[0, 1, 2].map((i) => <rect key={i} x={-0.4 + i * 0.22} y={0.34} width={0.16} height={0.1} rx={0.03} fill={PAL.white} stroke="#222" strokeWidth={0.02} />)}
          {L >= 3 && <circle cx={0.34} cy={-0.27} r={0.12} fill={PAL.concrete} />}
        </g>
      );
    case "mine":
      return (
        <g>
          <polygon points="-0.26,0.38 0,-0.44 0.26,0.38" fill="none" stroke={PAL.steel} strokeWidth={0.07} />
          <line x1={-0.18} y1={0.12} x2={0.18} y2={0.12} stroke={PAL.steel} strokeWidth={0.05} />
          <circle cx={0} cy={-0.3} r={0.12} fill="none" stroke={PAL.forge} strokeWidth={0.06} />
          <polygon points="-0.5,0.42 -0.28,0.0 -0.06,0.42" fill={ore} />
          {L >= 2 && <polygon points="0.1,0.42 0.28,0.1 0.46,0.42" fill={ore} opacity={0.7} />}
          {L >= 3 && <rect x={-0.48} y={-0.3} width={0.14} height={0.14} fill={PAL.concrete} />}
        </g>
      );
    case "food_plant":
      return (
        <g>
          <rect x={-0.46} y={-0.05} width={0.64} height={0.42} fill="#cfd8dc" />
          <rect x={-0.46} y={0.1} width={0.64} height={0.08} fill="#3a7bd5" />
          <polygon points="-0.46,-0.05 -0.35,-0.25 -0.25,-0.05 -0.14,-0.25 -0.03,-0.05 0.08,-0.25 0.18,-0.05" fill={PAL.roofDark} />
          <circle cx={0.34} cy={-0.18} r={0.12} fill={PAL.white} />
          <circle cx={0.34} cy={0.12} r={0.12} fill={PAL.white} />
          {L >= 2 && <circle cx={0.34} cy={0.38} r={0.1} fill={PAL.white} />}
          {L >= 3 && <rect x={-0.46} y={-0.42} width={0.2} height={0.2} fill="#b7c3cc" />}
        </g>
      );
    case "steel_mill":
      return (
        <g>
          <rect x={-0.46} y={0.0} width={0.6} height={0.38} fill="#3c4650" />
          <rect x={0.18} y={-0.2} width={0.28} height={0.58} fill="#4b3a33" />
          <rect x={0.24} y={0.08} width={0.16} height={0.14} fill={PAL.forge} />
          <rect x={-0.38} y={-0.46} width={0.14} height={0.5} fill={PAL.white} />
          <rect x={-0.38} y={-0.46} width={0.14} height={0.1} fill="#c0392b" />
          <rect x={-0.38} y={-0.28} width={0.14} height={0.1} fill="#c0392b" />
          {L >= 2 && <rect x={-0.16} y={-0.34} width={0.1} height={0.36} fill={PAL.white} />}
        </g>
      );
    case "garage":
      return (
        <g>
          <rect x={-0.44} y={-0.12} width={0.88} height={0.5} fill="#9aa7b4" />
          <path d="M-0.5 -0.12 Q0 -0.5 0.5 -0.12 Z" fill="#59626c" />
          <rect x={-0.26} y={0.06} width={0.52} height={0.32} fill="#0e1216" />
          <line x1={-0.26} y1={0.1} x2={0.26} y2={0.1} stroke={PAL.forge} strokeWidth={0.04} />
          {L >= 2 && <rect x={0.44} y={-0.02} width={0.12} height={0.4} fill="#b7c3cc" />}
          <rect x={-0.4} y={0.4} width={0.2} height={0.1} rx={0.03} fill={PAL.forge} /><rect x={-0.1} y={0.4} width={0.3} height={0.1} rx={0.03} fill="#d7dde3" /><rect x={0.26} y={0.4} width={0.2} height={0.1} rx={0.03} fill="#d7dde3" />
        </g>
      );
    default:
      return <rect x={-0.35} y={-0.35} width={0.7} height={0.7} fill={PAL.concrete} />;
  }
}

function Badge({ status }: { status: string }): ReactNode {
  const base = { x: 0.42, y: -0.42 };
  switch (status) {
    case "working":
      return <g transform={`translate(${base.x} ${base.y})`}><circle r={0.2} fill="#14301f" stroke="#4ade80" strokeWidth={0.05} /><polygon className="cf2d-pulse" points="-0.06,-0.1 0.11,0 -0.06,0.1" fill="#4ade80" /></g>;
    case "stalled":
      return <g transform={`translate(${base.x} ${base.y})`}><polygon points="0,-0.26 0.26,0.2 -0.26,0.2" fill={PAL.warn} stroke="#1a1a1a" strokeWidth={0.04} /><rect x={-0.025} y={-0.1} width={0.05} height={0.17} fill="#1a1a1a" /><rect x={-0.025} y={0.1} width={0.05} height={0.05} fill="#1a1a1a" /></g>;
    case "constructing":
      return <g transform={`translate(${base.x} ${base.y})`}><circle r={0.2} fill="#3a2e10" stroke={PAL.scaffold} strokeWidth={0.05} /><path d="M-0.1 0.1 L0.1 -0.1 M-0.1 -0.1 L0.1 0.1" stroke={PAL.scaffold} strokeWidth={0.06} /></g>;
    case "upgrading":
      return <g transform={`translate(${base.x} ${base.y})`}><circle r={0.2} fill="#10243a" stroke="#60a5fa" strokeWidth={0.05} /><polygon className="cf2d-pulse" points="0,-0.11 0.1,0.04 -0.1,0.04" fill="#60a5fa" /><rect x={-0.035} y={0.04} width={0.07} height={0.08} fill="#60a5fa" /></g>;
    default:
      return <g transform={`translate(${base.x} ${base.y})`}><circle r={0.2} fill="#1d242c" stroke="#8a97a6" strokeWidth={0.05} /><rect x={-0.09} y={-0.09} width={0.06} height={0.18} fill="#8a97a6" /><rect x={0.03} y={-0.09} width={0.06} height={0.18} fill="#8a97a6" /></g>;
  }
}

/* ---------------------------------------------------------------- arsa */

interface PlotCellProps {
  plot: PlotDto;
  x: number; z: number;
  mine: boolean;
  locked: boolean;
  selectedPlot: boolean;
  selectedFacility: boolean;
  cityName: string;
  colorOf: (id: string | null | undefined) => string | undefined;
  d: Dict;
  suppress: React.MutableRefObject<boolean>;
  onSelect: (s: CitySelection) => void;
}

const PlotCell = memo(function PlotCell({ plot, x, z, mine, locked, selectedPlot, selectedFacility, cityName, colorOf, d, suppress, onSelect }: PlotCellProps) {
  const b = plot.building;
  const fill = mine ? "#6a4e38" : plot.owner?.isSystem ? PAL.tileSystem : plot.owner ? PAL.tileOther : locked || plot.minLevel >= 3 ? PAL.tileLockedHigh : plot.minLevel === 2 ? PAL.tileLockedMid : PAL.tile;
  const pos = `${plot.gx + 1}-${plot.gz + 1}`;
  const ownerTxt = plot.owner ? `${plot.owner.isSystem ? d.system : plot.owner.companyName}${mine ? `, ${d.mine}` : ""}` : null;
  const plotLabel = plot.owner
    ? `${d.plot} ${cityName} ${pos}, ${d.owner}: ${ownerTxt}`
    : `${d.freePlot}, ${cityName} ${pos}${plot.minLevel > 1 ? `, ${d.needsLevel} ${plot.minLevel}` : ""}${locked ? `, ${d.locked}` : ""}`;
  const outCol = colorOf(b?.outputProductId);
  const crop = b?.type === "mine"
    ? (outCol ?? (plot.deposit?.kind === "coal" ? PAL.oreCoal : PAL.oreIron))
    : (outCol ?? (b && hashStr(b.id) % 2 === 0 ? PAL.grain : PAL.fodder));
  const sz = CELL - 0.2;
  const pick = (s: CitySelection) => () => { if (!suppress.current) onSelect(s); };
  const selP = { type: "plot", plotId: plot.id } as const;
  return (
    <g transform={`translate(${x} ${z})`}>
      <g
        className="cf2d-btn" role="button" tabIndex={0} aria-label={plotLabel} aria-pressed={selectedPlot}
        onClick={pick(selP)} onKeyDown={(e) => activate(e, pick(selP))}
      >
        <rect x={-sz / 2} y={-sz / 2} width={sz} height={sz} rx={0.06} fill={fill} stroke={mine ? PAL.forge : "none"} strokeWidth={mine ? 0.1 : 0} />
        {!plot.owner && (
          <g opacity={0.6}>
            <rect x={-sz / 2 + 0.05} y={-sz / 2 + 0.05} width={sz - 0.1} height={sz - 0.1} rx={0.04} fill="none" stroke={locked ? "#e5604f" : "#7d8c9c"} strokeWidth={0.04} strokeDasharray="0.14 0.1" />
            {/* satılık işareti: ok yerine "$" benzeri tabela; kilitliyse çarpı */}
            {locked
              ? <path d="M-0.18 -0.18 L0.18 0.18 M0.18 -0.18 L-0.18 0.18" stroke="#e5604f" strokeWidth={0.07} />
              : <g><rect x={-0.2} y={-0.14} width={0.4} height={0.22} fill={plot.minLevel >= 3 ? "#e0b84f" : plot.minLevel === 2 ? "#3a7bd5" : "#3fa34d"} /><rect x={-0.025} y={0.08} width={0.05} height={0.2} fill={PAL.concrete} /></g>}
            {plot.minLevel > 1 && <text x={0} y={-0.02} textAnchor="middle" fontSize={0.2} fontWeight={700} fill="#fff" style={{ pointerEvents: "none" }}>{plot.minLevel}</text>}
          </g>
        )}
        <rect className="cf2d-focus" x={-sz / 2} y={-sz / 2} width={sz} height={sz} rx={0.06} />
      </g>
      {selectedPlot && <rect x={-0.66} y={-0.66} width={1.32} height={1.32} rx={0.08} fill="none" stroke={PAL.forge} strokeWidth={0.1} strokeDasharray="0.3 0.2" className="cf2d-dash" pathLength={undefined} style={{ pointerEvents: "none" }} />}
      {b && (
        <g
          className="cf2d-btn" role="button" tabIndex={0} aria-pressed={selectedFacility}
          aria-label={`${typeName(d, b.type)}, ${d.level} ${b.level}, ${statusName(d, b.status)}${mine ? `, ${d.mine}` : ownerTxt ? `, ${ownerTxt}` : ""}, ${cityName} ${pos}`}
          transform="scale(0.9)"
          onClick={pick({ type: "facility", facilityId: b.id, plotId: plot.id })}
          onKeyDown={(e) => activate(e, pick({ type: "facility", facilityId: b.id, plotId: plot.id }))}
        >
          <rect x={-0.5} y={-0.5} width={1} height={1} fill="transparent" />
          <Glyph type={b.type} level={b.level} crop={crop} />
          {b.status === "constructing" && <rect x={-0.5} y={-0.5} width={1} height={1} fill="#000" opacity={0.35} />}
          {b.status === "constructing" && <rect x={-0.5} y={-0.5} width={1} height={1} fill="none" stroke={PAL.scaffold} strokeWidth={0.06} strokeDasharray="0.12 0.08" />}
          {b.status === "stalled" && <rect x={-0.52} y={-0.52} width={1.04} height={1.04} fill="none" stroke={PAL.warn} strokeWidth={0.07} />}
          <g opacity={mine ? 1 : 0.7} transform={mine ? "translate(-0.06 0.06) scale(1.3)" : undefined}><Badge status={b.status} /></g>
          {Array.from({ length: b.level }, (_, i) => <rect key={i} x={-0.46 + i * 0.14} y={0.5} width={0.1} height={0.1} fill={mine ? PAL.forge : "#c3ccd6"} />)}
          <rect className="cf2d-focus" x={-0.54} y={-0.54} width={1.08} height={1.08} rx={0.05} />
        </g>
      )}
      {selectedFacility && <rect x={-0.66} y={-0.66} width={1.32} height={1.32} rx={0.08} fill="none" stroke={PAL.forge} strokeWidth={0.1} style={{ pointerEvents: "none" }} />}
    </g>
  );
});

/* ---------------------------------------------------------------- araçlar */

const VLEN: Record<string, number> = { van: 0.5, truck: 0.85, semi: 1.4 };
const VWID: Record<string, number> = { van: 0.26, truck: 0.34, semi: 0.38 };

function useTick(ms: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    let id = 0;
    const run = () => { id = window.setInterval(() => setT((n) => n + 1), ms); };
    const onVis = () => { window.clearInterval(id); if (document.visibilityState === "visible") run(); };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [ms]);
  return t;
}

function Vehicles({ vehicles, centers, offsetMs, selectedId, d, cityNames, suppress, onSelect, myCompanyId, colorOf }: {
  vehicles: VehicleMapDto[]; centers: CityCenters; offsetMs: number; selectedId: string | null; d: Dict;
  cityNames: Map<string, string>; suppress: React.MutableRefObject<boolean>; onSelect: (s: CitySelection) => void; myCompanyId: string | null;
  colorOf: (id: string | null | undefined) => string | undefined;
}) {
  useTick(250);
  const park = useMemo(() => parkIndexes(vehicles), [vehicles]);
  const now = Date.now() + offsetMs;
  return (
    <g>
      {vehicles.map((v) => {
        const pose = vehiclePose(v, centers, now, park.get(v.id) ?? 0);
        if (!pose) return null;
        const mine = v.isMine || (!!myCompanyId && v.ownerCompanyId === myCompanyId);
        const len = VLEN[v.modelId] ?? 0.7;
        const sel = selectedId === v.id;
        const s = v.shipment;
        const state = v.status === "in_transit" && s ? `${d.moving}, ${d.to} ${cityNames.get(s.destCityId) ?? s.destCityId}` : v.status === "loading" ? d.loading : d.parked;
        const label = `${modelName(d, v.modelId)}, ${state}${mine ? `, ${d.mine}` : `, ${v.ownerName}`}`;
        const act = () => { if (!suppress.current) onSelect({ type: "vehicle", vehicleId: v.id }); };
        const wd = VWID[v.modelId] ?? 0.32;
        const cargoCol = colorOf(s?.cargo?.[0]?.productId) ?? PAL.concrete;
        const cabLen = Math.min(0.32, len * 0.35);
        const destName = mine && s && v.status === "in_transit" ? cityNames.get(s.destCityId) : undefined;
        return (
          <g key={v.id}>
            <g
              className="cf2d-btn" role="button" tabIndex={0} aria-label={label} aria-pressed={sel}
              transform={`translate(${pose.x} ${pose.z}) rotate(${(-pose.heading * 180) / Math.PI})`}
              onClick={act} onKeyDown={(e) => activate(e, act)}
            >
              <circle r={0.7} fill="transparent" />
              {mine && <rect x={-wd / 2 - 0.09} y={-len / 2 - 0.09} width={wd + 0.18} height={len + 0.18} rx={0.14} fill="none" stroke={PAL.forge} strokeWidth={0.07} />}
              <rect x={-wd / 2} y={-len / 2} width={wd} height={len - cabLen} rx={0.05} fill={cargoCol} stroke="#0b121b" strokeWidth={0.04} />
              <rect x={-wd / 2} y={len / 2 - cabLen} width={wd} height={cabLen} rx={0.06} fill={mine ? PAL.mineVeh : PAL.otherVeh} stroke="#0b121b" strokeWidth={0.04} />
              <rect x={-wd / 2 + 0.04} y={len / 2 - 0.12} width={wd - 0.08} height={0.07} rx={0.02} fill="#9fd0ff" />
              {pose.moving && <polygon points={`0,${len / 2 + 0.18} 0.1,${len / 2 + 0.04} -0.1,${len / 2 + 0.04}`} fill="#fff" opacity={0.85} />}
              {sel && <circle r={Math.max(0.6, len * 0.62)} fill="none" stroke={PAL.forge} strokeWidth={0.09} className="cf2d-pulse" />}
              <circle className="cf2d-focus" r={Math.max(0.55, len * 0.6)} />
            </g>
            {destName && (
              <text x={pose.x} y={pose.z - len / 2 - 0.3} textAnchor="middle" fontSize={0.34} fontWeight={700} fill="#fff" stroke="#0b121b" strokeWidth={0.08} paintOrder="stroke" style={{ pointerEvents: "none" }}>
                {`${translate(d === T.tr ? "tr" : "en", "city3d.to")} ${destName}`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ---------------------------------------------------------------- harita */

interface View { cx: number; cz: number; w: number }

export default function CityMap2D(props: CityMap2DProps) {
  const { world, map, serverOffsetMs, myCompanyId, focusCityId, selected, onSelect, locale, myLevel } = props;
  const d: Dict = T[locale];
  const centers = useMemo(() => cityCenters(world), [world]);
  const bounds = useMemo(() => worldBounds(centers), [centers]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 640 });
  const [view, setView] = useState<View | null>(null);
  const suppress = useRef(false);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const tweenRaf = useRef(0);
  const mapRef = useRef(map);
  mapRef.current = map;

  const prodColor = useMemo(() => new Map(world.products.map((p) => [p.id, p.color])), [world.products]);
  const colorOf = useCallback((id: string | null | undefined) => (id ? prodColor.get(id) : undefined), [prodColor]);
  const cityNames = useMemo(() => new Map(world.cities.map((c) => [c.id, c.name[locale]])), [world.cities, locale]);

  const overview = useCallback((): View => {
    const bw = bounds.maxX - bounds.minX + 2, bh = bounds.maxZ - bounds.minZ + 2;
    const s = sizeRef.current;
    const w = Math.max(bw, (bh * s.w) / s.h);
    return { cx: (bounds.minX + bounds.maxX) / 2, cz: (bounds.minZ + bounds.maxZ) / 2, w };
  }, [bounds]);
  const maxW = useMemo(() => overview().w * 1.25, [overview, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  const animateTo = useCallback((to: View, immediate: boolean) => {
    cancelAnimationFrame(tweenRaf.current);
    const from = viewRef.current;
    if (immediate || !from) { setView(to); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setView({ cx: from.cx + (to.cx - from.cx) * e, cz: from.cz + (to.cz - from.cz) * e, w: from.w + (to.w - from.w) * e });
      if (k < 1) tweenRaf.current = requestAnimationFrame(step);
    };
    tweenRaf.current = requestAnimationFrame(step);
  }, []);

  // odak: ilk kurulum ve focusCityId değişimi
  const lastFocus = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (size.w <= 1) return;
    const first = lastFocus.current === undefined;
    if (!first && lastFocus.current === focusCityId) return;
    lastFocus.current = focusCityId;
    const c = focusCityId ? centers.get(focusCityId) : undefined;
    let to: View = c ? { cx: c.x, cz: c.z + 0.5, w: Math.min(maxW, Math.max(10, (PAD_HALF * 2 + 2.4))) } : overview();
    if (c && myCompanyId) {
      // kendi arsalarıma çerçevele
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of mapRef.current.plots) {
        if (p.cityId !== focusCityId || p.owner?.companyId !== myCompanyId) continue;
        const o = plotOffset(p.gx, p.gz);
        x0 = Math.min(x0, c.x + o.x); x1 = Math.max(x1, c.x + o.x); z0 = Math.min(z0, c.z + o.z); z1 = Math.max(z1, c.z + o.z);
      }
      if (isFinite(x0)) {
        const s = sizeRef.current;
        const w = Math.max(6, x1 - x0 + 3.4, ((z1 - z0 + 3.4) * s.w) / s.h);
        to = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: Math.min(to.w, w) };
      }
    }
    animateTo(to, first);
  }, [focusCityId, centers, size.w, animateTo, overview, maxW, myCompanyId]);
  useEffect(() => () => cancelAnimationFrame(tweenRaf.current), []);

  const vw = view?.w ?? 40;
  const vh = vw * (size.h / size.w);
  const vx = (view?.cx ?? 0) - vw / 2, vz = (view?.cz ?? 0) - vh / 2;

  /* kaydır / yakınlaştır: pointer olayları */
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; lastDist: number } | null>(null);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    const v = viewRef.current;
    if (!v) return;
    const s = sizeRef.current;
    const nw = Math.min(maxW, Math.max(6, v.w * factor));
    const k = nw / v.w;
    // imleç altındaki dünya noktası sabit kalsın
    const wx = v.cx + (px / s.w - 0.5) * v.w, wz = v.cz + (py / s.h - 0.5) * v.w * (s.h / s.w);
    setView({ w: nw, cx: wx - (px / s.w - 0.5) * nw, cz: wz - (py / s.h - 0.5) * nw * (s.h / s.w) });
    void k;
  }, [maxW]);

  const clampView = useCallback((v: View): View => ({
    w: v.w,
    cx: Math.max(bounds.minX - 4, Math.min(bounds.maxX + 4, v.cx)),
    cz: Math.max(bounds.minZ - 4, Math.min(bounds.maxZ + 4, v.cz)),
  }), [bounds]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(tweenRaf.current);
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelAnimationFrame(tweenRaf.current);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, moved: false, lastDist: 0 };
      suppress.current = false;
    } else if (gesture.current) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current.lastDist = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
      gesture.current.moved = true;
      suppress.current = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = ptrs.current.get(e.pointerId);
    const g = gesture.current;
    const v = viewRef.current;
    if (!prev || !g || !v) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.current.set(e.pointerId, cur);
    const s = sizeRef.current;
    if (ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.lastDist > 0 && dist > 0) {
        const r = svgRef.current?.getBoundingClientRect();
        zoomAt(g.lastDist / dist, (a.x + b.x) / 2 - (r?.left ?? 0), (a.y + b.y) / 2 - (r?.top ?? 0));
      }
      g.lastDist = dist;
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 6) {
      g.moved = true;
      suppress.current = true;
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
    }
    if (g.moved) {
      const k = v.w / s.w;
      setView(clampView({ w: v.w, cx: v.cx - (cur.x - prev.x) * k, cz: v.cz - (cur.y - prev.y) * k }));
    }
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) {
      // tıklama olayı pointerup'tan sonra gelir; bayrağı sonra sıfırla
      window.setTimeout(() => { suppress.current = false; }, 0);
      gesture.current = null;
    } else if (ptrs.current.size === 1 && gesture.current) {
      gesture.current.lastDist = 0;
    }
  };

  const plotsByCity = useMemo(() => {
    const m = new Map<string, PlotDto[]>();
    for (const p of map.plots) { const a = m.get(p.cityId) ?? []; a.push(p); m.set(p.cityId, a); }
    return m;
  }, [map.plots]);

  const roads = useMemo(() => world.roads.flatMap((r) => {
    const a = centers.get(r.a), b = centers.get(r.b);
    return a && b ? [{ key: `${r.a}-${r.b}`, ...roadEndpoints(a, b) }] : [];
  }), [world.roads, centers]);

  const selPlotId = selected?.type === "plot" ? selected.plotId : null;
  const selFacilityPlot = selected?.type === "facility" ? selected.plotId : null;
  const selVehicle = selected?.type === "vehicle" ? selected.vehicleId : null;
  const selCity = selected?.type === "city" ? selected.cityId : null;

  const btn = (label: string, onClick: () => void, children: ReactNode) => (
    <button
      type="button" aria-label={label} title={label} onClick={onClick}
      style={{ width: 40, height: 40, borderRadius: 6, border: "1px solid #33475c", background: "rgba(11,18,27,.88)", color: "#eef3f8", font: "600 18px system-ui", cursor: "pointer" }}
    >{children}</button>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: PAL.bg }}>
      <svg
        ref={svgRef} role="group" aria-label={d.map}
        viewBox={`${vx} ${vz} ${vw} ${vh}`} width="100%" height="100%"
        style={{ display: "block", touchAction: "none", userSelect: "none" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      >
        <style>{CSS}</style>
        <rect x={vx - 200} y={vz - 200} width={vw + 400} height={vh + 400} fill={PAL.ground} onClick={() => { if (!suppress.current) onSelect(null); }} />
        {roads.map((r) => (
          <g key={r.key} style={{ pointerEvents: "none" }}>
            <line x1={r.from.x} y1={r.from.z} x2={r.to.x} y2={r.to.z} stroke={PAL.road} strokeWidth={0.5} />
            <line x1={r.from.x} y1={r.from.z} x2={r.to.x} y2={r.to.z} stroke={PAL.roadLine} strokeWidth={0.04} strokeDasharray="0.3 0.4" />
          </g>
        ))}
        {world.cities.map((c) => {
          const p = centers.get(c.id);
          if (!p) return null;
          const sel = selCity === c.id;
          const name = c.name[locale];
          const act = () => { if (!suppress.current) onSelect({ type: "city", cityId: c.id }); };
          return (
            <g key={c.id}>
              <rect x={p.x - PAD_HALF} y={p.z - PAD_HALF} width={PAD_HALF * 2} height={PAD_HALF * 2} fill={PAL.pad} stroke={c.color} strokeWidth={0.12} onClick={act} />
              {(plotsByCity.get(c.id) ?? []).map((pl) => {
                const off = plotOffset(pl.gx, pl.gz);
                const mine = !!myCompanyId && pl.owner?.companyId === myCompanyId;
                const locked = !pl.owner && myLevel !== undefined && pl.minLevel > myLevel;
                return (
                  <PlotCell
                    key={pl.id} plot={pl} x={p.x + off.x} z={p.z + off.z} mine={mine} locked={locked}
                    selectedPlot={selPlotId === pl.id} selectedFacility={selFacilityPlot === pl.id}
                    cityName={name} colorOf={colorOf} d={d} suppress={suppress} onSelect={onSelect}
                  />
                );
              })}
              {sel && <rect x={p.x - PAD_HALF - 0.15} y={p.z - PAD_HALF - 0.15} width={PAD_HALF * 2 + 0.3} height={PAD_HALF * 2 + 0.3} fill="none" stroke={PAL.forge} strokeWidth={0.16} style={{ pointerEvents: "none" }} />}
              <g
                className="cf2d-btn" role="button" tabIndex={0} aria-label={`${d.city}: ${name}`} aria-pressed={sel}
                transform={`translate(${p.x} ${p.z - PAD_HALF - 0.55})`} onClick={act} onKeyDown={(e) => activate(e, act)}
              >
                <rect x={-1.7} y={-0.4} width={3.4} height={0.8} rx={0.12} fill={sel ? PAL.forge : "rgba(11,18,27,.88)"} stroke={c.color} strokeWidth={0.07} />
                <text x={0} y={0.17} textAnchor="middle" fontSize={0.5} fontWeight={700} fill={sel ? "#14100c" : "#eef3f8"} style={{ pointerEvents: "none" }}>{name}</text>
                <rect className="cf2d-focus" x={-1.7} y={-0.4} width={3.4} height={0.8} rx={0.12} />
              </g>
            </g>
          );
        })}
        <Vehicles
          vehicles={map.vehicles} centers={centers} offsetMs={serverOffsetMs} selectedId={selVehicle} d={d}
          cityNames={cityNames} suppress={suppress} onSelect={onSelect} myCompanyId={myCompanyId} colorOf={colorOf}
        />
      </svg>
      <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {btn(d.zoomIn, () => zoomAt(0.75, size.w / 2, size.h / 2), "+")}
        {btn(d.zoomOut, () => zoomAt(1.33, size.w / 2, size.h / 2), "−")}
        {btn(d.reset, () => animateTo(overview(), false), "⌖")}
      </div>
    </div>
  );
}
