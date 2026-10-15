import type { ArmorConfig, ArmorPiece, ArmorSlot, CombatConfig, FoodEffect, ItemsConfig, ShieldDef, WeaponDef, WeaponsConfig } from '../data/schemas';

export type SlotKind = 'melee' | 'bow' | 'shield';
export const ARMOR_SLOT_LIST: readonly ArmorSlot[] = ['head', 'torso', 'legs', 'boots', 'cape', 'charm'];

/** Una pieza de armadura concreta con su nivel de mejora. */
export interface ArmorInstance {
  uid: number;
  id: string;
  level: number;
}

/** Plato cocinado (se apilan los idénticos). */
export interface Meal {
  uid: number;
  recipe: string;
  name: string;
  /** Fragmentos de corazón que cura. */
  heal: number;
  effect: FoodEffect | null;
  /** Nivel del efecto (1-3) o cantidad para efectos instantáneos. */
  potency: number;
  seconds: number;
  count: number;
}

/** Un arma concreta (con su durabilidad propia). */
export interface WeaponInstance {
  uid: number;
  id: string;
  durability: number;
}

export interface Equipment {
  weapons: WeaponInstance[];
  bows: WeaponInstance[];
  shields: WeaponInstance[];
  /** uid equipado por ranura (null = nada; en cuerpo a cuerpo, null = puños). */
  melee: number | null;
  bow: number | null;
  shield: number | null;
  items: Record<string, number>;
  nextUid: number;
  armor: ArmorInstance[];
  /** Pieza puesta en cada hueco (uid) o null. */
  worn: Record<ArmorSlot, number | null>;
  meals: Meal[];
  /** Huecos extra comprados con semillas. */
  slotBonus: { weapons: number; bows: number; shields: number };
}

export function createEquipment(): Equipment {
  return {
    weapons: [],
    bows: [],
    shields: [],
    melee: null,
    bow: null,
    shield: null,
    items: {},
    nextUid: 1,
    armor: [],
    worn: { head: null, torso: null, legs: null, boots: null, cape: null, charm: null },
    meals: [],
    slotBonus: { weapons: 0, bows: 0, shields: 0 },
  };
}

/** Catálogo de armas/escudos/objetos para búsquedas rápidas por id. */
export class Catalog {
  private readonly weapons = new Map<string, WeaponDef>();
  private readonly shields = new Map<string, ShieldDef>();
  private readonly items = new Map<string, ItemsConfig['items'][number]>();
  private readonly armorPieces = new Map<string, ArmorPiece>();
  private readonly armorSet = new Map<string, ArmorConfig['sets'][number]>();

  constructor(w: WeaponsConfig, items: ItemsConfig, armor?: ArmorConfig) {
    for (const d of w.weapons) this.weapons.set(d.id, d);
    for (const d of w.shields) this.shields.set(d.id, d);
    for (const d of items.items) this.items.set(d.id, d);
    if (armor) {
      for (const st of armor.sets) {
        for (const p of st.pieces) {
          this.armorPieces.set(p.id, p);
          this.armorSet.set(p.id, st);
        }
      }
      for (const p of armor.accessories) this.armorPieces.set(p.id, p);
    }
  }

  armor(id: string): ArmorPiece {
    const d = this.armorPieces.get(id);
    if (!d) throw new Error(`Armadura desconocida: ${id}`);
    return d;
  }

  /** Set al que pertenece una pieza (los accesorios no tienen set). */
  setOf(id: string): ArmorConfig['sets'][number] | null {
    return this.armorSet.get(id) ?? null;
  }

  get allItems(): IterableIterator<ItemsConfig['items'][number]> {
    return this.items.values();
  }

  weapon(id: string): WeaponDef {
    const d = this.weapons.get(id);
    if (!d) throw new Error(`Arma desconocida: ${id}`);
    return d;
  }

  shield(id: string): ShieldDef {
    const d = this.shields.get(id);
    if (!d) throw new Error(`Escudo desconocido: ${id}`);
    return d;
  }

  item(id: string): ItemsConfig['items'][number] | undefined {
    return this.items.get(id);
  }

  /** Clasifica un id de objeto recogible. */
  kindOf(id: string): SlotKind | 'item' | 'armor' | null {
    const w = this.weapons.get(id);
    if (w) return w.category === 'bow' ? 'bow' : 'melee';
    if (this.shields.has(id)) return 'shield';
    if (this.items.has(id)) return 'item';
    if (this.armorPieces.has(id)) return 'armor';
    return null;
  }

  name(id: string): string {
    return this.weapons.get(id)?.name ?? this.shields.get(id)?.name ?? this.items.get(id)?.name ?? this.armorPieces.get(id)?.name ?? id;
  }

