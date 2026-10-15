import type { ElementsConfig } from '../../data/schemas';

export interface FireCell {
  ix: number;
  iz: number;
  x: number;
  y: number;
  z: number;
  state: 'burning' | 'burnt';
  /** Segundos en el estado actual. */
  t: number;
}

const NEIGHBORS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Fuego sistémico sobre una rejilla dispersa: la hierba prende, el fuego se propaga
 * (más a favor del viento), se consume dejando ceniza que vuelve a crecer, la lluvia
 * lo apaga y las llamas generan una corriente térmica ascendente para el planeador.
 * Lógica pura (sin Three.js).
 */
export class FireField {
  readonly cells = new Map<number, FireCell>();
  private burningCount = 0;

  constructor(
    private readonly cfg: ElementsConfig['fire'],
    /** ¿Hay combustible (hierba, madera) en este punto? */
    private readonly flammable: (x: number, z: number) => boolean,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  get burning(): number {
    return this.burningCount;
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** Prende fuego en un punto. Devuelve true si ha prendido. */
  ignite(x: number, z: number, rain = 0): boolean {
    if (rain >= this.cfg.rainExtinguish) return false;
    const s = this.cfg.cellSize;
    const ix = Math.round(x / s);
    const iz = Math.round(z / s);
    return this.igniteCell(ix, iz);
  }

  /** Prende un área (bastón de fuego, rayo, explosión). */
  igniteArea(x: number, z: number, radius: number, rain = 0): number {
    let n = 0;
    const s = this.cfg.cellSize;
    for (let dx = -radius; dx <= radius; dx += s) {
      for (let dz = -radius; dz <= radius; dz += s) {
        if (dx * dx + dz * dz <= radius * radius && this.ignite(x + dx, z + dz, rain)) n++;
      }
    }
    return n;
  }

  private igniteCell(ix: number, iz: number): boolean {
    const k = this.key(ix, iz);
    if (this.cells.has(k) || this.burningCount >= this.cfg.maxCells) return false;
    const s = this.cfg.cellSize;
    const x = ix * s;
    const z = iz * s;
    if (!this.flammable(x, z)) return false;
    this.cells.set(k, { ix, iz, x, y: this.groundAt(x, z), z, state: 'burning', t: 0 });
    this.burningCount++;
    return true;
  }

  /** Apaga las llamas en un radio (agua, hielo). */
  extinguish(x: number, z: number, radius: number): number {
    let n = 0;
    for (const c of this.cells.values()) {
      if (c.state === 'burning' && Math.hypot(c.x - x, c.z - z) <= radius) {
        c.state = 'burnt';
        c.t = 0;
        this.burningCount--;
        n++;
      }
    }
    return n;
  }

  /**
   * Un paso: propagación con viento, consumo y rebrote. Devuelve las celdas que
   * acaban de prender (para efectos).
   */
  step(dt: number, windX: number, windZ: number, rain: number, rng: () => number): FireCell[] {
    const born: FireCell[] = [];
    const wl = Math.hypot(windX, windZ);
    const extinguishing = rain >= this.cfg.rainExtinguish;
    const toIgnite: [number, number][] = [];
    for (const [k, c] of this.cells) {
      c.t += dt;
      if (c.state === 'burnt') {
        if (c.t >= this.cfg.regrowSeconds) this.cells.delete(k);
        continue;
      }
      // La lluvia apaga el fuego deprisa.
      if (c.t >= this.cfg.burnSeconds * (extinguishing ? 0.15 : 1)) {
        c.state = 'burnt';
        c.t = 0;
        this.burningCount--;
        continue;
      }
      if (extinguishing) continue;
      for (const [dx, dz] of NEIGHBORS) {
        const d = Math.hypot(dx, dz);
        // A favor del viento se propaga mucho más; en contra, apenas.
        const along = wl > 0.01 ? (dx * windX + dz * windZ) / (d * wl) : 0;
        const windK = Math.max(0.15, 1 + along * this.cfg.windBias * Math.min(1.5, wl / 3));
        const p = (this.cfg.spreadChance / d) * windK * dt;
        if (rng() < p) toIgnite.push([c.ix + dx, c.iz + dz]);
      }
    }
    for (const [ix, iz] of toIgnite) {
      if (this.igniteCell(ix, iz)) {
        const c = this.cells.get(this.key(ix, iz));
        if (c) born.push(c);
      }
    }
    return born;
  }

  /** ¿Arde el suelo en este punto? */
  isBurning(x: number, z: number): boolean {
    const s = this.cfg.cellSize;
    const c = this.cells.get(this.key(Math.round(x / s), Math.round(z / s)));
    return c?.state === 'burning';
  }

  /** Celdas ardiendo en un radio. */
  burningNear(x: number, z: number, radius: number): number {
    let n = 0;
    for (const c of this.cells.values()) if (c.state === 'burning' && Math.abs(c.x - x) <= radius && Math.abs(c.z - z) <= radius && Math.hypot(c.x - x, c.z - z) <= radius) n++;
    return n;
  }

  /** Llama más cercana dentro de `radius` (para que los enemigos huyan). */
  nearest(x: number, z: number, radius: number): FireCell | null {
    let best: FireCell | null = null;
    let bd = radius;
    for (const c of this.cells.values()) {
      if (c.state !== 'burning') continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * Corriente térmica sobre el incendio: cuantas más celdas arden debajo, más sube.
   * Se debilita cerca de su techo para que el planeador "flote" arriba.
   */
  liftAt(x: number, y: number, z: number): number {
    if (this.burningCount === 0) return 0;
    const r = this.cfg.thermalRadius;
    let n = 0;
    let baseY = Infinity;
    for (const c of this.cells.values()) {
      if (c.state !== 'burning' || Math.abs(c.x - x) > r || Math.abs(c.z - z) > r) continue;
      if (Math.hypot(c.x - x, c.z - z) > r) continue;
      n++;
      baseY = Math.min(baseY, c.y);
    }
    if (n === 0) return 0;
    const rel = y - baseY;
    if (rel < -1 || rel > this.cfg.thermalHeight) return 0;
    const top = 1 - Math.max(0, (rel - this.cfg.thermalHeight * 0.75) / (this.cfg.thermalHeight * 0.25));
    return Math.min(this.cfg.maxLift, n * this.cfg.liftPerCell) * top;
  }

  clear(): void {
    this.cells.clear();
    this.burningCount = 0;
  }
}
