import type { MobilityConfig, MountKindDef } from '../../data/schemas';

type TamingConfig = MobilityConfig['mounts']['taming'];

/** Marcha de una montura: 0 paso, 1 trote, 2 medio galope, 3 galope (espuela). */
export interface MountMotion {
  yaw: number;
  speed: number;
  gait: number;
  spurs: number;
  /** Segundos de galope restantes tras espolear. */
  gallopT: number;
  rechargeT: number;
}

export interface MountInput {
  forward: number;
  right: number;
  spurPressed: boolean;
}

export function createMotion(def: MountKindDef, yaw = 0): MountMotion {
  return { yaw, speed: 0, gait: 0, spurs: def.spurs, gallopT: 0, rechargeT: 0 };
}

/**
 * Control de la montura (lógica pura): adelante = medio galope, espuela = galope mientras
 * duren las espuelas (se recargan solas), atrás frena. Devuelve true si se ha espoleado.
 */
export function stepMotion(m: MountMotion, input: MountInput, def: MountKindDef, dt: number): boolean {
  let spurred = false;
  if (input.spurPressed && m.spurs > 0 && input.forward >= 0) {
    m.spurs--;
    m.gallopT = def.spurSeconds;
    m.rechargeT = 0;
    spurred = true;
  }
  if (m.gallopT > 0) m.gallopT -= dt;
  if (input.forward > 0.2) m.gait = m.gallopT > 0 ? 3 : input.forward > 0.75 ? 2 : 1;
  else if (input.forward < -0.2) m.gait = -1;
  else m.gait = m.gallopT > 0 ? 3 : 0;
  const target = m.gait < 0 ? 0 : m.gait === 0 ? (Math.abs(input.right) > 0.2 ? def.speeds[0] : 0) : def.speeds[m.gait];
  const accel = target > m.speed ? 7 + m.gait * 2 : m.gait < 0 ? 16 : 9;
  m.speed += Math.sign(target - m.speed) * Math.min(Math.abs(target - m.speed), accel * dt);
  // A más velocidad, giros más abiertos.
  const turnK = 1 / (1 + m.speed * 0.06);
  m.yaw -= input.right * def.turnRate * turnK * dt;
  if (m.gallopT <= 0 && m.spurs < def.spurs) {
    m.rechargeT += dt;
    if (m.rechargeT >= def.spurRecharge) {
      m.rechargeT = 0;
      m.spurs++;
    }
  }
  return spurred;
}

/** Doma: calmar a la montura (pulsar interactuar) antes de agotar el vigor. */
export interface TameState {
  progress: number;
  /** Corcoveo actual (rad), solo visual. */
  buck: number;
  t: number;
}

export function createTame(): TameState {
  return { progress: 0.15, buck: 0, t: 0 };
}

/**
 * Un paso de la doma. `drain` gasta vigor y devuelve false si ya no queda.
 * Cuanto más bravo (temper), menos calma cada intento y más vigor cuesta.
 */
export function stepTaming(t: TameState, soothe: boolean, temper: number, cfg: TamingConfig, drain: (amount: number) => boolean, dt: number): 'ongoing' | 'tamed' | 'thrown' {
  t.t += dt;
  t.buck = Math.sin(t.t * (6 + temper * 6)) * (0.35 + temper * 0.4) * (1 - t.progress);
  if (soothe) t.progress += cfg.soothe * (1.25 - temper);
  t.progress -= cfg.decay * (0.5 + temper) * dt;
  t.progress = Math.max(0, t.progress);
  if (t.progress >= 1) return 'tamed';
  if (!drain(cfg.staminaDrain * (0.5 + temper) * dt)) return 'thrown';
  return 'ongoing';
}
