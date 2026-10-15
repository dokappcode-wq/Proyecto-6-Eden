import { createRng } from '../../core/math';

/**
 * Niebla de guerra: rejilla de celdas sobre todo el mundo con un valor 0-255 (255 = visto).
 * Las torres revelan regiones de borde orgánico (radio perturbado por el ángulo) y el jugador
 * revela lo que tiene alrededor. Lógica pura y serializable (RLE en base64).
 */
export class FogOfWar {
  readonly cells: Uint8Array;
  private readonly cell: number;
  private readonly half: number;
  /** Se incrementa cada vez que cambia algo (para repintar el mapa solo si hace falta). */
  version = 0;

  constructor(
    readonly resolution: number,
    readonly worldSize: number,
  ) {
    this.cells = new Uint8Array(resolution * resolution);
    this.cell = worldSize / resolution;
    this.half = worldSize / 2;
  }

  get cellSize(): number {
    return this.cell;
  }

  /** Valor 0..1 en un punto del mundo. */
  at(x: number, z: number): number {
    const cx = Math.floor((x + this.half) / this.cell);
    const cz = Math.floor((z + this.half) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.resolution || cz >= this.resolution) return 0;
    return this.cells[cz * this.resolution + cx] / 255;
  }

  /** Círculo de borde suave (lo que ve el jugador). */
  revealCircle(x: number, z: number, radius: number, soft = 0.35): boolean {
    return this.reveal(x, z, radius * (1 + soft), (dx, dz) => {
      const d = Math.hypot(dx, dz);
      return 1 - smooth(radius * (1 - soft * 0.5), radius * (1 + soft), d);
    });
  }

  /**
   * Región orgánica alrededor de una torre: el radio varía con el ángulo (ondulaciones
   * deterministas por semilla). `progress` (0..1) permite animar el escaneo.
   */
  revealOrganic(x: number, z: number, radius: number, seed: number, progress = 1): boolean {
    const shape = organicShape(seed);
    const r = radius * Math.max(0, Math.min(1, progress));
    if (r <= 0) return false;
    return this.reveal(x, z, r * 1.35, (dx, dz) => {
      const d = Math.hypot(dx, dz);
      const edge = r * shape(Math.atan2(dz, dx));
      return 1 - smooth(edge * 0.86, edge, d);
    });
  }

  /** Fracción del mundo descubierta (0..1). */
  get fraction(): number {
    let sum = 0;
    for (let i = 0; i < this.cells.length; i++) sum += this.cells[i];
    return sum / (255 * this.cells.length);
  }

  serialize(): string {
    const out: number[] = [];
    let i = 0;
    while (i < this.cells.length) {
      const v = this.cells[i];
      let n = 1;
      while (i + n < this.cells.length && this.cells[i + n] === v && n < 255) n++;
      out.push(v, n);
      i += n;
    }
    let bin = '';
    for (let k = 0; k < out.length; k += 4096) bin += String.fromCharCode(...out.slice(k, k + 4096));
    return btoa(bin);
  }

  /** Restaura desde `serialize`; devuelve false si el dato no encaja (y deja la niebla vacía). */
  restore(data: string): boolean {
    this.cells.fill(0);
    this.version++;
    if (!data) return true;
    try {
      const bin = atob(data);
      let p = 0;
      for (let k = 0; k + 1 < bin.length; k += 2) {
        const v = bin.charCodeAt(k);
        const n = bin.charCodeAt(k + 1);
        if (p + n > this.cells.length) throw new Error('niebla de otro tamaño');
        this.cells.fill(v, p, p + n);
        p += n;
      }
      if (p !== this.cells.length) throw new Error('niebla incompleta');
      return true;
    } catch {
      this.cells.fill(0);
      return false;
    }
  }

  private reveal(x: number, z: number, extent: number, value: (dx: number, dz: number) => number): boolean {
    const res = this.resolution;
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - extent + this.half) / c));
    const x1 = Math.min(res - 1, Math.floor((x + extent + this.half) / c));
    const z0 = Math.max(0, Math.floor((z - extent + this.half) / c));
    const z1 = Math.min(res - 1, Math.floor((z + extent + this.half) / c));
    let changed = false;
    for (let cz = z0; cz <= z1; cz++) {
      const wz = (cz + 0.5) * c - this.half;
      for (let cx = x0; cx <= x1; cx++) {
        const wx = (cx + 0.5) * c - this.half;
        const v = Math.round(Math.max(0, Math.min(1, value(wx - x, wz - z))) * 255);
        const i = cz * res + cx;
        if (v > this.cells[i]) {
          this.cells[i] = v;
          changed = true;
        }
      }
    }
    if (changed) this.version++;
    return changed;
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Factor de radio por ángulo (≈0.7..1.15): suma de ondas con fases aleatorias. */
export function organicShape(seed: number): (angle: number) => number {
  const rng = createRng(seed);
  const waves = [2, 3, 5, 7, 11].map((k) => ({ k, phase: rng() * Math.PI * 2, amp: (0.5 + rng() * 0.5) / k }));
  const norm = waves.reduce((s, w) => s + w.amp, 0);
  return (a) => {
    let v = 0;
    for (const w of waves) v += Math.sin(a * w.k + w.phase) * w.amp;
    return 0.93 + (v / norm) * 0.22;
  };
}

/** Semilla estable a partir de un id (para que cada torre tenga siempre la misma forma). */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
