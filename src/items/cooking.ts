import type { FoodEffect, ItemDef, RecipesConfig } from '../data/schemas';

export interface CookResult {
  recipe: string;
  name: string;
  /** Fragmentos de corazón que cura. */
  heal: number;
  effect: FoodEffect | null;
  /** Nivel (efectos temporales) o cantidad (instantáneos). */
  potency: number;
  seconds: number;
  dubious: boolean;
}

/**
 * Cocina hasta N ingredientes: la receta se elige por etiquetas (recipes.json); la curación
 * es la suma de los ingredientes ×2; el efecto solo sale si todos los ingredientes con efecto
 * comparten el mismo (mezclar efectos los anula); las partes de monstruo alargan la duración.
 * Lógica pura y testeable.
 */
export function cook(ids: readonly string[], item: (id: string) => ItemDef | undefined, cfg: RecipesConfig): CookResult {
  const c = cfg.cooking;
  const defs = ids.map((id) => item(id));
  const dubious = (): CookResult => ({ recipe: 'dubious', name: 'Plato dudoso', heal: c.dubiousHeal, effect: null, potency: 0, seconds: 0, dubious: true });
  if (defs.length === 0 || defs.length > c.maxIngredients || defs.some((d) => !d?.food)) return dubious();
  const foods = defs.map((d) => (d as ItemDef & { food: NonNullable<ItemDef['food']> }).food);
  const tags = new Set(foods.flatMap((f) => f.tags));

  const recipe = cfg.recipes.find((r) => r.requires.every((t) => tags.has(t)) && (r.allow.length === 0 || foods.every((f) => f.tags.some((t) => r.allow.includes(t)))));
  const monsters = foods.filter((f) => f.tags.includes('monster')).length;
  const critters = foods.filter((f) => f.tags.includes('critter')).length;
  const edible = foods.some((f) => f.heal > 0 || f.effect);
  // Solo partes de monstruo, o bichos sin parte de monstruo: incomible.
  if (!recipe || !edible || (monsters === foods.length && !critters) || (critters > 0 && monsters === 0)) return dubious();

  const heal = foods.reduce((a, f) => a + f.heal, 0) * c.healMultiplier;
  const effects = new Set(foods.filter((f) => f.effect).map((f) => f.effect as FoodEffect));
  let effect: FoodEffect | null = effects.size === 1 ? [...effects][0] : null;
  let potency = 0;
  let seconds = 0;
  if (effect) {
    const sum = foods.reduce((a, f) => a + (f.effect === effect ? f.potency : 0), 0);
    const kind = cfg.effects[effect]?.kind ?? 'timed';
    if (kind === 'timed') {
      potency = Math.min(3, Math.max(1, Math.ceil(sum / c.potencyPerLevel)));
      seconds = Math.min(c.maxSeconds, foods.reduce((a, f) => a + f.seconds, 0) + c.secondsPerIngredient * foods.length + c.monsterSeconds * monsters);
      if (seconds <= 0) effect = null;
    } else {
      potency = sum;
    }
  }
  const effectName = effect ? cfg.effects[effect]?.name.toLowerCase() : '';
  return {
    recipe: recipe.id,
    name: effect ? `${recipe.name} (${effectName})` : recipe.name,
    heal,
    effect,
    potency,
    seconds,
    dubious: false,
  };
}

/** Comer un ingrediente crudo: cura lo suyo y da su efecto al nivel 1. */
export function rawFood(def: ItemDef, cfg: RecipesConfig): CookResult | null {
  const f = def.food;
  if (!f || (f.heal <= 0 && !f.effect) || f.tags.includes('monster') || f.tags.includes('critter')) return null;
  const kind = f.effect ? cfg.effects[f.effect]?.kind : undefined;
  return {
    recipe: 'raw',
    name: def.name,
    heal: f.heal,
    effect: f.effect ?? null,
    potency: f.effect ? (kind === 'timed' ? 1 : f.potency * 0.5) : 0,
    seconds: kind === 'timed' ? f.seconds : 0,
    dubious: false,
  };
}
