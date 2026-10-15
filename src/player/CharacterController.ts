import { DEG2RAD, dampAngle, type Vec3 } from '../core/math';
import type { MovementConfig, PlayerConfig } from '../data/schemas';
import type { AirSample } from '../world/airflow/Airflow';
import { createStamina, type StaminaState } from './movement/Stamina';
import type { WorldQuery } from './movement/probe';

/** Lo que el controlador necesita saber del mundo (inyectable en tests). */
export interface CharacterEnv extends WorldQuery {
  waterLevelAt(x: number, z: number): number | null;
  /** Corriente del agua (m/s) en XZ; opcional. */
  waterCurrentAt?(x: number, z: number, out: { x: number; z: number }): { x: number; z: number };
  /** Viento y corrientes térmicas; opcional. */
  airflowAt?(x: number, y: number, z: number, out: AirSample): AirSample;
}

/** Intención del jugador para la física de suelo/aire/agua (ya en espacio mundo). */
export interface CharacterInput {
  /** Dirección deseada en XZ, módulo ≤ 1. */
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  crouch: boolean;
  walk: boolean;
  /** Sprint ya autorizado por la stamina. */
  sprint?: boolean;
  /** Bucear (agacharse en el agua). */
  dive?: boolean;
  /** Velocidad horizontal impuesta (esquiva, embestidas de ataque): ignora la aceleración normal. */
  forcedVelocity?: { x: number; z: number };
  /** Orientación impuesta (apuntar, fijar objetivo, atacar). */
  faceYaw?: number;
}

export type MoveMode = 'ground' | 'air' | 'swim' | 'climb' | 'ledge' | 'glide';

export interface ClimbState {
  nx: number;
  ny: number;
  nz: number;
  material: string;
  jumpTimer: number;
  jumpX: number;
  jumpY: number;
}

export interface LedgeState {
  phase: 'contact' | 'boost' | 'mantle';
  t: number;
  /** Posición al iniciar, al agarrarse (contacto) y destino de pie sobre el borde. */
  sx: number;
  sy: number;
  sz: number;
  cx: number;
  cy: number;
  cz: number;
  tx: number;
  ty: number;
  tz: number;
  nx: number;
  nz: number;
  exitSpeed: number;
  exitX: number;
  exitZ: number;
  /** Viene de escalar (coronar la pared): sin coste ni opción de soltarse. */
  fromClimb: boolean;
  /** Se pagó la stamina: impulso rápido; si no, mantle lento. */
  paid: boolean;
}

export interface GlideState {
  heading: number;
  speed: number;
  deployT: number;
  bank: number;
  dive: number;
  flare: number;
  inThermal: boolean;
  windX: number;
  windZ: number;
  /** Segundos desde el último despliegue (planeo gratis del set ancestral). */
  airtime: number;
}

export interface CharacterState {
  /** Posición de los PIES. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  mode: MoveMode;
  grounded: boolean;
  sliding: boolean;
  onCollider: boolean;
  /** En agua profunda (nadando). */
  swimming: boolean;
  /** Cabeza bajo el agua. */
  underwater: boolean;
  /** Profundidad del agua sobre los pies (0 = seco). */
  waterDepth: number;
  sprinting: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  jumpRising: boolean;
  airTime: number;
  /** Punto más alto de la caída actual (daño de caída). */
  fallStartY: number;
  stamina: StaminaState;
  /** Aire restante buceando (s). */
  air: number;
  /** Tiempo hundiéndose agotado (s). */
  sinkTimer: number;
  climb: ClimbState;
  ledge: LedgeState;
  glide: GlideState;
  hasGlider: boolean;
  /** Reloj interno del controlador (s). */
  time: number;
  lastLedgeEnd: number;
  /** Tiempo desde la última petición de rodar (esquiva/agacharse en el aire). */
  rollTimer: number;
  /** Tiempo empujando contra una pared desde el suelo (para empezar a trepar). */
  pushTimer: number;
  /** Tiempo desde el inicio de la última esquiva (s). */
  dodgeT: number;
  dodgeX: number;
  dodgeZ: number;
  /** Última posición segura en tierra firme (reaparecer tras ahogarse). */
  safeX: number;
  safeY: number;
  safeZ: number;
}

