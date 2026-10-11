import type { GameContext, System } from '../core/Game';

/**
 * Guarda el estado previo de cada Transform al inicio del paso fijo.
 * Debe registrarse PRIMERO para que el render pueda interpolar prev -> actual.
 */
export class TransformSnapshotSystem implements System {
  readonly name = 'transform-snapshot';

  fixedUpdate({ world }: GameContext): void {
    for (const e of world.query('transform')) {
      const t = world.require(e, 'transform');
      t.prevX = t.x;
      t.prevY = t.y;
      t.prevZ = t.z;
      t.prevRotY = t.rotY;
    }
  }
}
