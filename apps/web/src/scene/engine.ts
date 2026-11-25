/**
 * Sahne motoru: three.js'i React'ten ayırır. CityView yalnızca yaşam döngüsünü bağlar.
 * Hiçbir oyun sayısı hesaplanmaz: durum WorldMapDto'dan, araç konumu transitProgress'ten gelir.
 */
import {
  AmbientLight, BoxGeometry, BufferGeometry, Color, DirectionalLight, Fog, GridHelper,
  Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster,
  RingGeometry, Scene, SRGBColorSpace, TOUCH, MOUSE, Vector2, Vector3, WebGLRenderer, Euler, ColorManagement,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { translate, type PlotDto, type VehicleMapDto, type WorldDto, type WorldMapDto } from "@capitalforge/shared";
import type { CitySelection } from "./types";
import { PAL } from "./palette";
import { PartBuilder } from "./geo";
import { buildDef, buildFrame, buildScaffold, buildSign, buildWarning, type BuildingDef } from "./buildings";
import { buildVehicle, vehicleLength, NEUTRAL_CARGO } from "./vehicles";
import {
  CELL, HIGHWAY_WIDTH, PAD_HALF, cityCenters, hashStr, mulberry, parkIndexes, plotOffset, roadEndpoints,
  vehiclePose, worldBounds, type CityCenters,
} from "./layout";

ColorManagement.enabled = true;

export interface EngineCallbacks {
  onSelect: (sel: CitySelection | null) => void;
  onFail: () => void;
}

export interface EngineOptions {
  host: HTMLElement;
  labelLayer: HTMLElement;
  world: WorldDto;
  quality: "high" | "low";
  locale: "tr" | "en";
  cb: EngineCallbacks;
}

const TILE_Y = 0.08;
const CONTENT_Y = TILE_Y + 0.06;
const PAD_H = 0.08;
const MAX_SMOKE = 480;
/** araç ölçeği: ülke görünümünde silüet okunsun */
const VEH_SCALE = 1.7;

interface Spin { mesh: Object3D; kind: "wheel" | "fan" }
interface PlotNode {
  sig: string;
  group: Group;
  spins: Spin[];
  decor: Array<{ geo: BufferGeometry; m: Matrix4 }>;
  glowBoxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>;
  lampBoxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>;
  warn: Mesh | null;
  tractor: Mesh | null;
  smoke: Array<{ x: number; y: number; z: number; dark: boolean; off: number }>;
  buildingMesh: Mesh | null;
  height: number;
  x: number;
  z: number;
}
interface VehNode { group: Group; hit: Mesh; dto: VehicleMapDto; key: string; len: number }
interface Chip { el: HTMLButtonElement; plotId: string; facilityId: string; x: number; y: number; z: number; until: number; status: string; last: string }
const CHIP_CSS = "position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:4px;min-height:30px;min-width:30px;justify-content:center;padding:2px 8px;border-radius:15px;font:700 12px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;will-change:transform;visibility:hidden;touch-action:manipulation;border:2px solid;";
const CHIP_STYLE: Record<string, { bg: string; fg: string; bd: string; icon: string }> = {
  working: { bg: "rgba(16,48,31,.92)", fg: "#b9f6ca", bd: "#4ade80", icon: "\u25B6" },
  idle: { bg: "rgba(255,106,26,.95)", fg: "#1a0f08", bd: "#ffd2b0", icon: "II" },
  stalled: { bg: "rgba(255,212,0,.96)", fg: "#1a1400", bd: "#7a5f00", icon: "!" },
  constructing: { bg: "rgba(58,46,16,.92)", fg: "#f5d98a", bd: "#d8a93a", icon: "#" },
  upgrading: { bg: "rgba(16,36,58,.92)", fg: "#bfdcff", bd: "#60a5fa", icon: "^" },
};

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class SceneEngine {
  private readonly o: EngineOptions;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly high: boolean;
  private readonly centers: CityCenters;
  private readonly cityIds: string[];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly geoCache = new Map<string, BufferGeometry>();
  private readonly defCache = new Map<string, BuildingDef>();
  private readonly raycaster = new Raycaster();
  private readonly matVC: MeshLambertMaterial;
  private readonly matGlow: MeshBasicMaterial;
  private readonly matLamp: MeshBasicMaterial;
  private readonly unitBox: BoxGeometry;
  private readonly wheelGeo: BufferGeometry;
  private readonly fanGeo: BufferGeometry;
  private readonly tractorGeo: BufferGeometry;
  private readonly tiles: InstancedMesh;
  private tileIds: Array<string | undefined>;
  private readonly tileColor = new Color();
  private readonly smoke: InstancedMesh;
  private readonly selFrame: Mesh;
  private readonly selRing: Mesh;
  private readonly padHits: Mesh[] = [];
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly chips = new Map<string, Chip>();
  private styleEl: HTMLStyleElement | null = null;
  private readonly vMarkGeo: BufferGeometry;
  private readonly nodes = new Map<string, PlotNode>();
  private readonly vehicles = new Map<string, VehNode>();
  private readonly plotInfo = new Map<string, { x: number; z: number; cityId: string; facilityId: string | null; hasBuilding: boolean }>();
  private readonly productColor = new Map<string, string>();
  private decorMesh: Mesh | null = null;
  private glowMesh: Mesh | null = null;
  private lampMesh: Mesh | null = null;
  private decorDirty = false;
  private readonly contentRoot = new Group();
  private readonly vehicleRoot = new Group();

  private map: WorldMapDto | null = null;
  private parkIdx = new Map<string, number>();
  private myCompanyId: string | null = null;
  private myLevel: number | undefined;
  private serverOffsetMs = 0;
  private selected: CitySelection | null = null;
  private focusId: string | null = null;
  private tween: null | { t0: number; dur: number; p0: Vector3; p1: Vector3; q0: Vector3; q1: Vector3 } = null;
  private overview = { target: new Vector3(), dist: 60 };
  private readonly polar = 0.95;
  private bounds: ReturnType<typeof worldBounds>;
  private raf = 0;
  private active = false;
  private disposed = false;
  private lastFrame = 0;
  private w = 1;
  private h = 1;
  private down: null | { x: number; y: number; t: number; multi: boolean } = null;
  private pointers = new Set<number>();
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpE = new Euler();
  private readonly tmpV = new Vector3();
  private readonly tmpS = new Vector3();
  private readonly tmpC = new Color();
  private readonly onCtxLost: (e: Event) => void;

  constructor(opts: EngineOptions) {
    this.o = opts;
    this.high = opts.quality === "high";
    this.centers = cityCenters(opts.world);
    this.cityIds = opts.world.cities.map((c) => c.id);
    this.bounds = worldBounds(this.centers);
    for (const p of opts.world.products) this.productColor.set(p.id, p.color);

    this.renderer = new WebGLRenderer({
      antialias: this.high,
      powerPreference: this.high ? "high-performance" : "low-power",
      alpha: false,
    });
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(this.high ? Math.min(2, dpr) : 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(PAL.bg);
    if (this.high) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFSoftShadowMap;
    }
    const el = this.renderer.domElement;
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.touchAction = "none";
    el.style.outline = "none";
    opts.host.appendChild(el);
    this.onCtxLost = (e) => { e.preventDefault(); this.o.cb.onFail(); };
    el.addEventListener("webglcontextlost", this.onCtxLost);

    this.camera = new PerspectiveCamera(45, 1, 0.5, 600);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = 1.3;
    this.controls.minPolarAngle = 0.25;
    this.controls.minDistance = 4;
    this.controls.zoomSpeed = 0.9;
    this.controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener("start", () => { this.tween = null; });

    // ortak malzemeler
    this.matVC = this.track(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.matGlow = this.track(new MeshBasicMaterial({ color: "#ff5a12" }));
    this.matLamp = this.track(new MeshBasicMaterial({ color: "#ffd98a" }));
    this.unitBox = this.track(new BoxGeometry(1, 1, 1));
    this.wheelGeo = this.track(new PartBuilder().torus(1, 0.08, 0, 0, 0, PAL.steel, 0)
      .box(2, 0.12, 0.12, 0, -0.06, 0, PAL.forge).box(0.12, 2, 0.12, 0, -1, 0, PAL.forge).build());
    this.fanGeo = this.track(new PartBuilder().box(2, 0.03, 0.28, 0, 0, 0, PAL.steel).box(0.28, 0.03, 2, 0, 0, 0, PAL.steel).cyl(0.18, 0.18, 0.08, 0, -0.02, 0, PAL.dark, 6).build());
    this.tractorGeo = this.track(new PartBuilder().box(0.12, 0.08, 0.2, 0, 0.04, 0, "#d9892b").box(0.1, 0.07, 0.08, 0, 0.12, -0.04, "#9fd0ff").box(0.14, 0.05, 0.08, 0, 0.0, 0.1, PAL.dark).build());

    this.vMarkGeo = this.track(new PartBuilder()
      .box(0.03, 0.55, 0.03, 0, 0, 0.0, PAL.steel).box(0.2, 0.12, 0.02, 0.1, 0.42, 0, PAL.forge)
      .box(1.0, 0.012, 0.012, 0, 0, 0, PAL.forge).build());
    this.setupLights();
    this.scene.background = new Color(PAL.bg);
    this.buildStatic();

    // arsa zeminleri
    const tileGeo = this.track(new BoxGeometry(CELL - 0.2, 0.06, CELL - 0.2));
    const tileMat = this.track(new MeshLambertMaterial({ color: "#ffffff" }));
    this.tiles = new InstancedMesh(tileGeo, tileMat, Math.max(1, this.cityIds.length * 16));
    this.tiles.receiveShadow = this.high;
    this.tileIds = new Array<string | undefined>(this.cityIds.length * 16).fill(undefined);
    this.tileColor.set(PAL.tile);
    for (let ci = 0; ci < this.cityIds.length; ci++) {
      const c = this.centers.get(this.cityIds[ci] as string);
      if (!c) continue;
      for (let gz = 0; gz < 4; gz++) for (let gx = 0; gx < 4; gx++) {
        const off = plotOffset(gx, gz);
        this.tmpM.makeTranslation(c.x + off.x, TILE_Y + 0.03, c.z + off.z);
        const idx = ci * 16 + gz * 4 + gx;
        this.tiles.setMatrixAt(idx, this.tmpM);
        this.tiles.setColorAt(idx, this.tileColor);
      }
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.scene.add(this.tiles);

    this.scene.add(this.contentRoot, this.vehicleRoot);

    // duman
    const smokeGeo = this.track(new IcosahedronGeometry(0.1, 0));
    const smokeMat = this.track(new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false }));
    this.smoke = new InstancedMesh(smokeGeo, smokeMat, MAX_SMOKE);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.setColorAt(0, this.tmpC.set("#ffffff"));
    this.scene.add(this.smoke);

    // seçim göstergeleri
    const frameMat = this.track(new MeshBasicMaterial({ color: PAL.forge, vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
    this.selFrame = new Mesh(this.track(buildFrame(0.62, 0.07)), frameMat);
    this.selFrame.renderOrder = 10;
    this.selFrame.visible = false;
    const ringMat = this.track(new MeshBasicMaterial({ color: PAL.forge, transparent: true, opacity: 0.95, depthTest: false }));
    const ringGeo = this.track(new RingGeometry(0.42, 0.52, 28));
    ringGeo.rotateX(-Math.PI / 2);
    this.selRing = new Mesh(ringGeo, ringMat);
    this.selRing.renderOrder = 10;
    this.selRing.visible = false;
    this.scene.add(this.selFrame, this.selRing);

    this.buildLabels();
    this.setupPicking();
    this.resize();
    this.placeOverview();
    this.camera.position.copy(this.overview.target).add(this.dirVec().multiplyScalar(this.overview.dist));
    this.controls.target.copy(this.overview.target);
    this.controls.maxDistance = this.overview.dist * 1.3;
    this.scene.fog = new Fog(PAL.fog, this.overview.dist * 0.8, this.overview.dist * 2.6);
    this.controls.update();
  }

  /* ---------------------------------------------------------------- yardımcılar */

  private track<T extends { dispose(): void }>(x: T): T { this.disposables.push(x); return x; }

  private dirVec(az = 0): Vector3 {
    return new Vector3(Math.sin(this.polar) * Math.sin(az), Math.cos(this.polar), Math.sin(this.polar) * Math.cos(az));
  }

  private fit(width: number, depth: number): number {
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const byW = width / (2 * Math.tan(hf / 2));
    const byH = (depth * Math.cos(this.polar) + 3) / (2 * Math.tan(vf / 2));
    return Math.max(byW, byH) * 1.08;
  }

  private placeOverview(): void {
    const b = this.bounds;
    // perspektifte yakın kenar büyür: hedefi biraz güneye kaydır, payı artır
    this.overview.target.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2 + 2.2);
    this.overview.dist = this.fit(b.maxX - b.minX + 3, b.maxZ - b.minZ + 4) * 1.1;
  }

  private setupLights(): void {
    this.scene.add(new HemisphereLight("#9fb6d0", "#1a2330", this.high ? 1.35 : 1.7));
    this.scene.add(new AmbientLight("#ffffff", 0.35));
    const sun = new DirectionalLight("#ffe9cf", this.high ? 2.2 : 1.6);
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    sun.position.set(cx - 22, 40, cz + 18);
    sun.target.position.set(cx, 0, cz);
    this.scene.add(sun, sun.target);
    if (this.high) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.62;
      const cam = sun.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 5; cam.far = 120;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }
  }

  /* ---------------------------------------------------------------- statik dünya */

  private buildStatic(): void {
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const ground = new Mesh(this.track(new PlaneGeometry(400, 400)), this.track(new MeshLambertMaterial({ color: PAL.ground })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.002, cz);
    ground.receiveShadow = this.high;
    this.scene.add(ground);
    const grid = new GridHelper(160, 80, PAL.grid, PAL.grid);
    grid.position.set(Math.round(cx), 0.004, Math.round(cz));
    const gm = grid.material as Material;
    gm.transparent = true; gm.opacity = 0.35;
    this.track(grid.geometry); this.track(gm);
    this.scene.add(grid);

    // şehir zeminleri + kenar şeritleri + direkler
    const city = new PartBuilder();
    for (const c of this.o.world.cities) {
      const p = this.centers.get(c.id);
      if (!p) continue;
      const half = PAD_HALF;
      city.box(half * 2, PAD_H, half * 2, p.x, 0, p.z, PAL.pad);
      const e = 0.09;
      for (const s of [-1, 1]) {
        city.box(half * 2 + e, 0.05, e, p.x, PAD_H, p.z + s * half, c.color);
        city.box(e, 0.05, half * 2 + e, p.x + s * half, PAD_H, p.z, c.color);
      }
      // yol işaretleri (şehir içi sokaklar)
      for (let i = 1; i < 4; i++) {
        const o = (i - 2) * CELL;
        city.box(0.03, 0.005, half * 2 - 0.3, p.x + o, PAD_H, p.z, "#1c242d");
        city.box(half * 2 - 0.3, 0.005, 0.03, p.x, PAD_H, p.z + o, "#1c242d");
      }
      // simge direği (ülke görünümünde okunur)
      const px = p.x + half - 0.15, pz = p.z - half + 0.15;
      city.cyl(0.07, 0.1, 2.0, px, PAD_H, pz, "#39434f");
      city.box(0.3, 0.3, 0.3, px, PAD_H + 2.0, pz, c.color);
      city.cone(0.2, 0.3, px, PAD_H + 2.3, pz, c.color, 4);
    }
    const cityMesh = new Mesh(this.track(city.build()), this.matVC);
    cityMesh.receiveShadow = this.high;
    this.scene.add(cityMesh);

    // otoyollar
    const rd = new PartBuilder();
    const trees: Array<{ a: { x: number; z: number }; b: { x: number; z: number } }> = [];
    for (const r of this.o.world.roads) {
      const a = this.centers.get(r.a), bb = this.centers.get(r.b);
      if (!a || !bb) continue;
      const e = roadEndpoints(a, bb);
      if (e.len <= 0.2) continue;
      const mx = (e.from.x + e.to.x) / 2, mz = (e.from.z + e.to.z) / 2;
      const hd = Math.atan2(e.dir.x, e.dir.z);
      rd.box(HIGHWAY_WIDTH, 0.03, e.len, mx, 0, mz, PAL.road, hd);
      for (const s of [-1, 1]) rd.box(0.025, 0.035, e.len, mx - e.dir.z * s * (HIGHWAY_WIDTH / 2 - 0.03), 0, mz + e.dir.x * s * (HIGHWAY_WIDTH / 2 - 0.03), "#3b434c", hd);
      const n = Math.floor(e.len / 0.7);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        rd.box(0.03, 0.036, 0.3, e.from.x + (e.to.x - e.from.x) * t, 0, e.from.z + (e.to.z - e.from.z) * t, PAL.roadLine, hd);
      }
      trees.push({ a, b: bb });
    }
    const roads = new Mesh(this.track(rd.build()), this.matVC);
    roads.receiveShadow = this.high;
    this.scene.add(roads);

    // şehir tıklama alanları (görünmez)
    for (const c of this.o.world.cities) {
      const p = this.centers.get(c.id);
      if (!p) continue;
      const hit = new Mesh(this.track(new BoxGeometry(PAD_HALF * 2, 0.2, PAD_HALF * 2)), this.track(new MeshBasicMaterial({ visible: false })));
      hit.position.set(p.x, 0.05, p.z);
      hit.userData.sel = { type: "city", cityId: c.id } satisfies CitySelection;
      this.scene.add(hit);
      this.padHits.push(hit);
    }

    // süs: ağaç ve kaya (dağılım deterministik)
    const nTree = this.high ? 170 : 50;
    const nRock = this.high ? 50 : 12;
    const rnd = mulberry(7);
    const treeGeo = this.track(new PartBuilder().cyl(0.04, 0.05, 0.18, 0, 0, 0, "#4a3a2c", 5).cone(0.2, 0.35, 0, 0.14, 0, PAL.tree, 6).cone(0.15, 0.3, 0, 0.35, 0, PAL.treeDark, 6).build());
    const rockGeo = this.track(new PartBuilder().cone(0.2, 0.2, 0, 0, 0, PAL.rock, 5).build());
    const treeMesh = new InstancedMesh(treeGeo, this.matVC, nTree);
    const rockMesh = new InstancedMesh(rockGeo, this.matVC, nRock);
    treeMesh.castShadow = this.high;
    const place = (mesh: InstancedMesh, n: number, minS: number, maxS: number): void => {
      let k = 0, guard = 0;
      while (k < n && guard++ < n * 40) {
        const x = b.minX - 8 + rnd() * (b.maxX - b.minX + 16);
        const z = b.minZ - 8 + rnd() * (b.maxZ - b.minZ + 16);
        let ok = true;
        for (const c of this.centers.values()) {
          if (Math.abs(x - c.x) < PAD_HALF + 1.3 && Math.abs(z - c.z) < PAD_HALF + 2.4) { ok = false; break; }
        }
        if (ok) for (const r of trees) {
          const dx = r.b.x - r.a.x, dz = r.b.z - r.a.z;
          const t = Math.max(0, Math.min(1, ((x - r.a.x) * dx + (z - r.a.z) * dz) / (dx * dx + dz * dz)));
          if (Math.hypot(x - (r.a.x + dx * t), z - (r.a.z + dz * t)) < 0.9) { ok = false; break; }
        }
        if (!ok) continue;
        const s = minS + rnd() * (maxS - minS);
        this.tmpE.set(0, rnd() * 6.28, 0);
        this.tmpQ.setFromEuler(this.tmpE);
        this.tmpM.compose(this.tmpV.set(x, 0, z), this.tmpQ, this.tmpS.set(s, s * (0.8 + rnd() * 0.5), s));
        mesh.setMatrixAt(k++, this.tmpM);
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    };
    place(treeMesh, nTree, 0.9, 1.7);
    place(rockMesh, nRock, 0.8, 2.2);
    this.track(treeMesh); this.track(rockMesh);
  }

  private buildLabels(): void {
    const st = document.createElement("style");
    st.textContent = "@keyframes cf3d-chip{0%,100%{transform-origin:center;opacity:1}50%{opacity:.55}}@media (prefers-reduced-motion:reduce){[data-facility-id]{animation:none!important}}";
    this.o.labelLayer.appendChild(st);
    this.styleEl = st;
    for (const c of this.o.world.cities) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.cityId = c.id;
      btn.style.cssText = [
        "position:absolute", "left:0", "top:0", "pointer-events:auto", "cursor:pointer", "white-space:nowrap",
        "padding:3px 9px 3px 8px", "font:600 12px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        "color:#eef3f8", "background:rgba(11,18,27,.82)", `border:0`, `border-left:3px solid ${c.color}`,
        "border-radius:3px", "text-shadow:0 1px 2px #000", "will-change:transform", "visibility:hidden",
        "min-height:26px", "touch-action:manipulation",
      ].join(";");
      btn.textContent = c.name[this.o.locale];
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.o.cb.onSelect({ type: "city", cityId: c.id }); });
      this.o.labelLayer.appendChild(btn);
      this.labels.set(c.id, btn);
    }
  }

  setLocale(locale: "tr" | "en"): void {
    this.o.locale = locale;
    for (const c of this.chips.values()) c.status = "";
    if (this.map) this.syncChips(this.map);
    for (const c of this.o.world.cities) {
      const b = this.labels.get(c.id);
      if (b) b.textContent = c.name[locale];
    }
  }

  /* ---------------------------------------------------------------- veri */

  private geo(key: string, make: () => BufferGeometry): BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) { g = make(); this.geoCache.set(key, g); this.track(g); }
    return g;
  }

  private def(type: string, level: number, crop: string): BuildingDef {
    const key = `${type}:${level}:${crop}`;
    let d = this.defCache.get(key);
    if (!d) { d = buildDef(type, level, crop); this.defCache.set(key, d); this.track(d.geometry); }
    return d;
  }

  setServerOffset(ms: number): void { this.serverOffsetMs = ms; }

  setData(map: WorldMapDto, myCompanyId: string | null, myLevel: number | undefined): void {
    this.map = map;
    this.myCompanyId = myCompanyId;
    this.myLevel = myLevel;
    const seen = new Set<string>();
    this.plotInfo.clear();
    for (const p of map.plots) {
      const ci = this.cityIds.indexOf(p.cityId);
      const c = this.centers.get(p.cityId);
      if (ci < 0 || !c || p.gx < 0 || p.gx > 3 || p.gz < 0 || p.gz > 3) continue;
      seen.add(p.id);
      const off = plotOffset(p.gx, p.gz);
      const x = c.x + off.x, z = c.z + off.z;
      this.plotInfo.set(p.id, { x, z, cityId: p.cityId, facilityId: p.building?.id ?? null, hasBuilding: !!p.building });
      const mine = !!myCompanyId && p.owner?.companyId === myCompanyId;
      const locked = !p.owner && myLevel !== undefined && p.minLevel > myLevel;
      const sig = [p.owner?.companyId ?? "-", p.owner?.isSystem ? 1 : 0, p.building?.id ?? "-", p.building?.type ?? "", p.building?.level ?? 0, p.building?.status ?? "", mine ? 1 : 0, locked ? 1 : 0, p.minLevel, p.building?.outputProductId ?? "", p.deposit?.kind ?? ""].join("|");
      const idx = ci * 16 + p.gz * 4 + p.gx;
      this.tileIds[idx] = p.id;
      this.tiles.setColorAt(idx, this.tileColorFor(p, mine, locked));
      const old = this.nodes.get(p.id);
      if (old && old.sig === sig) continue;
      if (old) { this.contentRoot.remove(old.group); this.decorDirty = true; }
      this.nodes.set(p.id, this.makeNode(p, x, z, sig, mine, locked));
    }
    for (const [id, n] of this.nodes) if (!seen.has(id)) { this.contentRoot.remove(n.group); this.nodes.delete(id); this.decorDirty = true; }
    if (this.decorDirty) this.rebuildDecor();
    this.syncChips(map);
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    this.syncVehicles(map.vehicles);
  }

  private tileColorFor(p: PlotDto, mine: boolean, locked: boolean): Color {
    let c: string = PAL.tile;
    if (mine) c = "#6a4e38";
    else if (p.owner?.isSystem) c = PAL.tileSystem;
    else if (p.owner) c = PAL.tileOther;
    else if (locked || p.minLevel >= 3) c = PAL.tileLockedHigh;
    else if (p.minLevel === 2) c = PAL.tileLockedMid;
    return this.tileColor.set(c);
  }

  private makeNode(p: PlotDto, x: number, z: number, sig: string, mine: boolean, locked: boolean): PlotNode {
    const g = new Group();
    g.position.set(x, CONTENT_Y, z);
    const node: PlotNode = { sig, group: g, spins: [], decor: [], glowBoxes: [], lampBoxes: [], warn: null, tractor: null, smoke: [], buildingMesh: null, height: 0.3, x, z };
    const deco = (geo: BufferGeometry, lx = 0, ly = 0, lz = 0, sx = 1, sy = 1, sz = 1): void => {
      node.decor.push({ geo, m: new Matrix4().makeScale(sx, sy, sz).setPosition(x + lx, CONTENT_Y + ly, z + lz) });
    };
    const b = p.building;
    if (b) {
      const outCol = b.outputProductId ? this.productColor.get(b.outputProductId) : undefined;
      let accent = "-";
      if (b.type === "field") accent = outCol ?? (hashStr(b.id) % 2 === 0 ? PAL.grain : PAL.fodder);
      else if (b.type === "mine") accent = outCol ?? (p.deposit?.kind === "coal" ? PAL.oreCoal : PAL.oreIron);
      const def = this.def(b.type, b.level, accent);
      node.height = def.height;
      const m = new Mesh(def.geometry, this.matVC);
      m.castShadow = this.high;
      m.receiveShadow = this.high;
      m.userData.sel = { type: "facility", facilityId: b.id, plotId: p.id } satisfies CitySelection;
      node.buildingMesh = m;
      g.add(m);
      const building = b.status === "constructing";
      if (building) m.scale.y = 0.3;
      if (building || b.status === "upgrading") {
        deco(this.geo("scaffold", () => buildScaffold(1.1)));
        node.height = Math.max(node.height, 0.9);
      }
      if (b.status === "working") {
        for (const gl of def.glows) node.glowBoxes.push({ x: x + gl.x, y: CONTENT_Y + gl.y, z: z + gl.z, w: gl.w, h: gl.h, d: gl.d });
        for (const l of def.lamps) node.lampBoxes.push({ x: x + l.x, y: CONTENT_Y + l.y, z: z + l.z, w: l.s, h: l.s, d: l.s });
        for (const w of def.wheels) {
          const s = new Mesh(this.wheelGeo, this.matVC);
          s.scale.setScalar(w.r); s.position.set(w.x, w.y, w.z);
          g.add(s); node.spins.push({ mesh: s, kind: "wheel" });
        }
        for (const f of def.fans) {
          const s = new Mesh(this.fanGeo, this.matVC);
          s.scale.setScalar(f.r); s.position.set(f.x, f.y, f.z);
          g.add(s); node.spins.push({ mesh: s, kind: "fan" });
        }
        if (def.tractor) {
          const t = new Mesh(this.tractorGeo, this.matVC);
          t.castShadow = this.high;
          g.add(t); node.tractor = t;
        }
        if (this.high) {
          let i = 0;
          for (const s of def.smoke) node.smoke.push({ x: x + s.x, y: CONTENT_Y + s.y, z: z + s.z, dark: s.dark, off: (i++ * 0.37 + (hashStr(b.id) % 100) / 100) % 1 });
        }
      } else if (def.shutter && b.status !== "constructing") {
        const s = def.shutter;
        deco(this.geo("shutter", () => new PartBuilder().box(1, 1, 1, 0, 0, 0, "#6d7a88").build()), s.x, s.y, s.z + 0.02, s.w, s.h, 0.03);
      }
      if (b.status === "stalled") {
        const wmesh = new Mesh(this.geo("warn", () => buildWarning()), this.matVC);
        wmesh.position.y = def.height + 0.3;
        g.add(wmesh); node.warn = wmesh;
      }
    } else if (!p.owner) {
      const col = locked ? "#c0392b" : p.minLevel >= 3 ? "#e0b84f" : p.minLevel === 2 ? "#3a7bd5" : "#3fa34d";
      deco(this.geo(`sign:${col}`, () => buildSign(col)), 0, 0, 0, 1, 1, 1);
    }
    if (mine) {
      deco(this.geo("frame-mine", () => buildFrame(0.58, 0.05, PAL.forge)), 0, 0.005, 0);
      // dökümhane bayrağı: benim arsalarım uzaktan da seçilir
      deco(this.geo("flag", () => new PartBuilder().box(0.03, 0.55, 0.03, 0, 0, 0, PAL.steel).box(0.2, 0.12, 0.02, 0.115, 0.42, 0, PAL.forge).build()), -0.52, 0, 0.52);
    }
    this.contentRoot.add(g);
    this.decorDirty = true;
    return node;
  }

  /** Statik süsleri (tabela, çerçeve, iskele, parıltı) tek çizim çağrısına birleştirir; yalnızca veri değişince. */
  private rebuildDecor(): void {
    this.decorDirty = false;
    for (const m of [this.decorMesh, this.glowMesh, this.lampMesh]) {
      if (m) { this.scene.remove(m); m.geometry.dispose(); }
    }
    this.decorMesh = this.glowMesh = this.lampMesh = null;
    const parts: BufferGeometry[] = [];
    const glow: BufferGeometry[] = [];
    const lamp: BufferGeometry[] = [];
    for (const n of this.nodes.values()) {
      for (const d of n.decor) { const c = d.geo.clone(); c.applyMatrix4(d.m); parts.push(c); }
      for (const b of n.glowBoxes) glow.push(this.boxAt(b));
      for (const b of n.lampBoxes) lamp.push(this.boxAt(b));
    }
    const mk = (list: BufferGeometry[], mat: Material, shadow: boolean): Mesh | null => {
      if (list.length === 0) return null;
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (!g) return null;
      const mesh = new Mesh(g, mat);
      mesh.castShadow = shadow;
      this.scene.add(mesh);
      return mesh;
    };
    this.decorMesh = mk(parts, this.matVC, this.high);
    this.glowMesh = mk(glow, this.matGlow, false);
    this.lampMesh = mk(lamp, this.matLamp, false);
  }

  private boxAt(b: { x: number; y: number; z: number; w: number; h: number; d: number }): BufferGeometry {
    const g = new BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x, b.y, b.z);
    return g;
  }

  /** Benim binalarım için sahne içi durum işareti (çalışıyor / boşta / durdu / inşaat); dokununca bina seçilir. */
  private syncChips(map: WorldMapDto): void {
    const seen = new Set<string>();
    const myId = this.myCompanyId;
    for (const p of map.plots) {
      const b = p.building;
      const info = this.plotInfo.get(p.id);
      if (!b || !info || !myId || p.owner?.companyId !== myId) continue;
      seen.add(b.id);
      let chip = this.chips.get(b.id);
      if (!chip) {
        const el = document.createElement("button");
        el.type = "button";
        el.dataset.facilityId = b.id;
        el.style.cssText = CHIP_CSS;
        const fid = b.id, pid = p.id;
        el.addEventListener("click", (e) => { e.stopPropagation(); this.o.cb.onSelect({ type: "facility", facilityId: fid, plotId: pid }); });
        this.o.labelLayer.appendChild(el);
        chip = { el, plotId: p.id, facilityId: b.id, x: 0, y: 0, z: 0, until: 0, status: "", last: "\u0000" };
        this.chips.set(b.id, chip);
      }
      const node = this.nodes.get(p.id);
      chip.plotId = p.id;
      chip.x = info.x; chip.z = info.z;
      chip.y = CONTENT_Y + (node?.height ?? 0.5) + (b.status === "stalled" ? 0.95 : 0.4);
      chip.until = b.activeUntil ? Date.parse(b.activeUntil) : 0;
      if (chip.status !== b.status) {
        chip.status = b.status;
        const st = CHIP_STYLE[b.status] ?? CHIP_STYLE.idle as (typeof CHIP_STYLE)[string];
        chip.el.style.background = st.bg; chip.el.style.color = st.fg; chip.el.style.borderColor = st.bd;
        chip.el.dataset.status = b.status;
        const tname = this.o.world.buildingTypes.find((t) => t.id === b.type)?.name[this.o.locale] ?? b.type;
        const sname = translate(this.o.locale, `city3d.status.${b.status}`);
        chip.el.setAttribute("aria-label", translate(this.o.locale, "city3d.chipLabel", { type: tname, status: sname }));
        chip.el.style.animation = b.status === "idle" || b.status === "stalled" ? "cf3d-chip 1.2s ease-in-out infinite" : "none";
        chip.last = "\u0000";
      }
    }
    for (const [id, c] of this.chips) if (!seen.has(id)) { c.el.remove(); this.chips.delete(id); }
  }

  private syncVehicles(list: VehicleMapDto[]): void {
    this.parkIdx = parkIndexes(list);
    const seen = new Set<string>();
    for (const v of list) {
      seen.add(v.id);
      const mine = v.isMine || (!!this.myCompanyId && v.ownerCompanyId === this.myCompanyId);
      const first = v.shipment?.cargo?.[0];
      const cargoCol = (first && this.productColor.get(first.productId)) || NEUTRAL_CARGO;
      const key = `${v.modelId}|${mine ? 1 : 0}|${cargoCol}`;
      const ex = this.vehicles.get(v.id);
      if (ex && ex.key === key) { ex.dto = v; continue; }
      if (ex) this.vehicleRoot.remove(ex.group);
      const geo = this.geo(`veh:${key}`, () => buildVehicle(v.modelId, mine ? PAL.mineVeh : PAL.otherVeh, cargoCol));
      const body = new Mesh(geo, this.matVC);
      body.castShadow = this.high;
      const len = vehicleLength(v.modelId);
      const hit = new Mesh(this.geo(`vhit:${v.modelId}`, () => new BoxGeometry(0.7, 0.5, len + 0.2)), this.hitMat());
      hit.position.y = 0.2;
      hit.userData.sel = { type: "vehicle", vehicleId: v.id } satisfies CitySelection;
      const grp = new Group();
      grp.scale.setScalar(VEH_SCALE);
      grp.add(body, hit);
      if (mine) {
        const mark = new Mesh(this.vMarkGeo, this.matVC);
        mark.position.set(0, 0.0, 0);
        mark.scale.set(len * 0.5, 1, 1);
        mark.rotation.y = Math.PI / 2;
        grp.add(mark, this.ownDisc(len));
      }
      this.vehicleRoot.add(grp);
      this.vehicles.set(v.id, { group: grp, hit, dto: v, key, len });
    }
    for (const [id, n] of this.vehicles) if (!seen.has(id)) { this.vehicleRoot.remove(n.group); this.vehicles.delete(id); }
  }

  private discMat: MeshBasicMaterial | null = null;
  private ownDisc(len: number): Mesh {
    if (!this.discMat) this.discMat = this.track(new MeshBasicMaterial({ color: PAL.forge, transparent: true, opacity: 0.55, depthWrite: false }));
    const g = this.geo(`vdisc:${len}`, () => { const r = new RingGeometry(len * 0.5 + 0.06, len * 0.5 + 0.17, 20); r.rotateX(-Math.PI / 2); return r; });
    const m = new Mesh(g, this.discMat);
    m.position.y = 0.01;
    m.scale.set(0.5, 1, 1);
    return m;
  }

  private hitMatCache: MeshBasicMaterial | null = null;
  private hitMat(): MeshBasicMaterial {
    if (!this.hitMatCache) this.hitMatCache = this.track(new MeshBasicMaterial({ visible: false }));
    return this.hitMatCache;
  }

  setSelected(sel: CitySelection | null): void { this.selected = sel; }

  setFocus(cityId: string | null, immediate = false): void {
    if (cityId === this.focusId && !immediate) return;
    this.focusId = cityId;
    const dir = this.dirVec();
    // mevcut bakış yönünü koru
    const cur = this.camera.position.clone().sub(this.controls.target);
    if (cur.lengthSq() > 1e-6) dir.copy(cur).normalize();
    let target: Vector3, dist: number;
    const c = cityId ? this.centers.get(cityId) : undefined;
    if (c) {
      target = new Vector3(c.x, 0, c.z + 0.6); dist = this.fit(PAD_HALF * 2 + 2, PAD_HALF * 2 + 3);
      const own = this.ownBox(cityId as string);
      if (own) {
        const w = Math.max(9, own.maxX - own.minX + 4), d = Math.max(8, own.maxZ - own.minZ + 4);
        target = new Vector3((own.minX + own.maxX) / 2, 0, (own.minZ + own.maxZ) / 2 + 0.3);
        dist = Math.min(dist, this.fit(w, d));
      }
    }
    else { target = this.overview.target.clone(); dist = this.overview.dist; }
    const p1 = target.clone().add(dir.multiplyScalar(dist));
    if (immediate) {
      this.camera.position.copy(p1); this.controls.target.copy(target); this.controls.update(); this.tween = null;
      return;
    }
    this.tween = { t0: performance.now(), dur: 900, p0: this.camera.position.clone(), p1, q0: this.controls.target.clone(), q1: target };
  }

  /** Benim bina ve araçlarımın bu şehirdeki sınır kutusu (yoksa null) */
  private ownBox(cityId: string): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, n = 0;
    const add = (x: number, z: number): void => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); n++; };
    const myId = this.myCompanyId;
    if (!myId || !this.map) return null;
    for (const p of this.map.plots) {
      if (p.cityId !== cityId || p.owner?.companyId !== myId) continue;
      const i = this.plotInfo.get(p.id);
      if (i) add(i.x, i.z);
    }
    if (n === 0) {
      for (const v of this.map.vehicles) {
        if (v.cityId !== cityId || !(v.isMine || v.ownerCompanyId === myId) || v.status === "in_transit") continue;
        const c = this.centers.get(cityId);
        if (c) add(c.x, c.z);
      }
    }
    return n > 0 ? { minX, maxX, minZ, maxZ } : null;
  }

  /* ---------------------------------------------------------------- etkileşim */

  private setupPicking(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this.pointers.add(e.pointerId);
      if (this.pointers.size > 1) { if (this.down) this.down.multi = true; return; }
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), multi: false };
    });
    const up = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      const d = this.down;
      if (!d || this.pointers.size > 0) return;
      this.down = null;
      if (e.type === "pointercancel" || d.multi) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;
      this.pick(e.clientX, e.clientY, e.pointerType === "touch");
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  private pick(cx: number, cy: number, touch = false): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: Object3D[] = [this.tiles, ...this.padHits];
    for (const n of this.nodes.values()) {
      if (n.buildingMesh) targets.push(n.buildingMesh);
      for (const c of n.group.children) if (c.userData.sel) targets.push(c);
    }
    for (const v of this.vehicles.values()) targets.push(v.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    let chosen: CitySelection | null = null;
    const vh = hits.find((h) => (h.object.userData.sel as CitySelection | undefined)?.type === "vehicle");
    if (vh) chosen = vh.object.userData.sel as CitySelection;
    else {
      for (const h of hits) {
        if (h.object === this.tiles) {
          const id = h.instanceId !== undefined ? this.tileIds[h.instanceId] : undefined;
          if (id) { chosen = { type: "plot", plotId: id }; break; }
          continue;
        }
        const s = h.object.userData.sel as CitySelection | undefined;
        if (s) { chosen = s; break; }
      }
    }
    // dokunmatik: parmak payı. Ray bir şeyi ıskalarsa veya yalnızca arsayı bulursa en yakın araç/bina (<=34 px) seçilir.
    if (touch && (!chosen || chosen.type === "plot" || chosen.type === "city")) {
      let best: CitySelection | null = null, bd = 34;
      const q = this.tmpV;
      for (const v of this.vehicles.values()) {
        if (!v.group.visible) continue;
        q.set(v.group.position.x, 0.2, v.group.position.z).project(this.camera);
        const d = Math.hypot((q.x * 0.5 + 0.5) * rect.width + rect.left - cx, (-q.y * 0.5 + 0.5) * rect.height + rect.top - cy);
        if (q.z < 1 && d < bd) { bd = d; best = v.group.children[1]?.userData.sel as CitySelection; }
      }
      if (!best || chosen?.type === "plot") {
        for (const [pid, n] of this.nodes) {
          const fid = this.plotInfo.get(pid)?.facilityId;
          if (!fid || !n.buildingMesh) continue;
          q.set(n.x, CONTENT_Y + n.height * 0.5, n.z).project(this.camera);
          const d = Math.hypot((q.x * 0.5 + 0.5) * rect.width + rect.left - cx, (-q.y * 0.5 + 0.5) * rect.height + rect.top - cy);
          if (q.z < 1 && d < bd) { bd = d; best = { type: "facility", facilityId: fid, plotId: pid }; }
        }
      }
      if (best) chosen = best;
    }
    this.o.cb.onSelect(chosen);
  }

  /* ---------------------------------------------------------------- döngü */

  resize(): void {
    const host = this.o.host;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.placeOverview();
    this.controls.maxDistance = this.overview.dist * 1.3;
  }

  setActive(on: boolean): void {
    if (this.disposed || on === this.active) return;
    this.active = on;
    cancelAnimationFrame(this.raf);
    if (on) { this.lastFrame = 0; this.raf = requestAnimationFrame(this.frame); }
  }

  private readonly frame = (now: number): void => {
    if (!this.active || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.high && now - this.lastFrame < 32) return; // düşük kalite: ~30 fps
    this.lastFrame = now;
    this.update(now / 1000);
    this.renderer.render(this.scene, this.camera);
  };

  /** Test/performans ölçümü için */
  stats(): { calls: number; triangles: number; geometries: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries };
  }

  private update(t: number): void {
    // kamera geçişi
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
      const e = ease(k);
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
      this.controls.target.lerpVectors(this.tween.q0, this.tween.q1, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    // sınırlar: hedef ülke dışına kaçmasın, kamera zeminin altına inmesin
    const b = this.bounds;
    const tg = this.controls.target;
    const cx = Math.max(b.minX - 3, Math.min(b.maxX + 3, tg.x));
    const cz = Math.max(b.minZ - 3, Math.min(b.maxZ + 3, tg.z));
    if (cx !== tg.x || cz !== tg.z) { this.camera.position.x += cx - tg.x; this.camera.position.z += cz - tg.z; tg.x = cx; tg.z = cz; }
    tg.y = 0;
    if (this.camera.position.y < 1.2) this.camera.position.y = 1.2;

    const nowMs = Date.now() + this.serverOffsetMs;

    // araçlar
    for (const v of this.vehicles.values()) {
      const pose = vehiclePose(v.dto, this.centers, nowMs, this.parkIdx.get(v.dto.id) ?? 0);
      if (!pose) { v.group.visible = false; continue; }
      v.group.visible = true;
      v.group.position.set(pose.x, 0.03, pose.z);
      v.group.rotation.y = pose.heading;
    }

    // yapı animasyonları
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.1);
    this.matGlow.color.setRGB(1, 0.3 + 0.28 * pulse, 0.05 + 0.1 * pulse);
    this.matLamp.color.setRGB(1, 0.78 + 0.1 * Math.sin(t * 1.3), 0.45);
    let si = 0;
    const dark = this.tmpC;
    for (const n of this.nodes.values()) {
      for (const s of n.spins) { if (s.kind === "wheel") s.mesh.rotation.z = t * 1.6; else s.mesh.rotation.y = t * 7; }
      if (n.tractor) {
        const ph = (t * 0.12) % 2; const u = ph < 1 ? ph : 2 - ph;
        n.tractor.position.set(-0.36 + 0.12 * Math.floor(((t * 0.06) % 1) * 7), 0.05, -0.45 + 0.9 * u);
        n.tractor.rotation.y = ph < 1 ? 0 : Math.PI;
      }
      if (n.warn) { n.warn.position.y = n.height + 0.3 + Math.sin(t * 3) * 0.04; n.warn.rotation.y = t * 1.4; }
      for (const e of n.smoke) {
        for (let k = 0; k < 4 && si < MAX_SMOKE; k++, si++) {
          const ph = (t * 0.35 + k / 4 + e.off) % 1;
          const fade = ph > 0.7 ? (1 - ph) / 0.3 : 1;
          const s = (0.45 + ph * 1.5) * fade;
          this.tmpQ.identity();
          this.tmpM.compose(this.tmpV.set(e.x + ph * 0.35, e.y + ph * 1.0, e.z - ph * 0.1), this.tmpQ, this.tmpS.set(s, s, s));
          this.smoke.setMatrixAt(si, this.tmpM);
          this.smoke.setColorAt(si, dark.set(e.dark ? "#4a4f56" : "#e3e9ef"));
        }
      }
    }
    this.smoke.count = si;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;

    this.updateSelection(t);
    this.updateLabels();
  }

  private updateSelection(t: number): void {
    const s = this.selected;
    this.selFrame.visible = false;
    this.selRing.visible = false;
    if (!s) return;
    const k = 1 + Math.sin(t * 4) * 0.035;
    if (s.type === "plot" || s.type === "facility") {
      const info = this.plotInfo.get(s.plotId);
      if (!info) return;
      this.selFrame.visible = true;
      this.selFrame.position.set(info.x, CONTENT_Y + 0.01, info.z);
      this.selFrame.scale.set(k, 1, k);
    } else if (s.type === "vehicle") {
      const v = this.vehicles.get(s.vehicleId);
      if (!v || !v.group.visible) return;
      this.selRing.visible = true;
      this.selRing.position.set(v.group.position.x, 0.07, v.group.position.z);
      const r = (v.len * 0.55 + 0.25) * k * VEH_SCALE * 0.8;
      this.selRing.scale.set(r * 1.4, 1, r * 1.4);
    } else {
      const c = this.centers.get(s.cityId);
      if (!c) return;
      this.selFrame.visible = true;
      this.selFrame.position.set(c.x, PAD_H + 0.02, c.z);
      const sc = (PAD_HALF + 0.12) / 0.62 * k;
      this.selFrame.scale.set(sc, 1, sc);
    }
  }

  private updateChips(): void {
    const v = this.tmpV;
    const now = Date.now() + this.serverOffsetMs;
    for (const c of this.chips.values()) {
      v.set(c.x, c.y, c.z).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (!vis) { c.el.style.visibility = "hidden"; continue; }
      c.el.style.visibility = "visible";
      const x = Math.round((v.x * 0.5 + 0.5) * this.w), y = Math.round((-v.y * 0.5 + 0.5) * this.h);
      c.el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
      const st = CHIP_STYLE[c.status] ?? CHIP_STYLE.idle as (typeof CHIP_STYLE)[string];
      let txt = st.icon;
      if (c.status === "idle" || c.status === "stalled") txt += ` ${translate(this.o.locale, `city3d.chip.${c.status}`)}`;
      if (c.until > 0 && (c.status === "working" || c.status === "constructing" || c.status === "upgrading")) {
        const sec = Math.max(0, Math.round((c.until - now) / 1000));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
        txt += ` ${h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`}`;
      }
      if (txt !== c.last) { c.last = txt; c.el.textContent = txt; }
    }
  }

  private updateLabels(): void {
    this.updateChips();
    const v = this.tmpV;
    for (const c of this.o.world.cities) {
      const btn = this.labels.get(c.id);
      const p = this.centers.get(c.id);
      if (!btn || !p) continue;
      v.set(p.x, 0.5, p.z - PAD_HALF - 0.25).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      const sel = this.selected?.type === "city" && this.selected.cityId === c.id;
      btn.style.visibility = vis ? "visible" : "hidden";
      if (vis) {
        const x = Math.round((v.x * 0.5 + 0.5) * this.w), y = Math.round((-v.y * 0.5 + 0.5) * this.h);
        btn.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
      }
      const bl = sel ? PAL.forge : c.color;
      if (btn.dataset.sel !== (sel ? "1" : "0")) {
        btn.dataset.sel = sel ? "1" : "0";
        btn.style.borderLeftColor = bl;
        btn.style.background = sel ? "rgba(255,106,26,.9)" : "rgba(11,18,27,.82)";
        btn.style.color = sel ? "#14100c" : "#eef3f8";
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener("webglcontextlost", this.onCtxLost);
    this.controls.dispose();
    for (const c of this.chips.values()) c.el.remove();
    this.chips.clear();
    this.styleEl?.remove();
    for (const btn of this.labels.values()) btn.remove();
    this.labels.clear();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}

export type { VehNode };
