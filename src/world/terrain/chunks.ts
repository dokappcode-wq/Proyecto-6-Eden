import type { TerrainConfig } from '../../data/schemas';

export interface ChunkRequest {
  cx: number;
  cz: number;
  lod: number;
  /** Menor = más urgente. */
  priority: number;
  /** Distancia del foco al rectángulo del chunk. */
  distance: number;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Distancia de un punto al rectángulo de un chunk (0 si está dentro). */
export function distanceToChunk(x: number, z: number, cx: number, cz: number, size: number): number {
  const minX = cx * size;
  const minZ = cz * size;
  const dx = Math.max(minX - x, 0, x - (minX + size));
  const dz = Math.max(minZ - z, 0, z - (minZ + size));
  return Math.hypot(dx, dz);
}

/**
 * Chunks que deberían existir alrededor del foco, con su LOD y prioridad.
 * La prioridad favorece la dirección de movimiento (punto adelantado `lookAheadSeconds`),
 * pensado para que el planeador nunca vuele hacia terreno sin cargar.
 */
export function desiredChunks(
  focusX: number,
  focusZ: number,
  velX: number,
  velZ: number,
  cfg: TerrainConfig['chunk'],
  worldSize: number,
): ChunkRequest[] {
  const size = cfg.size;
  const maxDist = cfg.lodDistances[2];
  const aheadX = focusX + velX * cfg.lookAheadSeconds;
  const aheadZ = focusZ + velZ * cfg.lookAheadSeconds;
  const half = worldSize / 2;
  const minC = Math.floor(-half / size);
  const maxC = Math.ceil(half / size) - 1;
  const r = Math.ceil(maxDist / size) + 1;
  const fcx = Math.floor(focusX / size);
  const fcz = Math.floor(focusZ / size);
  const out: ChunkRequest[] = [];

  for (let cx = Math.max(minC, fcx - r); cx <= Math.min(maxC, fcx + r); cx++) {
    for (let cz = Math.max(minC, fcz - r); cz <= Math.min(maxC, fcz + r); cz++) {
      const d = distanceToChunk(focusX, focusZ, cx, cz, size);
      if (d > maxDist) continue;
      const lod = d < cfg.lodDistances[0] ? 0 : d < cfg.lodDistances[1] ? 1 : 2;
      const dAhead = distanceToChunk(aheadX, aheadZ, cx, cz, size);
      out.push({ cx, cz, lod, distance: d, priority: Math.min(d, dAhead * 0.8) + lod * 40 });
    }
  }
  out.sort((a, b) => a.priority - b.priority);
  return out;
}
