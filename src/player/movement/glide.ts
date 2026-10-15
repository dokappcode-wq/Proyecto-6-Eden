import { damp, moveTowards } from '../../core/math';
import type { GliderConfig, GliderUpgrade, StaminaConfig } from '../../data/schemas';
import { emptyAir, type AirSample } from '../../world/airflow/Airflow';
import type { CharacterEnv, CharacterState } from '../CharacterController';
import { spendRate } from './Stamina';

export interface GlideInput {
  /** A/D: girar (-1 izquierda, +1 derecha). */
  turn: number;
  /** W: picado (+1), S: frenar/flare (-1). */
  pitch: number;
}

/** Parámetros efectivos tras aplicar mejoras (tela reforzada, alas amplias...). */
export interface GliderModifiers {
  staminaMultiplier: number;
  fallMultiplier: number;
  windMultiplier: number;
  /** Segundos de planeo sin gasto tras cada despliegue. */
  freeSeconds: number;
}

export function gliderModifiers(upgrades: readonly GliderUpgrade[]): GliderModifiers {
  return upgrades.reduce(
    (m, u) => ({
      staminaMultiplier: m.staminaMultiplier * u.staminaMultiplier,
      fallMultiplier: m.fallMultiplier * u.fallMultiplier,
      windMultiplier: m.windMultiplier * u.windMultiplier,
      freeSeconds: m.freeSeconds,
    }),
    { staminaMultiplier: 1, fallMultiplier: 1, windMultiplier: 1, freeSeconds: 0 },
  );
}

export type GlideLabel = 'Plegado' | 'Desplegando' | 'Desplegado' | 'Picado' | 'Frenando' | 'Corriente';

export function glideStateLabel(s: CharacterState): GlideLabel {
  if (s.mode !== 'glide') return 'Plegado';
  const g = s.glide;
  if (g.deployT < 0) return 'Desplegando';
  if (g.inThermal) return 'Corriente';
  if (g.dive > 0.3) return 'Picado';
  if (g.flare > 0.3) return 'Frenando';
  return 'Desplegado';
}

/** Despliega el planeador conservando la inercia horizontal. */
export function beginGlide(s: CharacterState, cfg: GliderConfig): void {
  const g = s.glide;
  const horiz = Math.hypot(s.vx, s.vz);
  g.heading = horiz > 1 ? Math.atan2(s.vx, s.vz) : s.yaw;
  g.speed = Math.max(horiz, cfg.forwardSpeed * 0.55);
  g.deployT = -cfg.deploySeconds; // negativo = animación de despliegue en curso
  g.airtime = 0;
  g.bank = 0;
  g.dive = 0;
  g.flare = 0;
  g.inThermal = false;
  s.mode = 'glide';
  s.sprinting = false;
  s.jumpRising = false;
}

/** Pliega el planeador: vuelve a caer libremente (el daño de caída cuenta desde aquí). */
export function foldGlider(s: CharacterState): void {
  const g = s.glide;
  s.mode = 'air';
  s.vx = Math.sin(g.heading) * g.speed;
  s.vz = Math.cos(g.heading) * g.speed;
  s.vy = Math.min(s.vy, 0);
  s.fallStartY = s.y;
  s.airTime = 0.2;
}

const air: AirSample = emptyAir();

export interface GlideStepResult {
  /** Se quedó sin stamina y se plegó. */
  exhausted: boolean;
}

/**
 * Física de planeo de un paso: giro con alabeo, picado (altura → velocidad), flare,
 * conversión de velocidad en altura al salir del picado, viento y corrientes térmicas.
 * NO integra la posición (lo hace el orquestador con colisiones).
 */
export function stepGlide(
  s: CharacterState,
  input: GlideInput,
  cfg: GliderConfig,
  mods: GliderModifiers,
  staminaCfg: StaminaConfig,
  env: CharacterEnv,
  dt: number,
): GlideStepResult {
  const g = s.glide;
  g.deployT = Math.min(1, g.deployT + dt);

  // La lluvia reduce ligeramente el control.
  const control = 1 - 0.3 * (env.wetness?.() ?? 0);
  g.heading -= input.turn * cfg.turnRate * control * dt;
  g.bank = damp(g.bank, input.turn * cfg.bankMaxRad, 6, dt);
  g.dive = damp(g.dive, Math.max(0, input.pitch), 6, dt);
  g.flare = damp(g.flare, Math.max(0, -input.pitch), 8, dt);

  // Velocidad horizontal objetivo.
  const flaring = g.flare > 0.3;
  const target = flaring ? cfg.flare.speed : cfg.forwardSpeed + (cfg.dive.speed - cfg.forwardSpeed) * g.dive;
  let rate: number;
  if (target < g.speed) rate = flaring ? cfg.flare.decel : cfg.accel * 1.4;
  else rate = g.dive > 0.3 ? cfg.dive.accel : cfg.accel;
  const excess = g.speed - cfg.forwardSpeed;
  g.speed = moveTowards(g.speed, target, rate * dt);

  // Velocidad vertical objetivo.
  let targetVy = -(flaring ? cfg.flare.fallSpeed : cfg.fallSpeed * mods.fallMultiplier + (cfg.dive.fallSpeed - cfg.fallSpeed * mods.fallMultiplier) * g.dive);
  // Salir de un picado convierte el exceso de velocidad en altura (sensación de "tirón" hacia arriba).
  if (g.dive < 0.15 && excess > 0.5) targetVy = Math.min(cfg.maxPullUpLift, excess * cfg.pullUpLiftFactor);

  const a = env.airflowAt ? env.airflowAt(s.x, s.y, s.z, air) : emptyAir();
  g.inThermal = a.lift > 0.1;
  if (g.inThermal) targetVy = Math.max(targetVy, a.lift);
  g.windX = a.windX * cfg.windInfluence * mods.windMultiplier;
  g.windZ = a.windZ * cfg.windInfluence * mods.windMultiplier;

  // Durante el despliegue la caída se frena progresivamente.
  s.vy = damp(s.vy, targetVy, cfg.verticalResponse * (g.deployT < 0 ? 1.6 : 1), dt);

  s.vx = Math.sin(g.heading) * g.speed + g.windX;
  s.vz = Math.cos(g.heading) * g.speed + g.windZ;
  s.yaw = g.heading;

  g.airtime += dt;
  // Gratis dentro de una corriente o durante los primeros segundos (set ancestral).
  const free = (g.inThermal && cfg.thermal.staminaFree) || g.airtime < mods.freeSeconds;
  if (!free && !spendRate(s.stamina, cfg.staminaPerSecond * mods.staminaMultiplier, dt, 'glide', staminaCfg)) {
    return { exhausted: true };
  }
  return { exhausted: false };
}