  maxDurability(id: string): number {
    return this.weapons.get(id)?.durability ?? this.shields.get(id)?.durability ?? 0;
  }
}

function listFor(eq: Equipment, kind: SlotKind): WeaponInstance[] {
  return kind === 'melee' ? eq.weapons : kind === 'bow' ? eq.bows : eq.shields;
}

function limitFor(kind: SlotKind, limits: CombatConfig['inventory']): number {
  return kind === 'melee' ? limits.weapons : kind === 'bow' ? limits.bows : limits.shields;
}

/**
 * Añade un arma/arco/escudo. Si la ranura está vacía, se equipa al momento.
 * Devuelve null si el inventario de ese tipo está lleno.
 */
export function addGear(eq: Equipment, catalog: Catalog, id: string, limits: CombatConfig['inventory'], durability?: number): WeaponInstance | null {
  const kind = catalog.kindOf(id);
  if (kind === null || kind === 'item' || kind === 'armor') throw new Error(`"${id}" no es un arma, arco o escudo`);
  const list = listFor(eq, kind);
  if (list.length >= limitFor(kind, effectiveLimits(eq, limits))) return null;
  const inst: WeaponInstance = { uid: eq.nextUid++, id, durability: durability ?? catalog.maxDurability(id) };
  list.push(inst);
  if (eq[kind] === null) eq[kind] = inst.uid;
  return inst;
}

/** Huecos disponibles: los base más los comprados con semillas. */
export function effectiveLimits(eq: Equipment, base: CombatConfig['inventory']): CombatConfig['inventory'] {
  return { weapons: base.weapons + eq.slotBonus.weapons, bows: base.bows + eq.slotBonus.bows, shields: base.shields + eq.slotBonus.shields };
}

/** Añade una pieza de armadura (se pone sola si su hueco está libre). */
export function addArmor(eq: Equipment, catalog: Catalog, id: string, level = 0): ArmorInstance {
  const piece = catalog.armor(id);
  const inst: ArmorInstance = { uid: eq.nextUid++, id, level };
  eq.armor.push(inst);
  if (eq.worn[piece.slot] === null) eq.worn[piece.slot] = inst.uid;
  return inst;
}

/** Ponerse (o quitarse, si ya la lleva) una pieza. */
export function toggleArmor(eq: Equipment, catalog: Catalog, uid: number): void {
  const inst = eq.armor.find((a) => a.uid === uid);
  if (!inst) return;
  const slot = catalog.armor(inst.id).slot;
  eq.worn[slot] = eq.worn[slot] === uid ? null : uid;
}

/** Piezas puestas ahora mismo. */
export function wornArmor(eq: Equipment): ArmorInstance[] {
  const out: ArmorInstance[] = [];
  for (const slot of ARMOR_SLOT_LIST) {
    const uid = eq.worn[slot];
    const inst = uid !== null ? eq.armor.find((a) => a.uid === uid) : undefined;
    if (inst) out.push(inst);
  }
  return out;
}

/** Añade un plato (apila con uno idéntico). */
export function addMeal(eq: Equipment, meal: Omit<Meal, 'uid' | 'count'>): Meal {
  const same = eq.meals.find((m) => m.recipe === meal.recipe && m.name === meal.name && m.heal === meal.heal && m.effect === meal.effect && m.potency === meal.potency && m.seconds === meal.seconds);
  if (same) {
    same.count++;
    return same;
  }
  const m: Meal = { ...meal, uid: eq.nextUid++, count: 1 };
  eq.meals.push(m);
  return m;
}

export function findGear(eq: Equipment, uid: number | null): { inst: WeaponInstance; kind: SlotKind } | null {
  if (uid === null) return null;
  for (const kind of ['melee', 'bow', 'shield'] as const) {
    const inst = listFor(eq, kind).find((w) => w.uid === uid);
    if (inst) return { inst, kind };
  }
  return null;
}

export function equipped(eq: Equipment, kind: SlotKind): WeaponInstance | null {
  return findGear(eq, eq[kind])?.inst ?? null;
}

/** Equipa por uid (en su ranura) o, con `uid = null` y kind melee, vuelve a los puños. */
export function equip(eq: Equipment, kind: SlotKind, uid: number | null): void {
  if (uid !== null && !listFor(eq, kind).some((w) => w.uid === uid)) throw new Error(`uid ${uid} no está en ${kind}`);
  eq[kind] = uid;
}

/** Quita un arma del inventario (rota o lanzada). Si estaba equipada, la ranura queda libre. */
export function removeGear(eq: Equipment, uid: number): WeaponInstance | null {
  const found = findGear(eq, uid);
  if (!found) return null;
  const list = listFor(eq, found.kind);
  list.splice(list.indexOf(found.inst), 1);
  if (eq[found.kind] === uid) eq[found.kind] = null;
  return found.inst;
}

