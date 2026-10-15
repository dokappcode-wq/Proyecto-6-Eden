import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { SaveData, SaveStore } from '../core/save';
import { serializeEquipment, type Equipment } from '../combat/inventory';
import type { ValleyProgress } from './ValleyProgressSystem';

export const MAIN_SLOT = 'slot1';

export interface SaveSources {
  tutorialIds(): string[];
  hour(): number;
  day(): number;
  gateOpen(): boolean;
  progress(): ValleyProgress;
  /** No se guarda dentro de un templo (se reanuda siempre en el mundo). */
  canSave(): boolean;
  equipment(): Equipment;
  collected(): string[];
  chestsOpened(): string[];
  bossesDefeated(): string[];
  progression(): NonNullable<SaveData['progression']>;
  mobility(): NonNullable<SaveData['mobility']>;
  map(): NonNullable<SaveData['map']>;
}

/**
 * Guardado: manual en la cápsula (punto de guardado) y automático al completar
 * pasos del tutorial o abrir la salida del valle.
 */
export class SaveSystem implements System {
  readonly name = 'save';

  constructor(
    private readonly store: SaveStore,
    private readonly playerEntity: Entity,
    private readonly sources: SaveSources,
    ctx: GameContext,
  ) {
    ctx.bus.on('interact', ({ kind }) => {
      if (kind !== 'capsule') return;
      // La primera interacción abre la cápsula; las siguientes guardan.
      if (ctx.world.require(playerEntity, 'player').control === 'free') this.save(ctx, 'manual');
    });
    ctx.bus.on('capsule:exited', () => this.save(ctx, 'auto'));
    ctx.bus.on('tutorial:step_completed', () => this.save(ctx, 'auto'));
    ctx.bus.on('valley:gate_opened', () => this.save(ctx, 'auto'));
    ctx.bus.on('tower:activated', () => this.save(ctx, 'auto'));
    ctx.bus.on('temple:exit', () => this.save(ctx, 'auto'));
    ctx.bus.on('item:picked', () => this.save(ctx, 'auto'));
    ctx.bus.on('chest:opened', () => this.save(ctx, 'auto'));
    ctx.bus.on('boss:defeated', () => this.save(ctx, 'auto'));
    ctx.bus.on('player:blessed', () => this.save(ctx, 'auto'));
    ctx.bus.on('armor:upgraded', () => this.save(ctx, 'auto'));
    ctx.bus.on('food:cooked', () => this.save(ctx, 'auto'));
    ctx.bus.on('mount:tamed', () => this.save(ctx, 'auto'));
    ctx.bus.on('tower:scan', ({ phase }) => phase === 'end' && this.save(ctx, 'auto'));
    ctx.bus.on('player:traveled', () => this.save(ctx, 'auto'));
    ctx.bus.on('breakable:destroyed', () => this.save(ctx, 'auto'));
  }

  load(): SaveData | null {
    return this.store.read(MAIN_SLOT);
  }

  save(ctx: GameContext, kind: 'manual' | 'auto'): void {
    if (ctx.session.mode !== 'play' || !this.sources.canSave()) return;
    const p = ctx.world.require(this.playerEntity, 'player');
    const ch = ctx.world.require(this.playerEntity, 'character');
    const ok = this.store.write(MAIN_SLOT, {
      tutorial: this.sources.tutorialIds(),
      hour: this.sources.hour(),
      day: this.sources.day(),
      exitedCapsule: p.control === 'free' || p.control === 'locked',
      gateOpen: this.sources.gateOpen(),
      // Última posición segura en tierra (nunca a media caída, en una pared o en el agua).
      player: p.control === 'capsule' ? { x: ch.x, y: ch.y, z: ch.z, yaw: ch.yaw } : { x: ch.safeX, y: ch.safeY, z: ch.safeZ, yaw: ch.yaw },
      health: { fragments: Math.max(1, p.health.fragments), maxFragments: p.health.maxFragments },
      progress: { ...this.sources.progress() },
      equipment: serializeEquipment(this.sources.equipment()),
      collected: this.sources.collected(),
      world: { chestsOpened: this.sources.chestsOpened(), bossesDefeated: this.sources.bossesDefeated() },
      progression: this.sources.progression(),
      mobility: this.sources.mobility(),
      map: this.sources.map(),
    });
    if (ok && kind === 'manual') ctx.bus.emit('game:saved', { slot: MAIN_SLOT });
  }
}
