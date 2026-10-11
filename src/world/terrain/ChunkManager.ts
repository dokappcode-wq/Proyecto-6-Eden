import * as THREE from 'three';
import { hash2 } from '../../core/math';
import type { TerrainConfig } from '../../data/schemas';
import { buildTrees, disposeInstancedGroup, type TreeInstance } from '../props/kit';
import { chunkKey, desiredChunks, distanceToChunk, type ChunkRequest } from './chunks';
import type { TerrainGenerator } from './TerrainGenerator';

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh;
  vegetation: THREE.Group | null;
}

export interface ChunkStats {
  loaded: number;
  pending: number;
  builtLastFrame: number;
  lastBuildMs: number;
  byLod: [number, number, number];
}

/**
 * Streaming de terreno por chunks con 3 LOD. Construye en el hilo principal
 * con presupuesto de ms por frame (time-slicing) y prioriza la dirección de movimiento.
 * Las "faldas" (skirts) ocultan las grietas entre chunks de distinto LOD.
 */
export class ChunkManager {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  /** Centro alrededor del cual TODOS los chunks deseados están construidos (lo usa el terreno lejano). */
  readonly coveredCenter = new THREE.Vector2(Number.NaN, Number.NaN);
  readonly stats: ChunkStats = { loaded: 0, pending: 0, builtLastFrame: 0, lastBuildMs: 0, byLod: [0, 0, 0] };

  constructor(
    private readonly terrain: TerrainGenerator,
    private readonly cfg: TerrainConfig,
  ) {
    this.group.name = 'terrain-chunks';
  }

  /** Llamar una vez por frame con la posición y velocidad del foco (jugador). */
  update(x: number, z: number, vx: number, vz: number, budgetMs = this.cfg.chunk.buildBudgetMs): void {
    const desired = desiredChunks(x, z, vx, vz, this.cfg.chunk, this.cfg.worldSize);
    const todo: ChunkRequest[] = [];
    for (const req of desired) {
      const c = this.chunks.get(chunkKey(req.cx, req.cz));
      if (!c || c.lod !== req.lod) todo.push(req);
    }

    const start = performance.now();
    let built = 0;
    for (const req of todo) {
      if (built > 0 && performance.now() - start > budgetMs) break;
      this.build(req);
      built++;
    }
    this.stats.builtLastFrame = built;
    this.stats.pending = todo.length - built;

    // Descargar solo con la cola vacía: así nunca hay huecos dentro del radio cubierto.
    if (this.stats.pending === 0) {
      const limit = this.cfg.chunk.lodDistances[2] + this.cfg.chunk.unloadMargin;
      for (const [key, c] of this.chunks) {
        if (distanceToChunk(x, z, c.cx, c.cz, this.cfg.chunk.size) > limit) this.unload(key, c);
      }
      this.coveredCenter.set(x, z);
    }
    this.refreshStats();
  }

  /** Carga síncrona inicial (pantalla de carga). */
  preload(x: number, z: number): void {
    this.update(x, z, 0, 0, Infinity);
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  private build(req: ChunkRequest): void {
    const key = chunkKey(req.cx, req.cz);
    const old = this.chunks.get(key);
    const t0 = performance.now();
    const geometry = this.buildGeometry(req.cx, req.cz, req.lod);
    const size = this.cfg.chunk.size;

    let mesh: THREE.Mesh;
    if (old) {
      old.mesh.geometry.dispose();
      old.mesh.geometry = geometry;
      mesh = old.mesh;
    } else {
      mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(req.cx * size, 0, req.cz * size);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `chunk_${key}`;
      this.group.add(mesh);
    }

    const wantsVegetation = req.lod <= 1 && req.distance < this.cfg.chunk.vegetationDistance;
    let vegetation = old?.vegetation ?? null;
    if (wantsVegetation && !vegetation) {
      vegetation = buildTrees(this.scatterTrees(req.cx, req.cz));
      this.group.add(vegetation);
    } else if (!wantsVegetation && vegetation) {
      this.group.remove(vegetation);
      disposeInstancedGroup(vegetation);
      vegetation = null;
    }

    this.chunks.set(key, { cx: req.cx, cz: req.cz, lod: req.lod, mesh, vegetation });
    this.stats.lastBuildMs = performance.now() - t0;
  }

  private unload(key: string, c: Chunk): void {
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (c.vegetation) {
      this.group.remove(c.vegetation);
      disposeInstancedGroup(c.vegetation);
    }
    this.chunks.delete(key);
  }

  private buildGeometry(cx: number, cz: number, lod: number): THREE.BufferGeometry {
    const size = this.cfg.chunk.size;
    const res = this.cfg.chunk.lodResolutions[lod];
    const step = size / res;
    const x0 = cx * size;
    const z0 = cz * size;
    const n = res + 1;
    const skirt = this.cfg.chunk.skirtDepth;

    // Alturas con un borde extra para calcular normales continuas entre chunks.
    const b = n + 2;
    const heights = new Float32Array(b * b);
    for (let j = 0; j < b; j++) {
      for (let i = 0; i < b; i++) heights[j * b + i] = this.terrain.rawHeight(x0 + (i - 1) * step, z0 + (j - 1) * step);
    }
    const H = (i: number, j: number) => heights[(j + 1) * b + (i + 1)];

    const edgeCount = 4 * res;
    const vertCount = n * n + edgeCount;
    const pos = new Float32Array(vertCount * 3);
    const nor = new Float32Array(vertCount * 3);
    const col = new Float32Array(vertCount * 3);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        const h = H(i, j);
        pos[v * 3] = i * step;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = j * step;
        const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
        const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
        const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        nor[v * 3] = -dx * inv;
        nor[v * 3 + 1] = inv;
        nor[v * 3 + 2] = -dz * inv;
        this.terrain.surfaceColor(x0 + i * step, z0 + j * step, h, inv, col, v * 3);
      }
    }

