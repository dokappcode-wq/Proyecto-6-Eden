import type { CombatConfig, WeaponDef } from '../data/schemas';

export type AttackKind = 'light' | 'heavy' | 'air' | 'plunge' | 'flurry' | 'thrown' | 'arrow' | 'stomp' | 'shockwave';

export interface HitModifiers {
  kind: AttackKind;
  /** Multiplicador del golpe dentro del combo o del ataque cargado. */
  multiplier: number;
  /** Enemigo desprevenido (golpe crítico por sigilo). */
  sneak: boolean;
  /** Impacto en el punto débil (núcleo, cabeza, cristal). */
  weakPoint: boolean;
  weakPointBonus: number;
  /** Último golpe antes de romperse: explosión de daño. */
  breaking: boolean;
  /** Etiquetas del objetivo (rock, wood, shield, gel...). */
  targetTags: readonly string[];
}

/**
 * Daño final de un golpe (pura y testeable).
 * Las armas se diferencian por su daño base, su multiplicador de combo/carga y sus afinidades:
 * martillo ×2 contra roca, hacha ×2 contra madera y escudos, dagas ×4 en sigilo.
 */
export function computeDamage(weapon: WeaponDef, m: HitModifiers, cfg: CombatConfig): number {
  let dmg = weapon.damage * m.multiplier;
  if (m.kind === 'plunge') dmg *= cfg.plunge.damageMultiplier;
  if (m.kind === 'thrown') dmg *= cfg.throwMultiplier;
  if (m.sneak) dmg *= weapon.heavy.special === 'backstab_x4' ? 4 : cfg.sneakMultiplier;
  if (m.weakPoint) dmg *= m.weakPointBonus;
  if (m.breaking) dmg *= cfg.breakDamageMultiplier;
  if (weapon.category === 'hammer' && m.targetTags.includes('rock')) dmg *= 2;
  if (weapon.heavy.special === 'shield_break' && (m.targetTags.includes('wood') || m.targetTags.includes('shield'))) dmg *= 2;
  return Math.max(1, Math.round(dmg));
}

/** ¿Está el punto (ex, ez) de radio `er` dentro del arco de golpe? Yaw con convención (sin, cos). */
export function inArc(px: number, pz: number, yaw: number, ex: number, ez: number, er: number, reach: number, arcDeg: number): boolean {
  const dx = ex - px;
  const dz = ez - pz;
  const d = Math.hypot(dx, dz);
  if (d > reach + er) return false;
  if (arcDeg >= 359 || d < 1e-4) return true;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cos = (dx * fx + dz * fz) / d;
  // El radio del objetivo amplía ligeramente el arco efectivo.
  const half = (arcDeg / 2) * (Math.PI / 180) + Math.atan2(er, Math.max(d, 0.01));
  return cos >= Math.cos(Math.min(Math.PI, half));
}
