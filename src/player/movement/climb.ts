import type { ClimbConfig, PlayerConfig, StaminaConfig } from '../../data/schemas';
import type { CharacterState } from '../CharacterController';
import { castRay, materialDef, surfaceBelow, type SurfaceHit, type WorldQuery } from './probe';
import { spend, spendRate } from './Stamina';

export interface ClimbInput {
  /** Ejes locales a la pared: derecha (+1) / izquierda, arriba (+1) / abajo. */
  right: number;
  up: number;
  jumpPressed: boolean;
  dropPressed: boolean;
}

export type ClimbOutcome = 'climbing' | 'fell' | 'stood' | 'topout' | 'backflip';

export interface ClimbStepResult {
  outcome: ClimbOutcome;
  jumped: boolean;
  /** Para 'topout': altura de la cara superior y punto de pie. */
  top?: { topY: number; standX: number; standZ: number };
}

/** ¿Hay una pared escalable delante (a la altura `dy` sobre los pies)? */
export function probeClimbable(
  s: Pick<CharacterState, 'x' | 'y' | 'z'>,
  dirX: number,
  dirZ: number,
  dy: number,
  reach: number,
  cfg: ClimbConfig,
  q: WorldQuery,
): SurfaceHit | null {
  const l = Math.hypot(dirX, dirZ);
  if (l < 1e-4) return null;
  const hit = castRay(q, s.x, s.y + dy, s.z, dirX / l, 0, dirZ / l, reach);
  if (!hit || hit.ny > cfg.maxSurfaceNy || hit.ny < -0.3) return null;
  return materialDef(q, hit.material).climbable ? hit : null;
}

/** Engancha al personaje a la pared. */
export function beginClimb(s: CharacterState, hit: SurfaceHit, body: PlayerConfig['body']): void {
  const hl = Math.hypot(hit.nx, hit.nz) || 1;
  const nx = hit.nx / hl;
  const nz = hit.nz / hl;
  s.mode = 'climb';
  s.climb.nx = nx;
  s.climb.ny = hit.ny;
  s.climb.nz = nz;
  s.climb.material = hit.material;
  s.climb.jumpTimer = 0;
  s.x = hit.x + nx * (body.radius + 0.03);
  s.z = hit.z + nz * (body.radius + 0.03);
  s.vx = s.vy = s.vz = 0;
  s.grounded = false;
  s.sprinting = false;
  s.yaw = Math.atan2(-nx, -nz);
}

/**
 * Un paso de escalada libre: movimiento en el plano de la pared (diagonales incluidas),
 * salto entre agarres, coronar el borde, soltarse, voltereta hacia atrás y caída al agotarse.
 */
