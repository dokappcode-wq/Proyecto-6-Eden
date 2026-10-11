import type { GameContext, System } from '../core/Game';
import type { InteractableKind } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';

/**
 * Detecta el interactuable más cercano al jugador, muestra el aviso y emite `interact`.
 * También gestiona el panel de lectura de inscripciones (abrir/cerrar al alejarse).
 */
export class InteractionSystem implements System {
  readonly name = 'interaction';
  private focusId: string | null = null;
  private reading: { id: string; x: number; z: number; radius: number } | null = null;

  constructor(
    private readonly playerEntity: Entity,
    ctx: GameContext,
  ) {
    ctx.bus.on('capsule:exited', () => {
      for (const e of ctx.world.query('interactable')) {
        const it = ctx.world.require(e, 'interactable');
        if (it.kind === 'capsule') it.prompt = 'Guardar partida';
      }
      this.setFocus(ctx, null, '');
    });
  }

  /** ¿Hay algo interactuable delante? (si no, "Interactuar" sirve para agarrarse a una pared). */
  get hasFocus(): boolean {
    return this.focusId !== null;
  }

  /** Restablece avisos tras cargar partida. */
  syncCapsulePrompt(ctx: GameContext, exited: boolean): void {
    for (const e of ctx.world.query('interactable')) {
      const it = ctx.world.require(e, 'interactable');
      if (it.kind === 'capsule') it.prompt = exited ? 'Guardar partida' : 'Abrir cápsula';
    }
  }

  fixedUpdate(ctx: GameContext): void {
    if (ctx.session.mode !== 'play') return;
    const { world, input, bus } = ctx;
    const player = world.require(this.playerEntity, 'player');
    if (player.control === 'exiting' || player.control === 'locked') {
      this.setFocus(ctx, null, '');
      return;
    }
    const pt = world.require(this.playerEntity, 'transform');

    // Cerrar la lectura al alejarse.
    if (this.reading && Math.hypot(pt.x - this.reading.x, pt.z - this.reading.z) > this.reading.radius + 1.5) this.closeReading(ctx);

    let best: { id: string; prompt: string; kind: InteractableKind; title?: string; text?: string; x: number; z: number; radius: number } | null = null;
    let bestD = Infinity;
    for (const e of world.query('interactable', 'transform')) {
      const it = world.require(e, 'interactable');
      if (!it.enabled) continue;
      const t = world.require(e, 'transform');
      const d = Math.hypot(t.x - pt.x, t.z - pt.z);
      if (d > it.radius || Math.abs(t.y - pt.y) > 3.5 || d >= bestD) continue;
      bestD = d;
      best = { id: it.id, prompt: it.prompt, kind: it.kind, title: it.title, text: it.text, x: t.x, z: t.z, radius: it.radius };
    }

    const prompt = best && this.reading?.id === best.id ? 'Cerrar' : (best?.prompt ?? '');
    this.setFocus(ctx, best?.id ?? null, prompt);

    if (!best || !input.wasPressed('interact')) return;
    if (best.kind === 'inscription') {
      if (this.reading?.id === best.id) {
        this.closeReading(ctx);
      } else {
        this.reading = { id: best.id, x: best.x, z: best.z, radius: best.radius };
        bus.emit('inscription:open', { id: best.id, title: best.title ?? '', text: best.text ?? '' });
      }
    }
    bus.emit('interact', { id: best.id, kind: best.kind });
  }

  private closeReading(ctx: GameContext): void {
    this.reading = null;
    ctx.bus.emit('inscription:close', {});
  }

  private lastPrompt = '';
  private setFocus(ctx: GameContext, id: string | null, prompt: string): void {
    if (id === this.focusId && prompt === this.lastPrompt) return;
    this.focusId = id;
    this.lastPrompt = prompt;
    ctx.bus.emit('interaction:focus', id ? { id, prompt } : null);
  }
}