    // Recorrido del perímetro (sentido fijo) para las faldas.
    const perimeter: number[] = [];
    for (let i = 0; i < res; i++) perimeter.push(i); // borde norte, oeste→este
    for (let j = 0; j < res; j++) perimeter.push(j * n + res); // borde este
    for (let i = res; i > 0; i--) perimeter.push(res * n + i); // borde sur
    for (let j = res; j > 0; j--) perimeter.push(j * n); // borde oeste

    perimeter.forEach((src, k) => {
      const v = n * n + k;
      pos[v * 3] = pos[src * 3];
      pos[v * 3 + 1] = pos[src * 3 + 1] - skirt;
      pos[v * 3 + 2] = pos[src * 3 + 2];
      for (let c = 0; c < 3; c++) {
        nor[v * 3 + c] = nor[src * 3 + c];
        col[v * 3 + c] = col[src * 3 + c] * 0.8;
      }
    });

    const indices: number[] = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * n + i;
        const bIdx = a + 1;
        const c = a + n;
        const d = c + 1;
        // Diagonal (i+1,j)-(i,j+1): idéntica a TerrainGenerator.height().
        indices.push(a, c, bIdx, bIdx, c, d);
      }
    }
    for (let k = 0; k < perimeter.length; k++) {
      const top0 = perimeter[k];
      const top1 = perimeter[(k + 1) % perimeter.length];
      const bot0 = n * n + k;
      const bot1 = n * n + ((k + 1) % perimeter.length);
      // Ambos sentidos: la falda debe verse desde fuera del chunk sea cual sea su orientación.
      indices.push(top0, bot0, top1, top1, bot0, bot1, top0, top1, bot0, top1, bot1, bot0);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Vegetación procedural determinista (fuera del valle, que está hecho a mano). */
  private scatterTrees(cx: number, cz: number): TreeInstance[] {
    const size = this.cfg.chunk.size;
    const c = this.cfg;
    const out: TreeInstance[] = [];
    const candidates = 48;
    for (let k = 0; k < candidates; k++) {
      const x = (cx + hash2(cx * 97 + k, cz, c.seed)) * size;
      const z = (cz + hash2(cx, cz * 89 + k, c.seed + 7)) * size;
      if (this.terrain.isInsideValley(x, z)) continue;
      const forest = clamp01((c.forest.startX - x) / (c.forest.startX - c.forest.fullX));
      const desert = clamp01((x - c.desert.startX) / (c.desert.fullX - c.desert.startX));
      const density = (0.1 + forest * 0.9) * (1 - desert);
      if (hash2(k, cx * 31 + cz, c.seed + 3) > density) continue;
      const h = this.terrain.rawHeight(x, z);
      if (h < c.seaLevel + 2 || h > c.snowLine - 40) continue;
      const water = this.terrain.waterLevelAt(x, z);
      if (water !== null && h < water + 0.5) continue;
      if (this.terrain.normal(x, z).y < 0.86) continue;
      const r = hash2(cx + k, cz - k, c.seed + 11);
      out.push({ x, y: h - 0.2, z, scale: 0.8 + r * 0.7, rotY: r * Math.PI * 2, kind: h > 140 || r > 0.6 + forest * 0.3 ? 'pine' : 'broadleaf' });
    }
    return out;
  }

  private refreshStats(): void {
    const byLod: [number, number, number] = [0, 0, 0];
    for (const c of this.chunks.values()) byLod[c.lod]++;
    this.stats.byLod = byLod;
    this.stats.loaded = this.chunks.size;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
