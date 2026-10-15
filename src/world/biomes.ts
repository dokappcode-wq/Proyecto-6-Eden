import { smoothstep } from '../core/math';
import type { BiomeId, TerrainConfig } from '../data/schemas';

/** Altura sobre la que empieza la capa del cielo (islas flotantes). */
export const SKY_LAYER_Y = 260;

/**
 * Bioma en un punto según la disposición del continente (montañas al norte, desierto al este,
 * bosques al oeste, archipiélago al oeste/suroeste, mar alrededor) y la capa vertical.
 * Lógica pura: la usan el clima, la temperatura, la música y el mapa.
 */
export function biomeAt(cfg: TerrainConfig, x: number, y: number, z: number, groundY: number): BiomeId {
  if (y < groundY - 6) return 'underground';
  if (y > SKY_LAYER_Y && y - groundY > 120) return 'sky';
  if (groundY < cfg.seaLevel - 1.5) {
    const arch = cfg.archipelago;
    if (arch && Math.hypot(x - arch.center[0], z - arch.center[1]) < arch.radius) return 'archipelago';
    return 'sea';
  }
  const arch = cfg.archipelago;
  if (arch && Math.hypot(x - arch.center[0], z - arch.center[1]) < arch.radius) return 'archipelago';
  const weights: [BiomeId, number][] = [
    ['mountains', smoothstep(cfg.mountains.startZ, cfg.mountains.fullZ, z)],
    ['desert', smoothstep(cfg.desert.startX, cfg.desert.fullX, x)],
    ['forest', smoothstep(cfg.forest.startX, cfg.forest.fullX, x)],
  ];
  let best: BiomeId = 'plains';
  let bw = 0.5;
  for (const [id, w] of weights) {
    if (w > bw) {
      bw = w;
      best = id;
    }
  }
  return best;
}
