import type { Vec3 } from '../../core/math';
import type { MaterialDef, MaterialsConfig } from '../../data/schemas';
import type { StaticColliders } from '../../world/physics/StaticColliders';

/** Consultas físicas del mundo que necesita el movimiento (inyectables en tests). */
export interface WorldQuery {
  terrainHeight(x: number, z: number): number;
  terrainNormal(x: number, z: number, out?: Vec3): Vec3;
  /** Material del terreno en un punto (según pendiente/región). */
  terrainMaterial(x: number, z: number, normalY: number): string;
  colliders: StaticColliders;
  materials: MaterialsConfig;
  /** Lo mojadas que están las superficies (lluvia): 0..1. Hace resbalar al escalar. */
  wetness?(): number;
  /** Agarre en hielo (crampones): el hielo no resbala al escalar. */
  iceGrip?(): boolean;
  /** Visualización opcional de rayos (debug F3). */
  debugRay?(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hit: boolean): void;
}

export interface SurfaceHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  material: string;
}

const UNKNOWN: MaterialDef = { climbable: false, grabbable: false, slippery: false };

export function materialDef(q: WorldQuery, id: string): MaterialDef {
  return q.materials[id] ?? UNKNOWN;
}

const tmp: Vec3 = { x: 0, y: 1, z: 0 };

/** Rayo contra terreno + colisionadores. Devuelve el impacto más cercano o null. */
export function castRay(q: WorldQuery, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): SurfaceHit | null {
  let best: SurfaceHit | null = null;

  const ch = q.colliders.raycastHit(ox, oy, oz, dx, dy, dz, maxDist);
  if (ch) best = { t: ch.t, x: ox + dx * ch.t, y: oy + dy * ch.t, z: oz + dz * ch.t, nx: ch.nx, ny: ch.ny, nz: ch.nz, material: ch.material };

  // Terreno: marcha + bisección. Si el origen ya está bajo el terreno, se ignora el terreno.
  if (oy >= q.terrainHeight(ox, oz)) {
    const limit = best ? best.t : maxDist;
    const step = Math.min(0.2, Math.max(0.05, limit / 10));
    let prev = 0;
    for (let t = step; t <= limit + 1e-9; t += step) {
      const tt = Math.min(t, limit);
      if (oy + dy * tt < q.terrainHeight(ox + dx * tt, oz + dz * tt)) {
        let lo = prev;
        let hi = tt;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          if (oy + dy * mid < q.terrainHeight(ox + dx * mid, oz + dz * mid)) hi = mid;
          else lo = mid;
        }
        const x = ox + dx * hi;
        const z = oz + dz * hi;
        const n = q.terrainNormal(x, z, tmp);
        best = { t: hi, x, y: oy + dy * hi, z, nx: n.x, ny: n.y, nz: n.z, material: q.terrainMaterial(x, z, n.y) };
        break;
      }
      prev = tt;
    }
  }

  if (q.debugRay) {
    const t = best ? best.t : maxDist;
    q.debugRay(ox, oy, oz, ox + dx * t, oy + dy * t, oz + dz * t, best !== null);
  }
  return best;
}

/** Altura de la superficie más alta bajo (x, z) por debajo de `fromY` (terreno o colisionador). */
export function surfaceBelow(q: WorldQuery, x: number, z: number, fromY: number, maxDist: number): SurfaceHit | null {
  return castRay(q, x, fromY, z, 0, -1, 0, maxDist);
}
