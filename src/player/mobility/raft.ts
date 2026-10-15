import type { MobilityConfig } from '../../data/schemas';

type RaftConfig = MobilityConfig['rafts'];

export interface RaftState {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  /** Vela izada: el viento empuja. */
  sail: boolean;
}

export interface RaftInput {
  turn: number;
  paddle: number;
}

/**
 * Balsa de vela (lógica pura): la vela convierte el viento de popa en avance, la quilla
 * frena la deriva lateral y remar empuja un poco. No puede salir del agua.
 * Devuelve true si ha encallado.
 */
export function stepRaft(r: RaftState, input: RaftInput, windX: number, windZ: number, cfg: RaftConfig, depthAt: (x: number, z: number) => number, dt: number): boolean {
  const fx = Math.sin(r.yaw);
  const fz = Math.cos(r.yaw);
  const along = windX * fx + windZ * fz;
  const push = (r.sail ? cfg.sail * Math.max(0, along) : 0) + input.paddle * cfg.paddle;
  r.vx += (fx * push + windX * cfg.leeway) * dt;
  r.vz += (fz * push + windZ * cfg.leeway) * dt;
  // Avance y deriva por separado (la quilla se resiste a ir de lado).
  let vf = r.vx * fx + r.vz * fz;
  let vl = r.vx * fz - r.vz * fx;
  vf *= Math.exp(-cfg.drag * dt);
  vl *= Math.exp(-cfg.keel * dt);
  r.vx = fx * vf + fz * vl;
  r.vz = fz * vf - fx * vl;
  r.yaw -= input.turn * cfg.turnRate * dt * (0.45 + Math.min(1, Math.abs(vf) / 3));

  const nx = r.x + r.vx * dt;
  const nz = r.z + r.vz * dt;
  if (depthAt(nx, nz) < cfg.minDepth) {
    r.vx *= -0.2;
    r.vz *= -0.2;
    return true;
  }
  r.x = nx;
  r.z = nz;
  return false;
}
