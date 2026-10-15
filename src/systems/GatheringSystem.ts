import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import { createRng } from '../core/math';
import type { GatheringConfig, TerrainConfig } from '../data/schemas';
import { biomeAt } from '../world/biomes';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { PickupSystem } from './PickupSystem';

interface Spot {
  id: string;
  item: string;
  x: number;
  z: number;
}

/**
 * Ingredientes silvestres: cada celda del mundo tiene sus plantas, setas y bichos
 * (deterministas por semilla y según el bioma). Se crean al acercarse, se retiran al
 * alejarse y lo recogido rebrota tras un día de juego.
 */
export class GatheringSystem implements System {
  readonly name = 'gathering';
  /** Día (con decimales) en que se recogió cada planta. */
  readonly gathered = new Map<string, number>();
  private readonly active = new Map<string, Entity[]>();
  private readonly spots = new Map<string, Spot[]>();
  private readonly normal = { x: 0, y: 1, z: 0 };
  private timer = 0;

  constructor(
    private readonly cfg: GatheringConfig,
    private readonly terrainCfg: TerrainConfig,
    private readonly terrain: TerrainGenerator,
    private readonly colliders: StaticColliders,
    private readonly pickups: PickupSystem,
    private readonly playerEntity: Entity,
    private readonly today: () => number,
    ctx: GameContext,
  ) {
    ctx.bus.on('pickup:gathered', ({ sourceId }) => this.gathered.set(sourceId, this.today()));
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const t = ctx.world.require(this.playerEntity, 'transform');
    const cs = this.cfg.cellSize;
    const cx = Math.floor(t.x / cs);
    const cz = Math.floor(t.z / cs);
    const r = this.cfg.radius;
    const want = new Set<string>();
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) want.add(`${cx + dx},${cz + dz}`);
    for (const [key, ents] of this.active) {
      if (want.has(key)) continue;
      for (const e of ents) this.pickups.despawn(ctx, e);
      this.active.delete(key);
    }
    const day = this.today();
    for (const key of want) {
      if (this.active.has(key)) continue;
      const ents: Entity[] = [];
      for (const s of this.cellSpots(key)) {
        const when = this.gathered.get(s.id);
        if (when !== undefined && day - when < this.cfg.regrowDays) continue;
        this.gathered.delete(s.id);
        ents.push(this.pickups.drop(ctx, s.item, 1, s.x, this.terrain.height(s.x, s.z), s.z, null, s.id));
      }
      this.active.set(key, ents);
    }
  }

  /** Recolectado guardado (solo lo que aún no ha rebrotado). */
  save(): Record<string, number> {
    const day = this.today();
    const out: Record<string, number> = {};
    for (const [id, d] of this.gathered) if (day - d < this.cfg.regrowDays) out[id] = d;
    return out;
  }

  restore(ctx: GameContext, saved: Record<string, number>): void {
    for (const ents of this.active.values()) for (const e of ents) this.pickups.despawn(ctx, e);
    this.active.clear();
    this.gathered.clear();
    for (const [id, d] of Object.entries(saved)) this.gathered.set(id, d);
  }

  /** Puntos de recolección de una celda (deterministas). */
  private cellSpots(key: string): Spot[] {
    const hit = this.spots.get(key);
    if (hit) return hit;
    const [cx, cz] = key.split(',').map(Number);
    const cs = this.cfg.cellSize;
    const rng = createRng(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const out: Spot[] = [];
    this.cfg.rules.forEach((rule, ri) => {
      const n = Math.floor(rule.perCell + rng());
      for (let i = 0; i < n; i++) {
        const x = (cx + rng()) * cs;
        const z = (cz + rng()) * cs;
        const g = this.terrain.height(x, z);
        const w = this.terrain.waterLevelAt(x, z);
        if (w !== null && w > g - 0.2) continue;
        this.terrain.normal(x, z, this.normal);
        if (this.normal.y < 0.8) continue;
        if (!rule.biomes.includes(biomeAt(this.terrainCfg, x, g + 1, z, g))) continue;
        if (this.terrain.materialAt(x, z, this.normal.y) === 'valley_wall') continue;
        if (this.colliders.overlaps(x, g, z, 0.3, 1)) continue;
        out.push({ id: `gather:${key}:${ri}:${i}`, item: rule.item, x, z });
      }
    });
    if (this.spots.size > 400) this.spots.clear();
    this.spots.set(key, out);
    return out;
  }
}
