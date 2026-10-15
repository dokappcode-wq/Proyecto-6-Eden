import type { ArmorConfig, FoodEffect, RecipesConfig, StatKey } from '../data/schemas';
import { STAT_KEYS } from '../data/schemas';
import { wornArmor, type Catalog, type Equipment } from '../combat/inventory';

/** Suma de todas las bonificaciones activas (equipo + sets + comida). */
export type Stats = Record<StatKey, number>;

export function emptyStats(): Stats {
  const s = {} as Stats;
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

function addEffects(s: Stats, effects: Record<string, number>, scale = 1): void {
  for (const [k, v] of Object.entries(effects)) {
    if (k in s) s[k as StatKey] += v * scale;
  }
}

/** Defensa de una pieza según su nivel de mejora (cada nivel +50 % y +1). */
export function pieceDefense(base: number, level: number): number {
  return Math.round(base * (1 + 0.5 * level) + level);
}

/** Coste de mejorar una pieza de `level` a `level + 1` con los materiales de su set. */
export function upgradeCost(set: ArmorConfig['sets'][number], level: number): { item: string; count: number }[] {
  const [main, extra] = set.upgradeItems;
  const mainCount = [3, 5, 8, 12, 16, 20][level] ?? 20;
  const extraCount = [0, 1, 3, 5, 8, 10][level] ?? 10;
  return extraCount > 0 ? [{ item: main, count: mainCount }, { item: extra, count: extraCount }] : [{ item: main, count: mainCount }];
}

export interface ArmorSummary {
  stats: Stats;
  /** Piezas puestas por set y bonificaciones de set activas. */
  sets: { id: string; name: string; pieces: number; total: number; active: number[] }[];
}

/** Estadísticas de la armadura puesta: piezas (con su nivel) + bonificaciones de set. */
export function armorStats(eq: Equipment, catalog: Catalog): ArmorSummary {
  const stats = emptyStats();
  const counts = new Map<string, { set: ArmorConfig['sets'][number]; n: number }>();
  for (const inst of wornArmor(eq)) {
    const piece = catalog.armor(inst.id);
    stats.defense += pieceDefense(piece.defense, inst.level);
    addEffects(stats, piece.effects);
    const set = catalog.setOf(inst.id);
    if (set) counts.set(set.id, { set, n: (counts.get(set.id)?.n ?? 0) + 1 });
  }
  const sets: ArmorSummary['sets'] = [];
  for (const [id, { set, n }] of counts) {
    const active: number[] = [];
    for (const b of set.bonus) {
      if (n >= b.pieces) {
        addEffects(stats, b.effects);
        active.push(b.pieces);
      }
    }
    sets.push({ id, name: set.name, pieces: n, total: set.pieces.length, active });
  }
  return { stats, sets };
}

/** Efecto temporal de comida activo. */
export interface Buff {
  effect: FoodEffect;
  /** Nivel 1-3. */
  potency: number;
  remaining: number;
}

/** Bonificación que da un efecto de comida temporal. */
export function buffStats(b: Buff, recipes: RecipesConfig): Partial<Stats> {
  const per = recipes.effects[b.effect]?.per ?? 0;
  const v = per * b.potency;
  switch (b.effect) {
    case 'cold':
      return { coldResist: v };
    case 'heat':
      return { heatResist: v };
    case 'attack':
      return { attack: v };
    case 'defense':
      return { defense: v };
    case 'stealth':
      return { stealth: v };
    case 'speed':
      return { speed: v };
    case 'shock':
      return { shockResist: v };
    default:
      return {};
  }
}

/** Estadísticas totales: armadura + comida. */
export function totalStats(eq: Equipment, catalog: Catalog, buff: Buff | null, recipes: RecipesConfig): ArmorSummary {
  const a = armorStats(eq, catalog);
  if (buff) addEffects(a.stats, buffStats(buff, recipes) as Record<string, number>);
  return a;
}

/** Daño recibido tras la defensa (nunca menos de 1 si había daño). */
export function mitigate(damage: number, defense: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round((damage * 24) / (24 + Math.max(0, defense))));
}
