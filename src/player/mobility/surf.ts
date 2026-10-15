import type { MobilityConfig } from '../../data/schemas';

type SurfConfig = MobilityConfig['surf'];

export interface SurfBody {
  vx: number;
  vz: number;
}

/**
 * Surf con escudo (lógica pura): la pendiente acelera, el material frena (nieve y arena
 * casi nada, roca mucho) y la dirección gira la velocidad. Devuelve la rapidez resultante.
 */
export function stepSurf(
  s: SurfBody,
  steer: number,
  normal: { x: number; y: number; z: number },
  friction: number,
  speedMul: number,
  cfg: SurfConfig,
  gravity: number,
  dt: number,
): number {
  s.vx += normal.x * gravity * cfg.gravityScale * dt;
  s.vz += normal.z * gravity * cfg.gravityScale * dt;
  let speed = Math.hypot(s.vx, s.vz);
  if (speed > 1e-4) {
    const decel = friction * gravity * Math.max(0.2, normal.y) * dt;
    const ns = Math.max(0, speed - decel);
    // Girar: rota el vector velocidad (más fácil cuanto más despacio).
    const turn = steer * cfg.steer * dt;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const vx = (s.vx * c - s.vz * sn) * (ns / speed);
    const vz = (s.vx * sn + s.vz * c) * (ns / speed);
    s.vx = vx;
    s.vz = vz;
    speed = ns;
  }
  const max = cfg.maxSpeed * speedMul;
  if (speed > max) {
    s.vx *= max / speed;
    s.vz *= max / speed;
    speed = max;
  }
  return speed;
}

export function surfFriction(cfg: SurfConfig, material: string): number {
  return cfg.friction[material] ?? cfg.defaultFriction;
}