export interface CharacterEvents {
  jumped: boolean;
  /** Velocidad vertical al aterrizar (m/s, positiva), 0 si no hubo aterrizaje. */
  landedSpeed: number;
  /** Metros caídos en el aterrizaje (desde el punto más alto). */
  landedDrop: number;
  /** El aterrizaje fue en agua profunda (sin daño). */
  landedInWater: boolean;
}

export function createCharacterState(x: number, y: number, z: number, yaw = 0, maxStamina = 100, airSeconds = 15): CharacterState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    mode: 'ground',
    grounded: true,
    sliding: false,
    onCollider: false,
    swimming: false,
    underwater: false,
    waterDepth: 0,
    sprinting: false,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    jumpRising: false,
    airTime: 0,
    fallStartY: y,
    stamina: createStamina(maxStamina),
    air: airSeconds,
    sinkTimer: 0,
    climb: { nx: 0, ny: 0, nz: 1, material: '', jumpTimer: 0, jumpX: 0, jumpY: 0 },
    ledge: { phase: 'contact', t: 0, sx: x, sy: y, sz: z, cx: x, cy: y, cz: z, tx: x, ty: y, tz: z, nx: 0, nz: 1, exitSpeed: 0, exitX: 0, exitZ: 0, fromClimb: false, paid: true },
    glide: { heading: yaw, speed: 0, deployT: 0, bank: 0, dive: 0, flare: 0, inThermal: false, windX: 0, windZ: 0, airtime: 0 },
    hasGlider: false,
    time: 0,
    lastLedgeEnd: -999,
    rollTimer: 999,
    pushTimer: 0,
    dodgeT: 999,
    dodgeX: 0,
    dodgeZ: 0,
    safeX: x,
    safeY: y,
    safeZ: z,
  };
}

export function jumpVelocity(cfg: MovementConfig): number {
  return Math.sqrt(2 * cfg.gravity * cfg.jumpHeight);
}

const MAX_SUBSTEP = 0.25;
const tmpN: Vec3 = { x: 0, y: 1, z: 0 };
const tmpCurrent = { x: 0, z: 0 };

/**
 * Física de suelo, aire y agua (un paso fijo). Función pura sobre el estado.
 * La escalada, el Impulso de Borde y el planeador viven en sus módulos; el
 * orquestador (`stepMovement`) decide qué modo corre.
 */
