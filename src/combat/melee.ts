import type { WeaponDef, WeaponSpecial } from '../data/schemas';
import type { AttackKind } from './damage';

export type MeleePhase = 'idle' | 'windup' | 'active' | 'recovery' | 'charging' | 'heavy';

export interface MeleeState {
  phase: MeleePhase;
  t: number;
  comboIndex: number;
  queued: boolean;
  heldT: number;
  chargeT: number;
  kind: AttackKind;
  /** Identificador del barrido actual: cada objetivo solo recibe un golpe por barrido. */
  swingId: number;
  /** Subgolpes ya emitidos dentro de un ataque cargado múltiple (giro, carga en línea). */
  subHits: number;
}

export interface MeleeInput {
  pressed: boolean;
  held: boolean;
  airborne: boolean;
  /** Ráfaga tras esquiva perfecta: golpes instantáneos. */
  flurry: boolean;
  /** Hay stamina para el ataque cargado. */
  staminaOk: boolean;
}

export interface HitWindow {
  swingId: number;
  kind: AttackKind;
  multiplier: number;
  /** Grados; 360 = alrededor. */
  arc: number;
  reach: number;
  knockback: number;
}

export interface MeleeStepResult {
  window: HitWindow | null;
  /** Multiplicador de la velocidad de movimiento mientras ataca. */
  moveMultiplier: number;
  /** Impulso hacia delante (m/s) de algunos especiales. */
  lunge: number;
  started: 'light' | 'heavy' | 'air' | 'flurry' | null;
  /** Carga completa (para el brillo del arma). */
  charged: boolean;
}

/** Mantener pulsado más que esto convierte el primer golpe en carga. */
export const HOLD_TO_CHARGE = 0.22;

interface HeavyProfile {
  windup: number;
  active: number;
  recovery: number;
  /** Intervalo entre subgolpes (0 = un solo golpe). */
  repeat: number;
  arc: number | null;
  reachBonus: number;
  lunge: number;
  move: number;
}

/** Perfil temporal de cada habilidad especial (lo que hace que cada arma se sienta distinta). */
export function heavyProfile(special: WeaponSpecial): HeavyProfile {
  switch (special) {
    case 'spin_360':
      return { windup: 0.12, active: 1.0, recovery: 0.4, repeat: 0.25, arc: 360, reachBonus: 0.2, lunge: 0, move: 0.55 };
    case 'line_charge':
      return { windup: 0.1, active: 0.6, recovery: 0.35, repeat: 0.15, arc: 50, reachBonus: 0, lunge: 9, move: 0 };
    case 'shockwave':
      return { windup: 0.35, active: 0.12, recovery: 0.6, repeat: 0, arc: 360, reachBonus: 2, lunge: 0, move: 0 };
    case 'backstab_x4':
      return { windup: 0.06, active: 0.24, recovery: 0.2, repeat: 0.12, arc: null, reachBonus: 0, lunge: 3, move: 0.2 };
    case 'leap_thrust':
      return { windup: 0.12, active: 0.2, recovery: 0.42, repeat: 0, arc: 60, reachBonus: 0.4, lunge: 10, move: 0 };
    default:
      return { windup: 0.16, active: 0.18, recovery: 0.42, repeat: 0, arc: null, reachBonus: 0.3, lunge: 0, move: 0.2 };
  }
}

const AIR = { windup: 0.05, active: 0.16, recovery: 0.18 };
const FLURRY = { active: 0.07, recovery: 0.05 };

export function createMelee(): MeleeState {
  return { phase: 'idle', t: 0, comboIndex: 0, queued: false, heldT: 0, chargeT: 0, kind: 'light', swingId: 0, subHits: 0 };
}

export function canCharge(w: WeaponDef): boolean {
  return w.heavy.chargeTime < 50 && w.combo.length > 0;
}

/**
 * Máquina de estados del ataque cuerpo a cuerpo (pura):
 * pulsar = combo de 3 golpes (encadenando si se pulsa durante el golpe);
 * mantener = carga → al soltar, ataque especial del arma; en el aire, tajo giratorio;
 * en ráfaga (esquiva perfecta), golpes instantáneos.
 */
