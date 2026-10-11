import { clamp, distToPolyline, hexToRgb, lerp, smoothstep, type Vec3 } from '../../core/math';
import type { TerrainConfig } from '../../data/schemas';
import { Noise2D } from '../noise';

type Rgb = [number, number, number];

interface WaterFeature {
  level: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Terreno determinista por semilla: continente + regiones (montañas al norte,
 * desierto al este, bosque al oeste) + el Valle de la Cápsula modelado por datos.
 *
 * - `rawHeight`: función analítica continua (para generar mallas).
 * - `height`: interpola los MISMOS triángulos que la malla LOD0, de modo que
 *   los pies del personaje coinciden exactamente con lo que se ve.
 *
 * Convención: +X = este, -Z = norte.
 */
export class TerrainGenerator {
  private readonly noise: Noise2D;
  private readonly palette: Record<keyof TerrainConfig['palette'], Rgb>;
  private readonly cache = new Map<number, number>();
  private readonly rivers: Array<WaterFeature & { def: TerrainConfig['rivers'][number] }>;
  private readonly lakes: Array<WaterFeature & { def: TerrainConfig['lakes'][number] }>;
  private readonly valleyExtent: number;

  constructor(readonly cfg: TerrainConfig) {
    this.noise = new Noise2D(cfg.seed);
    this.palette = Object.fromEntries(Object.entries(cfg.palette).map(([k, v]) => [k, hexToRgb(v)])) as typeof this.palette;
    this.rivers = cfg.rivers.map((def) => {
      const pad = def.width / 2 + def.bankWidth + 2;
      const xs = def.points.map((p) => p[0]);
      const zs = def.points.map((p) => p[1]);
      return {
        def,
        level: def.waterLevel,
        minX: Math.min(...xs) - pad,
        maxX: Math.max(...xs) + pad,
        minZ: Math.min(...zs) - pad,
        maxZ: Math.max(...zs) + pad,
      };
    });
    this.lakes = cfg.lakes.map((def) => {
      const pad = def.radius + 12;
      return {
        def,
        level: def.waterLevel,
        minX: def.center[0] - pad,
        maxX: def.center[0] + pad,
        minZ: def.center[1] - pad,
        maxZ: def.center[1] + pad,
      };
    });
    this.valleyExtent = cfg.valley.outerEnd + cfg.valley.edgeNoise + 4;
  }

  // ------------------------------------------------------------------ alturas

  /** Altura analítica (continua) en metros. */
  rawHeight(x: number, z: number): number {
    const base = this.baseHeight(x, z);
    const h = this.applyValley(x, z, base);
    return this.carveWater(x, z, h);
  }

  /** Altura de colisión: interpolación triangular sobre la rejilla física (= malla LOD0). */
  height(x: number, z: number): number {
    const g = this.cfg.physicsGrid;
    const gx = Math.floor(x / g);
    const gz = Math.floor(z / g);
    const fx = x / g - gx;
    const fz = z / g - gz;
    const h01 = this.gridHeight(gx, gz + 1);
    const h10 = this.gridHeight(gx + 1, gz);
    // Misma diagonal que la malla del chunk: (gx+1, gz) — (gx, gz+1).
    if (fx + fz <= 1) {
      const h00 = this.gridHeight(gx, gz);
      return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    }
    const h11 = this.gridHeight(gx + 1, gz + 1);
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Normal suavizada de la superficie de colisión. */
  normal(x: number, z: number, out: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
    const e = this.cfg.physicsGrid;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    out.x = -dx * inv;
    out.y = inv;
    out.z = -dz * inv;
    return out;
  }

  /** Nivel del agua que cubre el punto (río, lago o mar), o null si no hay agua posible. */
  waterLevelAt(x: number, z: number): number | null {
    let level: number | null = null;
    for (const r of this.rivers) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      if (distToPolyline(x, z, r.def.points) < r.def.width / 2 + r.def.bankWidth) level = Math.max(level ?? -Infinity, r.level);
    }
    for (const l of this.lakes) {
      if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
      if (Math.hypot(x - l.def.center[0], z - l.def.center[1]) < l.def.radius + 10) level = Math.max(level ?? -Infinity, l.level);
    }
    return level ?? this.cfg.seaLevel;
  }

