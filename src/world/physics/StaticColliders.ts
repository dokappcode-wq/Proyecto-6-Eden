import { clamp } from '../../core/math';

/** Caja orientada solo en Y (suficiente para ruinas, muros, rocas talladas). */
export interface BoxCollider {
  readonly kind: 'box';
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  readonly cos: number;
  readonly sin: number;
  /** Etiqueta de material (Fase 2: escalable/agarrable). */
  material: string;
}

export interface CylinderCollider {
  readonly kind: 'cylinder';
  x: number;
  z: number;
  radius: number;
  yMin: number;
  yMax: number;
  material: string;
}

export type Collider = BoxCollider | CylinderCollider;

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  material: string;
}

export interface PushResult {
  /** Normal horizontal acumulada del contacto (para recortar la velocidad). */
  nx: number;
  nz: number;
  hit: boolean;
}

/**
 * Colisionadores estáticos en un hash espacial 2D (XZ).
 * Lógica pura: lo usan el personaje y la cámara, y se testea sin Three.js.
 */
export class StaticColliders {
  private readonly cells = new Map<number, Collider[]>();
  private readonly all = new Set<Collider>();
  private stamp = 0;
  private readonly stamps = new WeakMap<Collider, number>();

  constructor(private readonly cellSize = 16) {}

  get count(): number {
    return this.all.size;
  }

  addBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0, material = 'stone'): BoxCollider {
    const c: BoxCollider = { kind: 'box', x, y, z, hx, hy, hz, cos: Math.cos(rotY), sin: Math.sin(rotY), material };
    this.insert(c);
    return c;
  }

  addCylinder(x: number, z: number, radius: number, yMin: number, yMax: number, material = 'stone'): CylinderCollider {
    const c: CylinderCollider = { kind: 'cylinder', x, z, radius, yMin, yMax, material };
    this.insert(c);
    return c;
  }

  /** Vuelve a registrar un colisionador retirado con `remove`. */
  add(c: Collider): void {
    if (!this.all.has(c)) this.insert(c);
  }

  remove(c: Collider): void {
    if (!this.all.delete(c)) return;
    for (const list of this.cells.values()) {
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
  }

  /** Colisionadores cuyo AABB XZ toca el rectángulo dado (sin duplicados). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    const s = ++this.stamp;
    const cs = this.cellSize;
    for (let cx = Math.floor(minX / cs); cx <= Math.floor(maxX / cs); cx++) {
      for (let cz = Math.floor(minZ / cs); cz <= Math.floor(maxZ / cs); cz++) {
        const list = this.cells.get(cellKey(cx, cz));
        if (!list) continue;
        for (const c of list) {
          if (this.stamps.get(c) === s) continue;
          this.stamps.set(c, s);
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Superficie superior más alta bajo el pie (centro + margen `footRadius`)
   * que no esté por encima de `maxTop`. -Infinity si no hay ninguna.
   */
  topAt(x: number, z: number, footRadius: number, maxTop: number): number {
    let best = -Infinity;
    for (const c of this.query(x - footRadius, z - footRadius, x + footRadius, z + footRadius, this.scratch)) {
      let top: number;
      if (c.kind === 'box') {
        const { lx, lz } = toLocal(c, x, z);
        if (Math.abs(lx) > c.hx + footRadius || Math.abs(lz) > c.hz + footRadius) continue;
        top = c.y + c.hy;
      } else {
        if (Math.hypot(x - c.x, z - c.z) > c.radius + footRadius) continue;
        top = c.yMax;
      }
      if (top <= maxTop && top > best) best = top;
    }
    return best;
  }

  /**
   * Empuja un cilindro vertical (radio, pies, altura) fuera de los colisionadores.
   * Ignora los que se pueden subir como escalón (techo por debajo de pies + stepHeight).
   */
  pushOut(pos: { x: number; y: number; z: number }, radius: number, height: number, stepHeight: number): PushResult {
    const res: PushResult = { nx: 0, nz: 0, hit: false };
    // Dos iteraciones resuelven bien esquinas entre dos colisionadores.
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, this.scratch)) {
        const bottom = c.kind === 'box' ? c.y - c.hy : c.yMin;
        const top = c.kind === 'box' ? c.y + c.hy : c.yMax;
        if (pos.y + height <= bottom || pos.y >= top - stepHeight) continue;

        if (c.kind === 'cylinder') {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const d = Math.hypot(dx, dz);
          const minD = c.radius + radius;
          if (d >= minD) continue;
          const nx = d > 1e-6 ? dx / d : 1;
          const nz = d > 1e-6 ? dz / d : 0;
          pos.x = c.x + nx * minD;
          pos.z = c.z + nz * minD;
          accumulate(res, nx, nz);
          continue;
        }

        const { lx, lz } = toLocal(c, pos.x, pos.z);
        const qx = clamp(lx, -c.hx, c.hx);
        const qz = clamp(lz, -c.hz, c.hz);
        let dx = lx - qx;
        let dz = lz - qz;
        const d = Math.hypot(dx, dz);
        let nlx: number;
        let nlz: number;
        let targetX: number;
        let targetZ: number;
        if (d > 1e-6) {
          if (d >= radius) continue;
          nlx = dx / d;
          nlz = dz / d;
          targetX = qx + nlx * radius;
          targetZ = qz + nlz * radius;
        } else {
          // Centro dentro de la caja: salir por el eje de menor penetración.
          const px = c.hx - Math.abs(lx);
          const pz = c.hz - Math.abs(lz);
          if (px < pz) {
            nlx = Math.sign(lx) || 1;
            nlz = 0;
            targetX = nlx * (c.hx + radius);
            targetZ = lz;
          } else {
            nlx = 0;
            nlz = Math.sign(lz) || 1;
            targetX = lx;
            targetZ = nlz * (c.hz + radius);
          }
        }
        dx = targetX;
        dz = targetZ;
        const w = toWorld(c, dx, dz);
        pos.x = w.x;
        pos.z = w.z;
        const n = toWorldDir(c, nlx, nlz);
        accumulate(res, n.x, n.z);
      }
    }
    return res;
  }

  /** Distancia al primer impacto del rayo (dirección normalizada) o Infinity. Ignora colisionadores que contienen el origen. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    return this.raycastHit(ox, oy, oz, dx, dy, dz, maxDist)?.t ?? Infinity;
  }

  /** Primer impacto con normal y material, o null. */
  raycastHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    let best: RayHit | null = null;
    const n = { x: 0, y: 0, z: 0 };
    for (const c of this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this.scratch)) {
      const t = c.kind === 'box' ? rayBox(c, ox, oy, oz, dx, dy, dz, n) : rayCylinder(c, ox, oy, oz, dx, dy, dz, n);
      if (t >= 0 && t <= maxDist && (!best || t < best.t)) best = { t, nx: n.x, ny: n.y, nz: n.z, material: c.material };
    }
    return best;
  }

  /** ¿Un cilindro vertical (pies, radio, altura) solapa algún colisionador? */
  overlaps(x: number, y: number, z: number, radius: number, height: number): boolean {
    for (const c of this.query(x - radius, z - radius, x + radius, z + radius, this.scratch)) {
      const bottom = c.kind === 'box' ? c.y - c.hy : c.yMin;
      const top = c.kind === 'box' ? c.y + c.hy : c.yMax;
      if (y + height <= bottom || y >= top - 0.02) continue;
      if (c.kind === 'cylinder') {
        if (Math.hypot(x - c.x, z - c.z) < c.radius + radius) return true;
      } else {
        const { lx, lz } = toLocal(c, x, z);
        const qx = clamp(lx, -c.hx, c.hx);
        const qz = clamp(lz, -c.hz, c.hz);
        if (Math.hypot(lx - qx, lz - qz) < radius) return true;
      }
    }
    return false;
  }

  private readonly scratch: Collider[] = [];

  private insert(c: Collider): void {
    this.all.add(c);
    const r = c.kind === 'box' ? Math.hypot(c.hx, c.hz) : c.radius;
    const cs = this.cellSize;
    for (let cx = Math.floor((c.x - r) / cs); cx <= Math.floor((c.x + r) / cs); cx++) {
      for (let cz = Math.floor((c.z - r) / cs); cz <= Math.floor((c.z + r) / cs); cz++) {
        const key = cellKey(cx, cz);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(c);
      }
    }
  }
}

function cellKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

// Rotación Y de Three.js: local -> mundo  wx = cos·lx + sin·lz,  wz = -sin·lx + cos·lz
function toLocal(c: BoxCollider, x: number, z: number): { lx: number; lz: number } {
  const dx = x - c.x;
  const dz = z - c.z;
  return { lx: c.cos * dx - c.sin * dz, lz: c.sin * dx + c.cos * dz };
}

function toWorld(c: BoxCollider, lx: number, lz: number): { x: number; z: number } {
  return { x: c.x + c.cos * lx + c.sin * lz, z: c.z - c.sin * lx + c.cos * lz };
}

function toWorldDir(c: BoxCollider, lx: number, lz: number): { x: number; z: number } {
  return { x: c.cos * lx + c.sin * lz, z: -c.sin * lx + c.cos * lz };
}

function accumulate(res: PushResult, nx: number, nz: number): void {
  res.hit = true;
  res.nx += nx;
  res.nz += nz;
  const l = Math.hypot(res.nx, res.nz);
  if (l > 1e-6) {
    res.nx /= l;
    res.nz /= l;
  }
}

function rayBox(c: BoxCollider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, n: { x: number; y: number; z: number }): number {
  const { lx: olx, lz: olz } = toLocal(c, ox, oz);
  const dlx = c.cos * dx - c.sin * dz;
  const dlz = c.sin * dx + c.cos * dz;
  const o = [olx, oy - c.y, olz];
  const d = [dlx, dy, dlz];
  const h = [c.hx, c.hy, c.hz];
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = 0;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -h[i] || o[i] > h[i]) return -1;
      continue;
    }
    let t1 = (-h[i] - o[i]) / d[i];
    let t2 = (h[i] - o[i]) / d[i];
    let s1 = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s1 = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s1;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Rayo que nace dentro de la caja: se ignora (la cámara no debe quedar atrapada en lo que la rodea).
  if (tmax < 0 || tmin < 0) return -1;
  // Normal local de la cara impactada -> mundo.
  if (axis === 1) {
    n.x = 0;
    n.y = sign;
    n.z = 0;
  } else {
    const w = toWorldDir(c, axis === 0 ? sign : 0, axis === 2 ? sign : 0);
    n.x = w.x;
    n.y = 0;
    n.z = w.z;
  }
  return tmin;
}

function rayCylinder(c: CylinderCollider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, n: { x: number; y: number; z: number }): number {
  const px = ox - c.x;
  const pz = oz - c.z;
  const inside = px * px + pz * pz <= c.radius * c.radius && oy >= c.yMin && oy <= c.yMax;
  if (inside) return -1;
  let best = -1;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * (px * dx + pz * dz);
    const cc = px * px + pz * pz - c.radius * c.radius;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      const y = oy + dy * t;
      if (t >= 0 && y >= c.yMin && y <= c.yMax) {
        best = t;
        n.x = (px + dx * t) / c.radius;
        n.y = 0;
        n.z = (pz + dz * t) / c.radius;
      }
    }
  }
  // Tapas superior e inferior.
  if (Math.abs(dy) > 1e-9) {
    for (const yc of [c.yMax, c.yMin]) {
      const t = (yc - oy) / dy;
      if (t < 0) continue;
      const hx = px + dx * t;
      const hz = pz + dz * t;
      if (hx * hx + hz * hz <= c.radius * c.radius && (best < 0 || t < best)) {
        best = t;
        n.x = 0;
        n.y = yc === c.yMax ? 1 : -1;
        n.z = 0;
      }
    }
  }
  return best;
}
