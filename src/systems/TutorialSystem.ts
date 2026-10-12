import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { TutorialStep } from '../data/schemas';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import { TutorialTracker, type TutorialFact } from './tutorial/TutorialTracker';

/** Traduce eventos del juego a hechos del tutorial y publica la pista actual. */
export class TutorialSystem implements System {
  readonly name = 'tutorial';
  tracker: TutorialTracker;
  private stepCounter = 0;

  constructor(
    private readonly playerEntity: Entity,
    private readonly terrain: TerrainGenerator,
    private readonly keyLabel: (action: string) => string,
    ctx: GameContext,
  ) {
    this.tracker = new TutorialTracker(ctx.data.tutorial, ctx.data.game.contentPhase);
    ctx.bus.on('interact', ({ id }) => this.report(ctx, { kind: 'interact', target: id }));
    ctx.bus.on('inscription:open', ({ id }) => this.report(ctx, { kind: 'read', id }));
    ctx.bus.on('player:climb', ({ phase }) => phase === 'start' && this.report(ctx, { kind: 'climb' }));
    ctx.bus.on('player:ledge', ({ phase }) => phase === 'exit' && this.report(ctx, { kind: 'climb' }));
    ctx.bus.on('temple:complete', ({ id }) => this.report(ctx, { kind: 'temple', target: id }));
    ctx.bus.on('enemy:defeated', ({ family }) => this.report(ctx, { kind: 'defeat', target: family }));
    ctx.bus.on('player:glide_land', ({ x, z }) => {
      // Aterrizar planeando dentro (o en la orilla) de un lago cuenta como "aterrizar en él".
      for (const lake of ctx.data.terrain.lakes) {
        if (Math.hypot(x - lake.center[0], z - lake.center[1]) <= lake.radius + 14) this.report(ctx, { kind: 'glide_land', target: lake.id });
      }
    });
  }

  /** Reinicia el progreso (nueva partida) o lo restaura (continuar). */
  reset(ctx: GameContext, completed: string[]): void {
    this.tracker = new TutorialTracker(ctx.data.tutorial, ctx.data.game.contentPhase, completed);
    this.publishHint(ctx);
  }

  fixedUpdate(ctx: GameContext): void {
    if (ctx.session.mode !== 'play') return;
    // La posición se comprueba 6 veces por segundo: suficiente para zonas de varios metros.
    if (++this.stepCounter % 10 !== 0) return;
    const p = ctx.world.require(this.playerEntity, 'player');
    if (p.control !== 'free') return;
    const t = ctx.world.require(this.playerEntity, 'transform');
    this.report(ctx, { kind: 'position', x: t.x, z: t.z, heightAboveTerrain: t.y - this.terrain.height(t.x, t.z) });
  }

  formatHint(step: TutorialStep): string {
    return step.hint.replace(/\{(\w+)\}/g, (_, action: string) => (action === 'move' ? this.moveLabel() : this.keyLabel(action)));
  }

  private report(ctx: GameContext, fact: TutorialFact): void {
    const done = this.tracker.report(fact);
    for (const step of done) ctx.bus.emit('tutorial:step_completed', { id: step.id, title: step.title, order: step.order });
    if (done.length > 0) this.publishHint(ctx);
  }

  private publishHint(ctx: GameContext): void {
    const step = this.tracker.current();
    ctx.bus.emit('tutorial:hint', step ? { title: step.title, text: this.formatHint(step) } : { title: null, text: this.tracker.freeRoamHint });
  }

  private moveLabel(): string {
    return ['move_forward', 'move_left', 'move_back', 'move_right'].map((a) => this.keyLabel(a)).join('');
  }
}
