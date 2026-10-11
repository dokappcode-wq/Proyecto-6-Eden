import type { StaminaConfig } from '../../data/schemas';

export interface StaminaState {
  current: number;
  max: number;
  /** Agotado: sin acciones de stamina hasta recuperar `exhaustedRecoverFraction`. */
  exhausted: boolean;
  /** Tiempo restante sin recarga tras agotarse (s). */
  lockTimer: number;
  /** Tiempo desde el último gasto (s). */
  sinceSpend: number;
  /** Último consumo continuo (para el color de la rueda: el planeador se pinta en cian). */
  lastSource: string;
  /** Gasto acumulado en este frame (debug). */
  spentThisStep: number;
}

export function createStamina(max: number): StaminaState {
  return { current: max, max, exhausted: false, lockTimer: 0, sinceSpend: 999, lastSource: '', spentThisStep: 0 };
}

/** Puede empezar una acción que cuesta stamina. */
export function canUse(s: StaminaState): boolean {
  return !s.exhausted && s.current > 0;
}

/** Gasto puntual. Devuelve false (sin gastar) si no alcanza o está agotado. */
export function spend(s: StaminaState, amount: number, source: string, cfg: StaminaConfig): boolean {
  if (amount <= 0) return true;
  if (!canUse(s) || s.current < amount) return false;
  drain(s, amount, source, cfg);
  return true;
}

/**
 * Gasto continuo (por segundo). Devuelve false cuando ya no queda: la acción debe cortarse.
 * A diferencia de `spend`, consume lo que quede aunque no llegue al total.
 */
export function spendRate(s: StaminaState, perSecond: number, dt: number, source: string, cfg: StaminaConfig): boolean {
  if (perSecond <= 0) return true;
  if (!canUse(s)) return false;
  drain(s, Math.min(s.current, perSecond * dt), source, cfg);
  return s.current > 0;
}

/** Recarga: tras `recoverDelay` sin gastar; bloqueada `exhaustedLockout` s al agotarse. */
export function updateStamina(s: StaminaState, dt: number, cfg: StaminaConfig): void {
  s.sinceSpend += dt;
  if (s.lockTimer > 0) {
    s.lockTimer = Math.max(0, s.lockTimer - dt);
    return;
  }
  if (s.sinceSpend >= cfg.recoverDelay && s.current < s.max) {
    s.current = Math.min(s.max, s.current + cfg.recoverRate * dt);
  }
  if (s.exhausted && s.current >= s.max * cfg.exhaustedRecoverFraction) s.exhausted = false;
}

function drain(s: StaminaState, amount: number, source: string, cfg: StaminaConfig): void {
  s.current = Math.max(0, s.current - amount);
  s.sinceSpend = 0;
  s.lastSource = source;
  s.spentThisStep += amount;
  if (s.current <= 0) {
    s.exhausted = true;
    s.lockTimer = cfg.exhaustedLockout;
  }
}

export interface HealthState {
  /** En cuartos de corazón. */
  fragments: number;
  maxFragments: number;
}

export function createHealth(hearts: number, fragmentsPerHeart: number): HealthState {
  return { fragments: hearts * fragmentsPerHeart, maxFragments: hearts * fragmentsPerHeart };
}

/** Aplica daño y devuelve true si el jugador muere. */
export function damage(h: HealthState, fragments: number): boolean {
  h.fragments = Math.max(0, h.fragments - Math.max(0, Math.round(fragments)));
  return h.fragments <= 0;
}

/**
 * Daño de caída en cuartos de corazón: nada hasta `damageThreshold`, letal a `lethalHeight`
 * (proporcional a la vida máxima). Rodar al aterrizar lo reduce; el agua lo anula.
 */
export function fallDamage(
  drop: number,
  maxFragments: number,
  cfg: { damageThreshold: number; lethalHeight: number; rollDamageMultiplier: number },
  rolled: boolean,
): number {
  if (drop <= cfg.damageThreshold) return 0;
  const k = Math.min(1, (drop - cfg.damageThreshold) / (cfg.lethalHeight - cfg.damageThreshold));
  let dmg = Math.max(1, Math.ceil(k * maxFragments));
  if (rolled) dmg = Math.floor(dmg * cfg.rollDamageMultiplier);
  return dmg;
}
