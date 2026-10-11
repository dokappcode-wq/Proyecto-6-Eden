import type { GameContext, System } from '../core/Game';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { GateHandle } from '../world/valley/ValleyBuilder';

const OPEN_SECONDS = 4;

/**
 * Muro natural de la salida sur. Se abre con `valley:gate_open_requested`
 * (en la Fase 8/9 lo pedirán la torre + el templo; ahora, la tecla de debug F6).
 */
export class GateSystem implements System {
  readonly name = 'gate';
  private progress = 0;
  private opening = false;
  private collidersRemoved = false;

  constructor(
    private readonly gate: GateHandle,
    private readonly colliders: StaticColliders,
    ctx: GameContext,
  ) {
    ctx.bus.on('valley:gate_open_requested', () => this.open());
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action === 'debug_open_gate' && phase === 'pressed' && ctx.session.mode === 'play') {
        ctx.bus.emit('valley:gate_open_requested', { reason: 'debug' });
      }
    });
  }

  get isOpen(): boolean {
    return this.progress >= 1;
  }

  /** Estado instantáneo al cargar partida. */
  setOpenImmediate(open: boolean): void {
    this.opening = false;
    this.progress = open ? 1 : 0;
    this.gate.prop.setOpen(this.progress);
    if (open) this.removeColliders();
    else if (this.collidersRemoved) {
      for (const c of this.gate.colliders) this.colliders.add(c);
      this.collidersRemoved = false;
    }
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (!this.opening) return;
    this.progress = Math.min(1, this.progress + dt / OPEN_SECONDS);
    this.gate.prop.setOpen(this.progress);
    if (this.progress > 0.6) this.removeColliders();
    if (this.progress >= 1) {
      this.opening = false;
      ctx.bus.emit('valley:gate_opened', {});
    }
  }

  private open(): void {
    if (this.opening || this.progress >= 1) return;
    this.opening = true;
  }

  private removeColliders(): void {
    if (this.collidersRemoved) return;
    for (const c of this.gate.colliders) this.colliders.remove(c);
    this.collidersRemoved = true;
  }
}