export function stepMelee(s: MeleeState, input: MeleeInput, w: WeaponDef, attackMove: number, dt: number): MeleeStepResult {
  const res: MeleeStepResult = { window: null, moveMultiplier: 1, lunge: 0, started: null, charged: false };
  s.t += dt;
  s.heldT = input.held ? s.heldT + dt : 0;

  // Ráfaga: cada pulsación es un golpe inmediato.
  if (input.flurry && input.pressed && (s.phase === 'idle' || s.phase === 'recovery' || s.kind === 'flurry')) {
    s.phase = 'active';
    s.kind = 'flurry';
    s.t = 0;
    s.swingId++;
    res.started = 'flurry';
  }

  switch (s.phase) {
    case 'idle': {
      if (!input.pressed || w.combo.length === 0) break;
      s.queued = false;
      s.t = 0;
      if (input.airborne) {
        s.kind = 'air';
        s.phase = 'windup';
        res.started = 'air';
      } else {
        s.kind = 'light';
        s.comboIndex = 0;
        s.phase = 'windup';
        res.started = 'light';
      }
      break;
    }
    case 'windup':
    case 'active':
    case 'recovery': {
      if (input.pressed && s.phase !== 'windup') s.queued = true;
      // Mantener durante el primer golpe → carga.
      if (s.kind === 'light' && s.comboIndex === 0 && s.heldT >= HOLD_TO_CHARGE && canCharge(w) && !input.airborne) {
        s.phase = 'charging';
        s.chargeT = 0;
        s.t = 0;
        break;
      }
      const timing = s.kind === 'air' ? AIR : s.kind === 'flurry' ? { windup: 0, ...FLURRY } : w.combo[s.comboIndex];
      if (s.phase === 'windup' && s.t >= timing.windup) {
        s.phase = 'active';
        s.t = 0;
        s.swingId++;
      }
      if (s.phase === 'active') {
        const hit = s.kind === 'flurry' || s.kind === 'air' ? null : w.combo[s.comboIndex];
        res.window = {
          swingId: s.swingId,
          kind: s.kind,
          multiplier: hit ? hit.damage : 1,
          arc: s.kind === 'air' ? 360 : w.arc,
          reach: w.reach,
          knockback: hit ? hit.knockback : 2,
        };
        if (s.t >= timing.active) {
          s.phase = 'recovery';
          s.t = 0;
        }
      }
      if (s.phase === 'recovery') {
        const lastCombo = s.kind !== 'light' || s.comboIndex >= w.combo.length - 1;
        if (s.queued && !lastCombo) {
          s.comboIndex++;
          s.queued = false;
          s.phase = 'windup';
          s.t = 0;
        } else if (s.t >= timing.recovery) {
          s.phase = 'idle';
          s.comboIndex = 0;
          s.queued = false;
          s.kind = 'light';
        }
      }
      res.moveMultiplier = s.phase === 'recovery' ? 0.6 : attackMove;
      break;
    }
    case 'charging': {
      s.chargeT += dt;
      res.charged = s.chargeT >= w.heavy.chargeTime;
      res.moveMultiplier = 0.4;
      if (!input.held) {
        if (res.charged && input.staminaOk) {
          s.phase = 'heavy';
          s.kind = 'heavy';
          s.t = 0;
          s.subHits = 0;
          res.started = 'heavy';
        } else {
          s.phase = 'idle';
          s.kind = 'light';
        }
      }
      break;
    }
    case 'heavy': {
      const p = heavyProfile(w.heavy.special);
      res.moveMultiplier = p.move;
      if (s.t >= p.windup && s.t < p.windup + p.active) {
        const local = s.t - p.windup;
        const sub = p.repeat > 0 ? Math.floor(local / p.repeat) : 0;
        if (sub >= s.subHits) {
          s.subHits = sub + 1;
          s.swingId++;
        }
        res.window = {
          swingId: s.swingId,
          kind: w.heavy.special === 'shockwave' ? 'shockwave' : 'heavy',
          multiplier: w.heavy.damageMultiplier,
          arc: p.arc ?? w.arc,
          reach: w.reach + p.reachBonus,
          knockback: (w.combo[2]?.knockback ?? 4) * 1.5,
        };
        res.lunge = p.lunge;
      } else if (s.t >= p.windup + p.active + p.recovery) {
        s.phase = 'idle';
        s.kind = 'light';
        s.comboIndex = 0;
      }
      break;
    }
  }
  return res;
}

/** Duración total del combo ligero de 3 golpes (para comparar armas en tests). */
export function comboDuration(w: WeaponDef): number {
  return w.combo.reduce((t, h) => t + h.windup + h.active, 0) + (w.combo.at(-1)?.recovery ?? 0);
}
