import type { Vec3 } from '../src/core/math';
import { loadGameData } from '../src/data';
import type { CharacterEnv, CharacterInput } from '../src/player/CharacterController';
import type { MovementInput, MovementParams } from '../src/player/movement/Movement';
import { gliderModifiers } from '../src/player/movement/glide';
import type { AirSample } from '../src/world/airflow/Airflow';
import { StaticColliders } from '../src/world/physics/StaticColliders';

export const DATA = loadGameData();

export interface TestWorldOpts {
  /** Pared de terreno empinada a partir de x (pendiente 3:1). */
  wallX?: number;
  wallMaterial?: string;
  water?: { level: number; minX: number };
  /** Altura del suelo plano. */
  ground?: number;
  airflow?: (x: number, y: number, z: number, out: AirSample) => AirSample;
}

/** Mundo de prueba: suelo plano con pared de terreno, agua y aire opcionales. */
export function flatEnv(opts: TestWorldOpts = {}): CharacterEnv {
  const g = opts.ground ?? 0;
  const height = (x: number) => g + (opts.wallX !== undefined && x > opts.wallX ? (x - opts.wallX) * 3 : 0);
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
    terrainMaterial: (_x, _z, ny) => (ny < 0.8 ? (opts.wallMaterial ?? 'rock') : 'grass'),
    materials: DATA.materials,
    waterLevelAt: (x) => (opts.water && x > opts.water.minX ? opts.water.level : null),
    colliders: new StaticColliders(),
    airflowAt: opts.airflow,
  };
}

export function idle(over: Partial<CharacterInput> = {}): CharacterInput {
  return { moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false, crouch: false, walk: false, ...over };
}

export function mIn(over: Partial<MovementInput> = {}): MovementInput {
  return {
    moveX: 0,
    moveZ: 0,
    right: 0,
    forward: 0,
    jumpPressed: false,
    jumpHeld: false,
    sprint: false,
    crouch: false,
    crouchPressed: false,
    walk: false,
    dodgePressed: false,
    grabPressed: false,
    ...over,
  };
}

export function params(over: Partial<MovementParams> = {}): MovementParams {
  return {
    player: DATA.player,
    ledge: DATA.ledgeBoost,
    glider: DATA.glider,
    gliderMods: gliderModifiers([]),
    ledgeRequiresHold: false,
    gliderInput: 'toggle',
    ...over,
  };
}