/**
 * Gasta durabilidad. Devuelve 'broken' si el arma se rompe (y la retira del inventario),
 * 'warning' al cruzar el umbral de aviso, u 'ok'. Las armas con durabilidad 0 son irrompibles.
 */
export function wear(eq: Equipment, catalog: Catalog, uid: number, amount: number, warningFraction: number): 'ok' | 'warning' | 'broken' {
  const found = findGear(eq, uid);
  if (!found) return 'ok';
  const max = catalog.maxDurability(found.inst.id);
  if (max <= 0) return 'ok';
  const before = found.inst.durability / max;
  found.inst.durability = Math.max(0, found.inst.durability - amount);
  if (found.inst.durability <= 0) {
    removeGear(eq, uid);
    return 'broken';
  }
  const after = found.inst.durability / max;
  return before > warningFraction && after <= warningFraction ? 'warning' : 'ok';
}

export function addItem(eq: Equipment, id: string, count: number, stack: number): number {
  const have = eq.items[id] ?? 0;
  const added = Math.max(0, Math.min(count, stack - have));
  eq.items[id] = have + added;
  return added;
}

export function takeItem(eq: Equipment, id: string, count: number): boolean {
  const have = eq.items[id] ?? 0;
  if (have < count) return false;
  eq.items[id] = have - count;
  return true;
}

const FOOD_EFFECT_SET = new Set<string>(['hearty', 'stamina', 'endurance', 'cold', 'heat', 'attack', 'defense', 'stealth', 'speed', 'shock']);
function isFoodEffect(e: string): e is FoodEffect {
  return FOOD_EFFECT_SET.has(e);
}

export interface SavedEquipment {
  weapons: { id: string; durability: number }[];
  bows: { id: string; durability: number }[];
  shields: { id: string; durability: number }[];
  melee: number;
  bow: number;
  shield: number;
  items: Record<string, number>;
  armor?: { id: string; level: number; worn: boolean }[];
  meals?: (Omit<Meal, 'uid' | 'effect'> & { effect: string | null })[];
  slotBonus?: { weapons: number; bows: number; shields: number };
}

export function serializeEquipment(eq: Equipment): SavedEquipment {
  const idx = (list: WeaponInstance[], uid: number | null) => list.findIndex((w) => w.uid === uid);
  const strip = (list: WeaponInstance[]) => list.map((w) => ({ id: w.id, durability: w.durability }));
  return {
    weapons: strip(eq.weapons),
    bows: strip(eq.bows),
    shields: strip(eq.shields),
    melee: idx(eq.weapons, eq.melee),
    bow: idx(eq.bows, eq.bow),
    shield: idx(eq.shields, eq.shield),
    items: { ...eq.items },
    armor: eq.armor.map((a) => ({ id: a.id, level: a.level, worn: Object.values(eq.worn).includes(a.uid) })),
    meals: eq.meals.map(({ uid: _uid, ...m }) => m),
    slotBonus: { ...eq.slotBonus },
  };
}

/** Reconstruye el equipo guardado (ignora ids que ya no existan en los datos). */
export function restoreEquipment(saved: SavedEquipment, catalog: Catalog): Equipment {
  const eq = createEquipment();
  const big = { weapons: 999, bows: 999, shields: 999 };
  const load = (list: { id: string; durability: number }[]) => list.filter((g) => catalog.kindOf(g.id) !== null).map((g) => addGear(eq, catalog, g.id, big, g.durability));
  const w = load(saved.weapons);
  const b = load(saved.bows);
  const s = load(saved.shields);
  eq.melee = w[saved.melee]?.uid ?? null;
  eq.bow = b[saved.bow]?.uid ?? null;
  eq.shield = s[saved.shield]?.uid ?? null;
  for (const [id, n] of Object.entries(saved.items)) if (catalog.item(id)) eq.items[id] = n;
  for (const a of saved.armor ?? []) {
    if (catalog.kindOf(a.id) !== 'armor') continue;
    const inst: ArmorInstance = { uid: eq.nextUid++, id: a.id, level: a.level };
    eq.armor.push(inst);
    if (a.worn) eq.worn[catalog.armor(a.id).slot] = inst.uid;
  }
  for (const m of saved.meals ?? []) eq.meals.push({ ...m, effect: m.effect && isFoodEffect(m.effect) ? m.effect : null, uid: eq.nextUid++ });
  if (saved.slotBonus) eq.slotBonus = { ...saved.slotBonus };
  return eq;
}
