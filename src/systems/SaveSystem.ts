import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { SaveData, SaveStore } from '../core/save';

export const MAIN_SLOT = 'slot1';

export interface SaveSources {
  tutorialIds(): string[];
  hour(): number;
  day(): number;
  gateOpen(): boolean;
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
  }

  load(): SaveData | null {
    return this.store.read(MAIN_SLOT);
  }

  save(ctx: GameContext, kind: 'manual' | 'auto'): void {
    if (ctx.session.mode !== 'play') return;
    const p = ctx.world.require(this.playerEntity, 'player');
    const ch = ctx.world.require(this.playerEntity, 'character');
    const ok = this.store.write(MAIN_SLOT, {
      tutorial: this.sources.tutorialIds(),
      hour: this.sources.hour(),
      day: this.sources.day(),
      exitedCapsule: p.control === 'free',
      gateOpen: this.sources.gateOpen(),
      player: { x: ch.x, y: ch.y, z: ch.z, yaw: ch.yaw },
    });
    if (ok && kind === 'manual') ctx.bus.emit('game:saved', { slot: MAIN_SLOT });
  }
}