export function stepCharacter(
  s: CharacterState,
  input: CharacterInput,
  cfg: MovementConfig,
  body: PlayerConfig['body'],
  env: CharacterEnv,
  dt: number,
): CharacterEvents {
  const ev: CharacterEvents = { jumped: false, landedSpeed: 0, landedDrop: 0, landedInWater: false };
  const tanMax = Math.tan(cfg.maxSlopeDeg * DEG2RAD);
  const exhausted = s.stamina.exhausted;

  // --- temporizadores de salto
  s.jumpBufferTimer = input.jumpPressed ? cfg.jumpBuffer : Math.max(0, s.jumpBufferTimer - dt);
  s.coyoteTimer = s.grounded && !s.sliding ? cfg.coyoteTime : Math.max(0, s.coyoteTimer - dt);

  // --- agua
  const level0 = env.waterLevelAt(s.x, s.z);
  s.waterDepth = level0 === null ? 0 : Math.max(0, level0 - s.y);

  // --- velocidad horizontal deseada
  let speed = input.crouch ? cfg.crouchSpeed : input.walk ? cfg.walkSpeed : input.sprint ? cfg.sprintSpeed : cfg.jogSpeed;
  if (s.swimming) speed = exhausted ? 0 : cfg.swimSpeed;
  else if (s.waterDepth > cfg.wadeDepth) speed *= cfg.waterSpeedMultiplier;
  const tx = input.moveX * speed;
  const tz = input.moveZ * speed;
  const hasInput = input.moveX * input.moveX + input.moveZ * input.moveZ > 1e-4;

  if (input.forcedVelocity && !s.swimming) {
    s.vx = input.forcedVelocity.x;
    s.vz = input.forcedVelocity.z;
  } else if ((s.grounded && !s.sliding) || s.swimming) {
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

  // --- salto (buffer + coyote time); nadando, un pequeño impulso (no si está agotado)
  const canJump = (s.grounded && !s.sliding) || s.coyoteTimer > 0 || (s.swimming && !exhausted && !s.underwater);
  if (s.jumpBufferTimer > 0 && canJump) {
    s.vy = jumpVelocity(cfg) * (s.swimming ? 0.55 : 1);
    s.grounded = false;
    s.swimming = false;
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

  // --- gravedad (en el agua la gestiona la flotación)
  if (!s.grounded && !s.swimming) s.vy = Math.max(s.vy - cfg.gravity * dt, -cfg.maxFallSpeed);

  // --- corriente del agua
  let cx = 0;
  let cz = 0;
  if (env.waterCurrentAt && s.waterDepth > cfg.wadeDepth) {
    const c = env.waterCurrentAt(s.x, s.z, tmpCurrent);
    cx = c.x;
    cz = c.z;
  }

  // --- movimiento horizontal en subpasos (evita atravesar colisionadores a alta velocidad)
  const mvx = s.vx + cx;
  const mvz = s.vz + cz;
  const dist = Math.hypot(mvx, mvz) * dt;
  const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const px = s.x;
    const pz = s.z;
    s.x += mvx * sdt;
    s.z += mvz * sdt;

    // Terreno demasiado empinado: actúa como pared (los muros del valle no se suben andando).
    const hNew = env.terrainHeight(s.x, s.z);
    if (hNew > s.y + cfg.stepHeight * 0.5) {
      const rise = hNew - env.terrainHeight(px, pz);
      const run = Math.hypot(s.x - px, s.z - pz);
      if (rise > run * tanMax + 0.01 || hNew > s.y + cfg.stepHeight) {
        s.x = px;
        s.z = pz;
        const n = env.terrainNormal(s.x + mvx * sdt * 2, s.z + mvz * sdt * 2, tmpN);
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

  // --- pendiente: deslizarse si es demasiado inclinada (solo sobre terreno)
  if (s.grounded && !s.onCollider) {
    const n = env.terrainNormal(s.x, s.z, tmpN);
    s.sliding = n.y < Math.cos(cfg.maxSlopeDeg * DEG2RAD);
  } else {
    s.sliding = false;
  }

  // --- agua profunda: nadar, bucear o hundirse agotado
  const lvl = env.waterLevelAt(s.x, s.z);
  const floatY = lvl === null ? -Infinity : lvl - cfg.floatDepth;
  const deep = lvl !== null && lvl - groundH > cfg.floatDepth;
  if (deep && (s.swimming || s.y < floatY)) {
    if (!s.swimming && s.vy < 0) {
      ev.landedInWater = true;
      ev.landedSpeed = Math.max(ev.landedSpeed, -s.vy);
    }
    s.swimming = true;
    s.grounded = false;
    s.sliding = false;
    s.jumpRising = false;
    if (exhausted) {
      s.vy = -cfg.sinkSpeed; // agotado: se hunde
    } else if (input.dive) {
      s.vy = -cfg.diveSpeed;
    } else {
      // Sube hasta la línea de flotación sin rebotar.
      s.vy = Math.min(cfg.diveSpeed * 1.5, (floatY - s.y) * 6);
    }
    s.y = Math.max(groundH, Math.min(s.y, floatY + 0.001));
    if (s.y >= floatY - 0.001 && !exhausted && !input.dive) s.y = floatY;
    s.airTime = 0;
    s.fallStartY = s.y;
  } else if (s.swimming && !deep) {
    // Sale del agua por la orilla.
    s.swimming = false;
    s.grounded = s.y <= groundH + 0.05;
    if (s.grounded) s.y = groundH;
  }
  s.waterDepth = lvl === null ? 0 : Math.max(0, lvl - s.y);
  s.underwater = lvl !== null && s.y + body.eyeHeight < lvl;

  if (!s.grounded && !s.swimming) {
    s.airTime += dt;
    s.fallStartY = Math.max(s.fallStartY, s.y);
  } else if (s.grounded) {
    s.airTime = 0;
    s.fallStartY = s.y;
  }

  // --- orientación: impuesta (combate) o hacia la dirección de entrada
  if (input.faceYaw !== undefined) s.yaw = dampAngle(s.yaw, input.faceYaw, cfg.turnSharpness * 1.6, dt);
  else if (hasInput && !s.sliding) s.yaw = dampAngle(s.yaw, Math.atan2(input.moveX, input.moveZ), cfg.turnSharpness, dt);

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
export function clipVelocity(s: { vx: number; vz: number }, nx: number, nz: number): void {
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
