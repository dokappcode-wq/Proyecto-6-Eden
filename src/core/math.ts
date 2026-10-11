/** Utilidades numéricas puras (sin Three.js) para la lógica testeable. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export const DEG2RAD = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Interpolación exponencial independiente del framerate. `sharpness` ~ 1/tiempo de respuesta. */
export function damp(current: number, target: number, sharpness: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-sharpness * dt));
}

/** Como `damp` pero por el camino corto entre ángulos (radianes). */
export function dampAngle(current: number, target: number, sharpness: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-sharpness * dt));
}

/** Normaliza un ángulo a (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Acerca `current` a `target` como mucho `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Distancia de un punto a un segmento 2D (XZ) y parámetro t del punto más cercano. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { dist: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return { dist: Math.sqrt(cx * cx + cz * cz), t };
}

/** Distancia mínima de un punto a una polilínea 2D. */
export function distToPolyline(px: number, pz: number, points: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const { dist } = distToSegment(px, pz, a[0], a[1], b[0], b[1]);
    if (dist < best) best = dist;
  }
  return best;
}

/** Hash entero determinista -> [0,1). */
export function hash2(x: number, z: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** PRNG determinista (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
