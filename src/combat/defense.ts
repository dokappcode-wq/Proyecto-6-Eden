import type { CombatConfig, ShieldDef } from '../data/schemas';

export interface DefenseState {
  /** Tiempo desde el inicio de la esquiva (s); Infinity si no hay. */
  dodgeT: number;
  guarding: boolean;
  /** Tiempo desde que se levantó el escudo (s). */
  guardT: number;
}

export type DefenseResult = 'hit' | 'dodged' | 'perfect' | 'blocked' | 'parried';

export function createDefense(): DefenseState {
  return { dodgeT: Infinity, guarding: false, guardT: Infinity };
}

/**
 * Resuelve un ataque entrante:
 * - esquiva con i-frames; si empezó en la última fracción de segundo → esquiva perfecta;
 * - escudo levantado y atacante delante → bloqueo; si se levantó justo a tiempo (ventana de parry) → parry.
 */
export function resolveIncoming(
  def: DefenseState,
  attacker: { x: number; z: number },
  player: { x: number; z: number; yaw: number },
  shield: ShieldDef | null,
  cfg: CombatConfig,
): DefenseResult {
  if (def.dodgeT <= cfg.dodge.iframes) return def.dodgeT <= cfg.dodge.perfectWindow ? 'perfect' : 'dodged';
  if (def.guarding && shield && inFront(attacker, player, shield.guardArc)) {
    return def.guardT <= shield.parryWindow ? 'parried' : 'blocked';
  }
  return 'hit';
}

function inFront(a: { x: number; z: number }, p: { x: number; z: number; yaw: number }, arcDeg: number): boolean {
  const dx = a.x - p.x;
  const dz = a.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  const cos = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / d;
  return cos >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}
