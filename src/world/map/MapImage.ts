import type { TerrainConfig } from '../../data/schemas';
import { biomeAt } from '../biomes';
import type { TerrainGenerator } from '../terrain/TerrainGenerator';

/** Color RGB del mapa para un punto (lógica pura, testeable sin canvas). */
export function mapColor(terrain: TerrainGenerator, cfg: TerrainConfig, x: number, z: number): [number, number, number] {
  const h = terrain.height(x, z);
  const w = terrain.waterLevelAt(x, z);
  if (w !== null && w > h + 0.15) {
    const depth = w - h;
    const k = Math.min(1, depth / 25);
    return mix([95, 170, 196], [24, 70, 104], k);
  }
  const biome = biomeAt(cfg, x, h, z, h);
  let base: [number, number, number];
  switch (biome) {
    case 'desert':
      base = [217, 168, 98];
      break;
    case 'forest':
      base = [62, 118, 60];
      break;
    case 'mountains':
      base = h > cfg.snowLine ? [236, 242, 248] : mix([138, 130, 120], [190, 188, 184], Math.min(1, (h - 120) / 260));
      break;
    case 'archipelago':
    case 'sea':
      base = [216, 196, 140];
      break;
    default:
      base = [128, 172, 88];
  }
  // Playa cerca del nivel del mar.
  if (h < cfg.seaLevel + 2.5) base = mix(base, [222, 204, 150], 0.7);
  // Sombreado de relieve (luz del noroeste).
  const n = terrain.normal(x, z);
  const shade = 0.5 + 0.8 * Math.max(0, n.x * -0.6 + n.y * 0.62 + n.z * -0.5);
  return [clamp255(base[0] * shade), clamp255(base[1] * shade), clamp255(base[2] * shade)];
}

function mix(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Imagen del mapa del mundo generada poco a poco (unas filas por fotograma) para no
 * congelar el arranque. `canvas` se puede dibujar aunque no esté completa.
 */
export class MapImage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private row = 0;

  constructor(
    private readonly terrain: TerrainGenerator,
    private readonly cfg: TerrainConfig,
    readonly size: number,
    readonly worldSize: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    const c = this.canvas.getContext('2d');
    if (!c) throw new Error('Canvas 2D no disponible para el mapa');
    this.ctx = c;
    this.image = c.createImageData(size, size);
    c.fillStyle = '#16384c';
    c.fillRect(0, 0, size, size);
  }

  get done(): boolean {
    return this.row >= this.size;
  }

  /** Genera filas durante `budgetMs` milisegundos. */
  step(budgetMs: number): void {
    if (this.done) return;
    const t0 = performance.now();
    const s = this.size;
    const cell = this.worldSize / s;
    const half = this.worldSize / 2;
    const first = this.row;
    while (this.row < s && performance.now() - t0 < budgetMs) {
      const z = (this.row + 0.5) * cell - half;
      for (let px = 0; px < s; px++) {
        const [r, g, b] = mapColor(this.terrain, this.cfg, (px + 0.5) * cell - half, z);
        const i = (this.row * s + px) * 4;
        this.image.data[i] = r;
        this.image.data[i + 1] = g;
        this.image.data[i + 2] = b;
        this.image.data[i + 3] = 255;
      }
      this.row++;
    }
    this.ctx.putImageData(this.image, 0, 0, 0, first, s, this.row - first);
  }

  /** Genera todo de golpe (tests, o si se abre el mapa antes de terminar). */
  finish(): void {
    while (!this.done) this.step(1000);
  }
}
