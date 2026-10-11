import type { Vec3 } from '../src/core/math';
import type { CharacterEnv, CharacterInput } from '../src/player/CharacterController';
import { StaticColliders } from '../src/world/physics/StaticColliders';

/** Mundo de prueba: suelo plano a y=0 con una "pared" de terreno empinado opcional. */
export function flatEnv(opts: { wallX?: number; water?: { level: number; minX: number } } = {}): CharacterEnv {
  const height = (x: number) => (opts.wallX !== undefined && x > opts.wallX ? (x - opts.wallX) * 3 : 0);
  return {
    terrainHeight: (x) => height(x),
    terrainNormal: (x, _z, out: Vec3 = { x: 0, y: 1, z: 0 }) => {
      const d = (height(x + 0.05) - height(x - 0.05)) / 0.1;
      const inv = 1 / Math.sqrt(d * d + 1);
      out.x = -d * inv;
      out.y = inv;
      out.z = 0;
      return out;
    },
    waterLevelAt: (x) => (opts.water && x > opts.water.minX ? opts.water.level : null),
    colliders: new StaticColliders(),
  };
}

export function idle(over: Partial<CharacterInput> = {}): CharacterInput {
  return { moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false, crouch: false, walk: false, ...over };
}
