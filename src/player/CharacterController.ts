import { DEG2RAD, dampAngle, type Vec3 } from '../core/math';
import type { MovementConfig, PlayerConfig } from '../data/schemas';
import type { StaticColliders } from '../world/physics/StaticColliders';

/** Lo que el controlador necesita saber del mundo (inyectable en tests). */
export interface CharacterEnv {
  terrainHeight(x: number, z: number): number;
  terrainNormal(x: number, z: number, out?: Vec3): Vec3;
  waterLevelAt(x: number, z: number): number | null;
  colliders: StaticColliders;
}

/** Intención del jugador ya traducida a espacio mundo (relativa a la cámara). */
export interface CharacterInput {
  /** Dirección deseada en XZ, módulo ≤ 1. */
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  crouch: boolean;
  walk: boolean;
}

export type MoveMode = 'grounded' | 'airborne' | 'sliding' | 'floating';

export interface CharacterState {
  /** Posición de los PIES. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  sliding: boolean;
  floating: boolean;
  onCollider: boolean;
  /** Profundidad del agua sobre los pies (0 = seco). */
  waterDepth: number;
  coyoteTimer: number;
  jumpBufferTimer: number;
  jumpRising: boolean;
  airTime: number;
  /** Altura máxima de la caída actual (para daño de caída en Fase 2). */
  fallStartY: number;
}

export interface CharacterEvents {
  jumped: boolean;
  /** Velocidad vertical al aterrizar (m/s, positiva), 0 si no hubo aterrizaje. */
  landedSpeed: number;
  /** Metros caídos en el aterrizaje (desde el punto más alto). */
  landedDrop: number;
}

export function createCharacterState(x: number, y: number, z: number, yaw = 0): CharacterState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    grounded: true,
    sliding: false,
    floating: false,
    onCollider: false,
    waterDepth: 0,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    jumpRising: false,
    airTime: 0,
    fallStartY: y,
  };
}

export function moveMode(s: CharacterState): MoveMode {
  if (s.floating) return 'floating';
  if (!s.grounded) return 'airborne';
  return s.sliding ? 'sliding' : 'grounded';
}

export function jumpVelocity(cfg: MovementConfig): number {
  return Math.sqrt(2 * cfg.gravity * cfg.jumpHeight);
}

const MAX_SUBSTEP = 0.25;
const tmpN: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * Personaje cinemático: integra un paso fijo de movimiento. Función pura sobre el estado
 * (sin Three.js), así el "feel" (coyote time, buffer, pendientes) se cubre con tests.
 */
