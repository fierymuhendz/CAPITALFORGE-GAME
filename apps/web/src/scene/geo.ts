/**
 * Prosedürel düşük poligonlu geometri yardımcıları. Her parça köşe rengi taşır;
 * bir bina tek bir birleşik geometriye (tek çizim çağrısı) dönüşür.
 */
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute,
  Matrix4, Quaternion, Vector3, Euler, SphereGeometry, TorusGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export class PartBuilder {
  private parts: BufferGeometry[] = [];
  private readonly tmp = new Color();

  private add(g: BufferGeometry, color: string | number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    ng.deleteAttribute("uv");
    ng.applyMatrix4(m);
    this.tmp.set(color);
    const n = ng.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = this.tmp.r; arr[i * 3 + 1] = this.tmp.g; arr[i * 3 + 2] = this.tmp.b; }
    ng.setAttribute("color", new Float32BufferAttribute(arr, 3));
    this.parts.push(ng);
    return this;
  }

  /** y: kutunun tabanı */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string | number, ry = 0): this {
    return this.add(new BoxGeometry(w, h, d), color, x, y + h / 2, z, 0, ry, 0);
  }
  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, color: string | number, seg = 8): this {
    return this.add(new CylinderGeometry(rTop, rBot, h, seg), color, x, y + h / 2, z);
  }
  /** yatay silindir (z ekseni boyunca) */
  cylZ(r: number, len: number, x: number, y: number, z: number, color: string | number, seg = 8): this {
    return this.add(new CylinderGeometry(r, r, len, seg), color, x, y, z, Math.PI / 2, 0, 0);
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: string | number, seg = 6): this {
    return this.add(new ConeGeometry(r, h, seg), color, x, y + h / 2, z);
  }
  /** beşik çatı: kesit XY düzleminde üçgen, z boyunca uzanır (ry ile döndürülebilir) */
  gable(w: number, h: number, d: number, x: number, y: number, z: number, color: string | number, ry = 0): this {
    const hw = w / 2, hd = d / 2;
    const p = [
      // ön kapak
      -hw, 0, hd, hw, 0, hd, 0, h, hd,
      // arka kapak
      hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
      // sol eğim
      -hw, 0, -hd, -hw, 0, hd, 0, h, hd, -hw, 0, -hd, 0, h, hd, 0, h, -hd,
      // sağ eğim
      hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,
    ];
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return this.add(g, color, x, y, z, 0, ry, 0);
  }
  sphere(r: number, x: number, y: number, z: number, color: string | number): this {
    return this.add(new SphereGeometry(r, 8, 6), color, x, y, z);
  }
  torus(r: number, tube: number, x: number, y: number, z: number, color: string | number, rx = Math.PI / 2): this {
    return this.add(new TorusGeometry(r, tube, 5, 10), color, x, y, z, rx);
  }

  build(): BufferGeometry {
    const g = mergeGeometries(this.parts, false) ?? new BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