export function stepClimb(
  s: CharacterState,
  input: ClimbInput,
  cfg: ClimbConfig,
  staminaCfg: StaminaConfig,
  body: PlayerConfig['body'],
  q: WorldQuery,
  dt: number,
): ClimbStepResult {
  const c = s.climb;
  const res: ClimbStepResult = { outcome: 'climbing', jumped: false };
  // La lluvia vuelve resbaladiza cualquier pared (+50 % de gasto y se resbala hacia abajo).
  const wet = q.wetness?.() ?? 0;
  const grip = q.iceGrip?.() ?? false;
  const slippery = (materialDef(q, c.material).slippery && !grip) || wet > 0.35;

  const fall = (vx: number, vz: number, vy: number, outcome: ClimbOutcome): ClimbStepResult => {
    s.mode = 'air';
    s.vx = vx;
    s.vz = vz;
    s.vy = vy;
    s.fallStartY = s.y;
    res.outcome = outcome;
    return res;
  };

  if (input.dropPressed) return fall(c.nx * 1.2, c.nz * 1.2, 0, 'fell');
  if (s.stamina.exhausted) return fall(c.nx * 0.8, c.nz * 0.8, 0, 'fell');

  if (input.jumpPressed && c.jumpTimer <= 0) {
    if (input.up < -0.5) {
      // Voltereta hacia atrás: despegarse de la pared.
      s.yaw = Math.atan2(c.nx, c.nz);
      return fall(c.nx * cfg.backflipSpeed, c.nz * cfg.backflipSpeed, 5.5, 'backflip');
    }
    if (spend(s.stamina, staminaCfg.costs.climbJump, 'climb', staminaCfg)) {
      let jx = input.right;
      let jy = Math.max(input.up, 0);
      if (Math.hypot(jx, jy) < 0.2) jy = 1;
      const l = Math.hypot(jx, jy);
      c.jumpX = jx / l;
      c.jumpY = jy / l;
      c.jumpTimer = cfg.jumpSeconds;
      res.jumped = true;
    }
  }

  // Desplazamiento en la base de la pared: derecha r = (n.z, 0, -n.x) mirando a la pared, arriba = Y.
  let mx: number;
  let my: number;
  if (c.jumpTimer > 0) {
    c.jumpTimer -= dt;
    const v = cfg.jumpDistance / cfg.jumpSeconds;
    mx = c.jumpX * v * dt;
    my = c.jumpY * v * dt;
  } else {
    const il = Math.hypot(input.right, input.up);
    const scale = il > 1 ? 1 / il : 1;
    mx = input.right * scale * cfg.speed * dt;
    my = input.up * scale * cfg.speed * dt;
    if (il > 0.1) {
      const rate = staminaCfg.costs.climb * (slippery ? staminaCfg.costs.climbSlipperyMultiplier : 1);
      if (!spendRate(s.stamina, rate, dt, 'climb', staminaCfg)) return fall(c.nx * 0.8, c.nz * 0.8, 0, 'fell');
    }
  }
  if (slippery) my -= cfg.slipperySlideSpeed * (materialDef(q, c.material).slippery && !grip ? 1 : 0.6 * wet) * dt;

  const rx = c.nz;
  const rz = -c.nx;
  const nx = s.x + rx * mx;
  const ny = s.y + my;
  const nz = s.z + rz * mx;

  // ¿Llegó al suelo bajando?
  if (my < 0) {
    const ground = surfaceBelow(q, nx + c.nx * 0.3, nz + c.nz * 0.3, ny + 0.6, 1.2);
    if (ground && ny <= ground.y + 0.02 && ground.ny > cfg.standNy) {
      s.x = nx + c.nx * 0.05;
      s.z = nz + c.nz * 0.05;
      s.y = ground.y;
      s.mode = 'ground';
      s.grounded = true;
      s.vx = s.vy = s.vz = 0;
      res.outcome = 'stood';
      return res;
    }
  }

  // Re-sondeo de la pared a la altura del pecho desde fuera de ella.
  const out = 0.45;
  const reach = out + body.radius + cfg.probeDistance;
  const hit = castRay(q, nx + c.nx * out, ny + 1.0, nz + c.nz * out, -c.nx, 0, -c.nz, reach);

  if (!hit) {
    // Se acabó la pared a la altura del pecho: ¿hay una cara superior para coronar?
    const px = nx - c.nx * (body.radius + 0.35);
    const pz = nz - c.nz * (body.radius + 0.35);
    const top = surfaceBelow(q, px, pz, ny + 2.4, 2.4);
    if (top && top.y > ny + 0.2 && top.ny > cfg.standNy && !q.colliders.overlaps(px, top.y + 0.05, pz, body.radius * 0.9, body.height - 0.1)) {
      res.outcome = 'topout';
      res.top = { topY: top.y, standX: px, standZ: pz };
      return res;
    }
    c.jumpTimer = 0; // esquina u saliente: no se mueve
    return res;
  }
  if (hit.ny > cfg.standNy) {
    // La "pared" ya es suelo transitable: de pie.
    s.x = hit.x;
    s.z = hit.z;
    s.y = Math.max(ny, hit.y);
    s.mode = 'ground';
    s.grounded = true;
    s.vx = s.vy = s.vz = 0;
    res.outcome = 'stood';
    return res;
  }
  if (!materialDef(q, hit.material).climbable) {
    c.jumpTimer = 0;
    return res;
  }

  const hl = Math.hypot(hit.nx, hit.nz) || 1;
  c.nx = hit.nx / hl;
  c.nz = hit.nz / hl;
  c.ny = hit.ny;
  c.material = hit.material;
  s.x = hit.x + c.nx * (body.radius + 0.03);
  s.z = hit.z + c.nz * (body.radius + 0.03);
  s.y = ny;
  s.yaw = Math.atan2(-c.nx, -c.nz);
  return res;
}