  /** Distancia "squircle" al centro del valle (útil para saber si estamos dentro). */
  valleyDistance(x: number, z: number): number {
    const u = x - this.cfg.valley.center[0];
    const w = z - this.cfg.valley.center[1];
    return Math.pow(u * u * u * u + w * w * w * w, 0.25);
  }

  isInsideValley(x: number, z: number): boolean {
    return this.valleyDistance(x, z) < this.cfg.valley.outerEnd;
  }

  // ------------------------------------------------------------------ color

  /** Color del vértice según altura, pendiente, región, caminos y agua. */
  surfaceColor(x: number, z: number, h: number, normalY: number, out: Float32Array, offset: number): void {
    const p = this.palette;
    const n = this.noise;
    const c = this.cfg;
    const tint = n.noise(x * 0.018, z * 0.018);
    const tint2 = n.noise(x * 0.07 + 40, z * 0.07 - 12);

    let col: Rgb = mix(p.grass, tint > 0 ? p.grassLush : p.grassDry, Math.abs(tint) * 0.7);
    col = mix(col, p.grassLush, clamp(tint2 * 0.25, 0, 0.25));

    const desert = smoothstep(c.desert.startX, c.desert.fullX, x);
    if (desert > 0) col = mix(col, p.desert, desert);
    const forest = smoothstep(c.forest.startX, c.forest.fullX, x);
    if (forest > 0) col = mix(col, p.forest, forest * 0.8);

    const beach = smoothstep(c.seaLevel + 5, c.seaLevel + 1.5, h);
    if (beach > 0) col = mix(col, p.sand, beach);
    if (h < c.seaLevel - 1.5) col = mix(col, p.seaFloor, smoothstep(c.seaLevel - 1.5, c.seaLevel - 8, h));

    // Caminos (solo cerca del valle, que es donde están definidos por ahora).
    if (this.isNearValley(x, z)) {
      for (const path of c.paths) {
        const d = distToPolyline(x, z, path.points);
        const edge = path.width / 2 + tint2 * 0.5;
        if (d < edge + 1.5) col = mix(col, p.dirt, smoothstep(edge + 1.5, edge - 0.4, d) * 0.9);
      }
    }

    // Lechos de río y lago.
    const water = this.waterLevelAt(x, z);
    if (water !== null && water > c.seaLevel && h < water + 0.25) col = mix(col, p.riverBed, smoothstep(water + 0.25, water - 0.6, h));

    const rock = smoothstep(0.83, 0.68, normalY);
    if (rock > 0) col = mix(col, tint2 > 0 ? p.rock : p.rockDark, rock);

    const snow = smoothstep(c.snowLine - 30, c.snowLine + 40, h + tint * 25) * (1 - rock * 0.55);
    if (snow > 0) col = mix(col, p.snow, snow);

    out[offset] = col[0];
    out[offset + 1] = col[1];
    out[offset + 2] = col[2];
  }

  // ------------------------------------------------------------------ internos

  private gridHeight(gx: number, gz: number): number {
    // Clave entera única para |g| < 2^20 (≈ ±2 000 km con rejilla de 2 m).
    const key = (gx + 1048576) * 2097152 + (gz + 1048576);
    let h = this.cache.get(key);
    if (h === undefined) {
      if (this.cache.size > 65536) this.cache.clear();
      h = this.rawHeight(gx * this.cfg.physicsGrid, gz * this.cfg.physicsGrid);
      this.cache.set(key, h);
    }
    return h;
  }

  private isNearValley(x: number, z: number): boolean {
    const [cx, cz] = this.cfg.valley.center;
    return Math.abs(x - cx) < this.valleyExtent + 80 && Math.abs(z - cz) < this.valleyExtent + 80;
  }

