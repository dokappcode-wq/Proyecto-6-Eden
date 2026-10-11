import { DEG2RAD, lerp } from '../../core/math';
import type { LedgeBoostConfig, PlayerConfig } from '../../data/schemas';
import type { CharacterState } from '../CharacterController';
import { castRay, materialDef, surfaceBelow, type WorldQuery } from './probe';

export interface LedgeCandidate {
  /** Altura de la cara superior del borde. */
  topY: number;
  /** Punto de pie sobre el borde. */
  standX: number;
  standZ: number;
  /** Normal horizontal de la pared (hacia fuera). */
  nx: number;
  nz: number;
  /** Punto de impacto en la pared. */
  hitX: number;
  hitZ: number;
  material: string;
}

/**
 * Detección del Impulso de Borde con 3 rayos:
 * (a) frontal a la altura del pecho → pared; (c) vertical desde encima del borde → cara superior;
 * (b) hacia arriba desde la cara superior → espacio libre para la cápsula.
 * Comprueba alcance de manos, pendiente superior, ángulo de aproximación, velocidad vertical y material.
 */
export function detectLedge(
  s: Pick<CharacterState, 'x' | 'y' | 'z' | 'vy' | 'time' | 'lastLedgeEnd'>,
  dirX: number,
  dirZ: number,
  cfg: LedgeBoostConfig,
  body: PlayerConfig['body'],
  q: WorldQuery,
): LedgeCandidate | null {
  if (s.vy > cfg.maxUpwardSpeed || s.vy < -cfg.maxDownwardSpeed) return null;
  const sinceLast = s.time - s.lastLedgeEnd;
  if (sinceLast < cfg.chainMinSeconds) return null;
  const dl = Math.hypot(dirX, dirZ);
  if (dl < 1e-4) return null;
  const fx = dirX / dl;
  const fz = dirZ / dl;

  // (a) pared al frente: a la altura del pecho y, si no, más arriba (repisas finas o salientes).
  const reach = body.radius + cfg.probeDistance;
  let wall = castRay(q, s.x, s.y + cfg.chestHeight, s.z, fx, 0, fz, reach);
  if (!wall) wall = castRay(q, s.x, s.y + cfg.reachMax - 0.15, s.z, fx, 0, fz, reach);
  if (!wall || Math.abs(wall.ny) > 0.6) return null;
  const hl = Math.hypot(wall.nx, wall.nz);
  if (hl < 1e-4) return null;
  const nx = wall.nx / hl;
  const nz = wall.nz / hl;
  if (-(fx * nx + fz * nz) < Math.cos(cfg.maxApproachAngleDeg * DEG2RAD)) return null;
  if (!cfg.grabbableMaterials.includes(wall.material) || !materialDef(q, wall.material).grabbable) return null;

  // (c) cara superior: rayo hacia abajo desde encima del alcance máximo, un poco hacia dentro.
  const px = wall.x - nx * cfg.inwardOffset;
  const pz = wall.z - nz * cfg.inwardOffset;
  const fromY = s.y + cfg.reachMax + 0.3;
  const top = surfaceBelow(q, px, pz, fromY, cfg.reachMax + 0.3 - cfg.reachMin + 0.2);
  if (!top) return null;
  const rel = top.y - s.y;
  const maxRel = sinceLast < 0.6 ? Math.min(cfg.reachMax, cfg.chainMaxHeight) : cfg.reachMax;
  if (rel < cfg.reachMin || rel > maxRel) return null;
  if (top.ny < Math.cos(cfg.maxTopSlopeDeg * DEG2RAD)) return null;

  // (b) espacio libre encima del borde para la cápsula del personaje.
  const standX = wall.x - nx * (body.radius + 0.12);
  const standZ = wall.z - nz * (body.radius + 0.12);
  if (castRay(q, px, top.y + 0.05, pz, 0, 1, 0, body.height)) return null;
  if (q.colliders.overlaps(standX, top.y + 0.05, standZ, body.radius * 0.9, body.height - 0.1)) return null;
  if (q.terrainHeight(standX, standZ) > top.y + 0.35) return null;

  return { topY: top.y, standX, standZ, nx, nz, hitX: wall.x, hitZ: wall.z, material: wall.material };
}