export function stepCharacter(
  s: CharacterState,
  input: CharacterInput,
  cfg: MovementConfig,
  body: PlayerConfig['body'],
  env: CharacterEnv,
  dt: number,
): CharacterEvents {
  const ev: CharacterEvents = { jumped: false, landedSpeed: 0, landedDrop: 0 };
  const tanMax = Math.tan(cfg.maxSlopeDeg * DEG2RAD);

  // --- temporizadores de salto
  s.jumpBufferTimer = input.jumpPressed ? cfg.jumpBuffer : Math.max(0, s.jumpBufferTimer - dt);
  s.coyoteTimer = s.grounded && !s.sliding ? cfg.coyoteTime : Math.max(0, s.coyoteTimer - dt);

  // --- agua
  const level = env.waterLevelAt(s.x, s.z);
  s.waterDepth = level === null ? 0 : Math.max(0, level - s.y);

  // --- velocidad horizontal deseada
  let speed = input.crouch ? cfg.crouchSpeed : input.walk ? cfg.walkSpeed : cfg.jogSpeed;
  if (s.waterDepth > cfg.wadeDepth) speed *= cfg.waterSpeedMultiplier;
  const tx = input.moveX * speed;
  const tz = input.moveZ * speed;
  const hasInput = input.moveX * input.moveX + input.moveZ * input.moveZ > 1e-4;

  if ((s.grounded && !s.sliding) || s.floating) {
    accelerateTowards(s, tx, tz, (hasInput ? cfg.groundAccel : cfg.groundDecel) * dt);
  } else if (s.sliding) {
    const n = env.terrainNormal(s.x, s.z, tmpN);
    s.vx += n.x * cfg.slideAccel * dt;
    s.vz += n.z * cfg.slideAccel * dt;
    // Se puede corregir de lado, pero no remontar la pendiente.
    const hl = Math.hypot(n.x, n.z) || 1;
    const dx = n.x / hl;
    const dz = n.z / hl;
    const along = tx * dx + tz * dz;
    const sx = along < 0 ? tx - along * dx : tx;
    const sz = along < 0 ? tz - along * dz : tz;
    s.vx += sx * cfg.airAccel * 0.05 * dt;
    s.vz += sz * cfg.airAccel * 0.05 * dt;
  } else if (hasInput) {
    accelerateTowards(s, tx, tz, cfg.airAccel * dt);
  }

  // --- salto (buffer + coyote time)
  const canJump = (s.grounded && !s.sliding) || s.coyoteTimer > 0 || s.floating;
  if (s.jumpBufferTimer > 0 && canJump) {
    s.vy = jumpVelocity(cfg) * (s.floating ? 0.55 : 1);
    s.grounded = false;
    s.floating = false;
    s.coyoteTimer = 0;
    s.jumpBufferTimer = 0;
    s.jumpRising = true;
    s.fallStartY = s.y;
    ev.jumped = true;
  }
  // Salto variable: soltar pronto corta la subida.
  if (s.jumpRising && !input.jumpHeld && s.vy > 0) {
    s.vy *= cfg.jumpCutMultiplier;
    s.jumpRising = false;
  }
  if (s.vy <= 0) s.jumpRising = false;

  // --- gravedad
  if (!s.grounded) s.vy = Math.max(s.vy - cfg.gravity * dt, -cfg.maxFallSpeed);

  // --- movimiento horizontal en subpasos (evita atravesar colisionadores a alta velocidad)
  const dist = Math.hypot(s.vx, s.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const px = s.x;
    const pz = s.z;
    s.x += s.vx * sdt;
    s.z += s.vz * sdt;

    // Terreno demasiado empinado: actúa como pared (los muros del valle no se suben andando).
    const hNew = env.terrainHeight(s.x, s.z);
    if (hNew > s.y + cfg.stepHeight * 0.5) {
      const rise = hNew - env.terrainHeight(px, pz);
      const run = Math.hypot(s.x - px, s.z - pz);
      if (rise > run * tanMax + 0.01 || hNew > s.y + cfg.stepHeight) {
        s.x = px;
        s.z = pz;
        const n = env.terrainNormal(s.x + (s.vx * sdt) * 2, s.z + (s.vz * sdt) * 2, tmpN);
        clipVelocity(s, n.x, n.z);
      }
    }

    const push = env.colliders.pushOut(s, body.radius, body.height, cfg.stepHeight);
    if (push.hit) clipVelocity(s, push.nx, push.nz);
  }

  // --- vertical y suelo
  const prevY = s.y;
  s.y += s.vy * dt;
  const terrainH = env.terrainHeight(s.x, s.z);
  const colTop = env.colliders.topAt(s.x, s.z, body.radius * 0.6, Math.max(prevY, s.y) + cfg.stepHeight);
  const groundH = Math.max(terrainH, colTop);
  s.onCollider = colTop > terrainH;

  if (s.grounded) {
    if (s.y - groundH <= cfg.groundSnap && groundH - s.y <= cfg.stepHeight + 0.01) {
      s.y = groundH; // pegado al suelo al bajar pendientes y subir escalones
      s.vy = 0;
    } else if (groundH > s.y) {
      s.y = groundH;
      s.vy = 0;
    } else {
      s.grounded = false; // se acabó el suelo (borde)
      s.fallStartY = s.y;
    }
  } else if (s.y <= groundH) {
    ev.landedSpeed = Math.max(0, -s.vy);
    ev.landedDrop = Math.max(0, s.fallStartY - groundH);
    s.y = groundH;
    s.vy = 0;
    s.grounded = true;
    s.jumpRising = false;
  }

  if (!s.grounded) {
    s.airTime += dt;
    s.fallStartY = Math.max(s.fallStartY, s.y);
  } else {
    s.airTime = 0;
    s.fallStartY = s.y;
  }

  // --- pendiente: deslizarse si es demasiado inclinada (solo sobre terreno)
  if (s.grounded && !s.onCollider) {
    const n = env.terrainNormal(s.x, s.z, tmpN);
    s.sliding = n.y < Math.cos(cfg.maxSlopeDeg * DEG2RAD);
  } else {
    s.sliding = false;
  }

  // --- flotar en agua profunda (la natación completa llega en la Fase 2)
  const lvl = env.waterLevelAt(s.x, s.z);
  s.floating = false;
  if (lvl !== null && lvl - groundH > cfg.floatDepth && s.y < lvl - cfg.floatDepth) {
    s.y = lvl - cfg.floatDepth;
    if (s.vy < 0) {
      if (!s.grounded && s.airTime > 0) ev.landedSpeed = Math.max(ev.landedSpeed, -s.vy);
      s.vy = 0;
    }
    s.floating = true;
    s.grounded = false;
    s.sliding = false;
    s.airTime = 0;
    s.fallStartY = s.y;
  }
  s.waterDepth = lvl === null ? 0 : Math.max(0, lvl - s.y);

  // --- orientación hacia la dirección de entrada
  if (hasInput && !s.sliding) s.yaw = dampAngle(s.yaw, Math.atan2(input.moveX, input.moveZ), cfg.turnSharpness, dt);

  return ev;
}

function accelerateTowards(s: CharacterState, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - s.vx;
  const dz = tz - s.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-9) {
    s.vx = tx;
    s.vz = tz;
  } else {
    s.vx += (dx / d) * maxDelta;
    s.vz += (dz / d) * maxDelta;
  }
}

/** Elimina la componente de la velocidad que entra en la superficie (normal horizontal). */
function clipVelocity(s: CharacterState, nx: number, nz: number): void {
  const l = Math.hypot(nx, nz);
  if (l < 1e-6) {
    s.vx = 0;
    s.vz = 0;
    return;
  }
  const ux = nx / l;
  const uz = nz / l;
  const dot = s.vx * ux + s.vz * uz;
  if (dot < 0) {
    s.vx -= dot * ux;
    s.vz -= dot * uz;
  }
}
