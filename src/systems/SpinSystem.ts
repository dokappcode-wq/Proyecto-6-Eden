import type { GameContext, System } from '../core/Game';

/** Rota sobre Y las entidades con `spin` (objetos ancestrales decorativos). */
export class SpinSystem implements System {
  readonly name = 'spin';

  fixedUpdate({ world }: GameContext, dt: number): void {
    for (const e of world.query('transform', 'spin')) {
      const t = world.require(e, 'transform');
      t.rotY += world.require(e, 'spin').speed * dt;
    }
  }
}