/** Prepara el estado de Impulso de Borde. `paid` = se pagó la stamina (si no, mantle lento). */
export function beginLedge(s: CharacterState, c: LedgeCandidate, paid: boolean, fromClimb: boolean, body: PlayerConfig['body']): void {
  const L = s.ledge;
  const horiz = Math.hypot(s.vx, s.vz);
  L.phase = 'contact';
  L.t = 0;
  L.fromClimb = fromClimb;
  L.sx = s.x;
  L.sy = s.y;
  L.sz = s.z;
  // Contacto: manos en el borde (pies ~1.45 m por debajo), pegado a la pared.
  L.cx = c.hitX + c.nx * (body.radius + 0.02);
  L.cz = c.hitZ + c.nz * (body.radius + 0.02);
  L.cy = Math.max(s.y - 0.3, c.topY - 1.45);
  L.tx = c.standX;
  L.ty = c.topY;
  L.tz = c.standZ;
  L.nx = c.nx;
  L.nz = c.nz;
  L.exitSpeed = horiz;
  L.exitX = -c.nx;
  L.exitZ = -c.nz;
  L.paid = paid;
  if (fromClimb) {
    // Ya está agarrado a la pared: sin fase de contacto, sale desde donde está.
    L.cx = s.x;
    L.cy = s.y;
    L.cz = s.z;
    L.phase = paid ? 'boost' : 'mantle';
  }
  s.mode = 'ledge';
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.grounded = false;
  s.yaw = Math.atan2(-c.nx, -c.nz);
}

export interface LedgeStepResult {
  /** Terminó y quedó de pie sobre el borde. */
  exited: boolean;
  /** Se soltó durante el contacto. */
  released: boolean;
  /** Acaba de pasar del contacto al impulso. */
  boosted: boolean;
}

/** Avanza las fases contacto → impulso (o mantle) → salida. */
export function stepLedge(
  s: CharacterState,
  input: { release: boolean },
  cfg: LedgeBoostConfig,
  dt: number,
): LedgeStepResult {
  const L = s.ledge;
  const res: LedgeStepResult = { exited: false, released: false, boosted: false };
  L.t += dt;

  if (L.phase === 'contact') {
    const k = Math.min(1, L.t / Math.max(cfg.contactSeconds, 1e-6));
    s.x = lerp(L.sx, L.cx, k);
    s.y = lerp(L.sy, L.cy, k);
    s.z = lerp(L.sz, L.cz, k);
    if (input.release && !L.fromClimb) {
      s.mode = 'air';
      s.vx = L.nx * 1.5;
      s.vz = L.nz * 1.5;
      s.vy = 0;
      s.fallStartY = s.y;
      res.released = true;
      return res;
    }
    if (L.t >= cfg.contactSeconds) {
      L.phase = L.paid ? 'boost' : 'mantle';
      L.t = 0;
      res.boosted = true;
    }
    return res;
  }

  const duration = L.phase === 'boost' ? cfg.boostSeconds : cfg.mantleSeconds;
  const k = Math.min(1, L.t / duration);
  // Impulso: ease-out rápido (sale disparado y frena arriba); mantle: suave.
  const e = L.phase === 'boost' ? 1 - Math.pow(1 - k, 3) : k * k * (3 - 2 * k);
  const fromX = L.cx;
  const fromY = L.cy;
  const fromZ = L.cz;
  // Primero sube y luego entra: el XZ avanza algo retrasado respecto a Y.
  const ey = Math.min(1, e * 1.25);
  const exz = Math.max(0, (e - 0.25) / 0.75);
  s.x = lerp(fromX, L.tx, exz);
  s.z = lerp(fromZ, L.tz, exz);
  s.y = lerp(fromY, L.ty, ey) + Math.sin(k * Math.PI) * (L.phase === 'boost' ? 0.18 : 0.05);
  if (k >= 1) {
    s.x = L.tx;
    s.y = L.ty;
    s.z = L.tz;
    s.mode = 'ground';
    s.grounded = true;
    s.vy = 0;
    const v = L.exitSpeed * cfg.exitSpeedFraction;
    s.vx = L.exitX * v;
    s.vz = L.exitZ * v;
    s.lastLedgeEnd = s.time;
    s.fallStartY = s.y;
    s.airTime = 0;
    res.exited = true;
  }
  return res;
}

/** Duración total contacto + impulso (para validar el requisito de ≤ 0.4 s). */
export function ledgeBoostDuration(cfg: LedgeBoostConfig): number {
  return cfg.contactSeconds + cfg.boostSeconds;
}