  private baseHeight(x: number, z: number): number {
    const c = this.cfg;
    const n = this.noise;
    const r = Math.hypot(x, z) / c.continent.radius + n.fbm(x * 0.0005, z * 0.0005, 3) * c.continent.coastNoise;
    const land = 1 - smoothstep(0.8, 1.0, r);
    if (land <= 0) return c.continent.seaFloor + n.fbm(x * 0.003, z * 0.003, 2) * 4;

    let h = c.plains.height + n.fbm(x * c.plains.scale, z * c.plains.scale, 4) * c.plains.amplitude;

    const mN = smoothstep(c.mountains.startZ, c.mountains.fullZ, z);
    if (mN > 0) h += mN * (n.ridged(x * c.mountains.scale, z * c.mountains.scale, 5) * c.mountains.height + 40);

    const mE = smoothstep(c.desert.startX, c.desert.fullX, x);
    if (mE > 0) {
      const dunes = n.ridged(x * c.desert.duneScale * 0.6, z * c.desert.duneScale, 2) * c.desert.duneAmplitude;
      h = lerp(h, c.desert.height + dunes, mE * (1 - mN));
    }

    const mW = smoothstep(c.forest.startX, c.forest.fullX, x);
    if (mW > 0) {
      const hills = c.forest.height + n.fbm(x * c.forest.scale, z * c.forest.scale, 4) * c.forest.amplitude;
      h = lerp(h, hills, mW * (1 - mN));
    }

    return lerp(c.continent.seaFloor, h, land);
  }

  private applyValley(x: number, z: number, base: number): number {
    const v = this.cfg.valley;
    const n = this.noise;
    const u = x - v.center[0];
    const w = z - v.center[1];
    if (Math.abs(u) > this.valleyExtent || Math.abs(w) > this.valleyExtent) return base;

    // Contorno "squircle" (cuadrado redondeado) deformado por ruido para que no se vea geométrico.
    const d = Math.pow(u * u * u * u + w * w * w * w, 0.25) + n.noise(x * 0.012, z * 0.012) * v.edgeNoise;
    if (d >= v.outerEnd) return base;

    let floor = v.floorHeight + n.fbm(x * 0.03, z * 0.03, 2) * v.floorNoise;
    for (const m of v.mounds) {
      const md = Math.hypot(x - m.center[0], z - m.center[1]);
      if (md < m.radius) floor += m.height * smoothstep(m.radius, 0, md);
    }
    const top = v.wallTop + n.fbm(x * 0.008, z * 0.008, 3) * v.wallNoise + n.ridged(x * 0.04, z * 0.04, 2) * 7;

    let h: number;
    if (d < v.innerRadius) h = floor;
    else if (d < v.outerStart) h = lerp(floor, top, smoothstep(v.innerRadius, v.wallRadius, d));
    else h = lerp(top, base, smoothstep(v.outerStart, v.outerEnd, d));

    // Corredor de salida al sur: recorta la pared hasta el suelo del valle.
    // `min` hace que, donde la ladera exterior cae por debajo del suelo, quede un acantilado.
    const cor = v.corridor;
    const cf = (1 - smoothstep(cor.halfWidth, cor.halfWidth + cor.blend, Math.abs(u))) * smoothstep(cor.startZ - 30, cor.startZ, w);
    if (cf > 0) h = lerp(h, Math.min(h, floor), cf);
    return h;
  }

  private carveWater(x: number, z: number, h: number): number {
    for (const r of this.rivers) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const def = r.def;
      const hw = def.width / 2;
      const d = distToPolyline(x, z, def.points);
      if (d < hw + def.bankWidth) h = Math.min(h, lerp(def.waterLevel - def.depth, h, smoothstep(hw * 0.55, hw + def.bankWidth, d)));
    }
    for (const l of this.lakes) {
      if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
      const def = l.def;
      const d = Math.hypot(x - def.center[0], z - def.center[1]);
      if (d < def.radius + 10) h = Math.min(h, lerp(def.waterLevel - def.depth, h, smoothstep(def.radius * 0.5, def.radius + 10, d)));
    }
    return h;
  }
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
