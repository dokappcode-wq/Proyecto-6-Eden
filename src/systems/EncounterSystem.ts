import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import type { EncountersConfig } from '../data/schemas';
import type { EncounterProps } from '../world/camps/EncounterProps';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { EnemySystem } from './EnemySystem';
import type { PickupSystem } from './PickupSystem';
import type { PlayerSystem } from './PlayerSystem';

/**
 * Encuentros del mundo: decorado de campamentos y arenas, cofres que se abren al despejar
 * un campamento, recompensa del jefe y teletransporte de depuración (F7) a cada encuentro.
 */
export class EncounterSystem implements System {
  readonly name = 'encounters';
  /** Cofres ya abiertos (se guarda en la partida). */
  readonly chestsOpened = new Set<string>();
  private readonly chestEntities = new Map<string, Entity>();
  private teleportIndex = -1;

  constructor(
    private readonly cfg: EncountersConfig,
    private readonly props: EncounterProps,
    private readonly enemies: EnemySystem,
    private readonly pickups: PickupSystem,
    private readonly player: PlayerSystem,
    private readonly terrain: TerrainGenerator,
    private readonly isNight: () => boolean,
    scene: THREE.Scene,
    ctx: GameContext,
  ) {
    scene.add(props.group);
    for (const camp of cfg.camps) {
      const [x, z] = camp.chest.position;
      const e = ctx.world.createEntity();
      ctx.world.add(e, 'name', { value: `chest_${camp.id}` });
      ctx.world.add(e, 'transform', createTransform(x, terrain.height(x, z), z));
      ctx.world.add(e, 'interactable', { id: `chest:${camp.id}`, kind: 'chest', prompt: 'Abrir cofre', radius: 1.9, enabled: false });
      this.chestEntities.set(camp.id, e);
    }
    ctx.bus.on('camp:cleared', ({ camp }) => {
      if (this.chestsOpened.has(camp)) return;
      const e = this.chestEntities.get(camp);
      const it = e !== undefined ? ctx.world.get(e, 'interactable') : undefined;
      if (it) it.enabled = true;
    });
    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind !== 'chest' || !id.startsWith('chest:')) return;
      this.openChest(ctx, id.slice(6));
    });
    ctx.bus.on('boss:defeated', ({ id, x, y, z }) => {
      const boss = cfg.bosses.find((b) => b.id === id);
      if (boss) this.pickups.dropLoot(ctx, boss.reward, x, y + 1, z);
    });
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action === 'debug_teleport' && phase === 'pressed' && ctx.session.mode === 'play') this.teleportNext(ctx);
    });
  }

  /** Restaura los cofres abiertos al cargar partida. */
  restore(ctx: GameContext, opened: Iterable<string>): void {
    this.chestsOpened.clear();
    for (const [id, e] of this.chestEntities) {
      const it = ctx.world.get(e, 'interactable');
      if (it) it.enabled = false;
      const chest = this.props.chests.get(id);
      if (chest) {
        chest.open = 0;
        chest.opening = false;
      }
    }
    for (const id of opened) {
      this.chestsOpened.add(id);
      const chest = this.props.chests.get(id);
      if (chest) {
        chest.open = 1;
        chest.opening = true;
      }
    }
  }

  render(ctx: GameContext): void {
    this.props.update(ctx.time.elapsed, ctx.time.frameDt, this.isNight());
  }

  private openChest(ctx: GameContext, campId: string): void {
    const camp = this.cfg.camps.find((c) => c.id === campId);
    const chest = this.props.chests.get(campId);
    const e = this.chestEntities.get(campId);
    if (!camp || !chest || e === undefined || this.chestsOpened.has(campId)) return;
    if (!this.enemies.campStatus(campId)?.cleared) return;
    const it = ctx.world.get(e, 'interactable');
    if (it) it.enabled = false;
    chest.opening = true;
    this.chestsOpened.add(campId);
    const [x, z] = camp.chest.position;
    const yaw = camp.chest.yaw;
    // El botín sale por delante del cofre.
    this.pickups.dropLoot(ctx, camp.chest.loot, x + Math.sin(yaw) * 1.1, this.terrain.height(x, z) + 0.6, z + Math.cos(yaw) * 1.1);
    ctx.bus.emit('chest:opened', { id: campId });
  }

  private teleportNext(ctx: GameContext): void {
    const list = this.cfg.teleports;
    if (list.length === 0) return;
    this.teleportIndex = (this.teleportIndex + 1) % list.length;
    const tp = list[this.teleportIndex];
    const [x, z] = tp.position;
    const y = this.enemies.groundAt(x, z, 1e4) + 0.3;
    this.player.placeFree(ctx, x, y, z, ctx.world.require(this.player.entity, 'character').yaw);
    ctx.bus.emit('debug:teleport', { name: tp.name });
  }
}
