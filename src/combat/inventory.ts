import type { CombatConfig, ItemsConfig, ShieldDef, WeaponDef, WeaponsConfig } from '../data/schemas';

export type SlotKind = 'melee' | 'bow' | 'shield';

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
}

export function createEquipment(): Equipment {
  return { weapons: [], bows: [], shields: [], melee: null, bow: null, shield: null, items: {}, nextUid: 1 };
}

/** Catálogo de armas/escudos/objetos para búsquedas rápidas por id. */
export class Catalog {
  private readonly weapons = new Map<string, WeaponDef>();
  private readonly shields = new Map<string, ShieldDef>();
  private readonly items = new Map<string, ItemsConfig['items'][number]>();

  constructor(w: WeaponsConfig, items: ItemsConfig) {
    for (const d of w.weapons) this.weapons.set(d.id, d);
    for (const d of w.shields) this.shields.set(d.id, d);
    for (const d of items.items) this.items.set(d.id, d);
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
  kindOf(id: string): SlotKind | 'item' | null {
    const w = this.weapons.get(id);
    if (w) return w.category === 'bow' ? 'bow' : 'melee';
    if (this.shields.has(id)) return 'shield';
    if (this.items.has(id)) return 'item';
    return null;
  }

  name(id: string): string {
    return this.weapons.get(id)?.name ?? this.shields.get(id)?.name ?? this.items.get(id)?.name ?? id;
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
  if (kind === null || kind === 'item') throw new Error(`"${id}" no es equipable`);
  const list = listFor(eq, kind);
  if (list.length >= limitFor(kind, limits)) return null;
  const inst: WeaponInstance = { uid: eq.nextUid++, id, durability: durability ?? catalog.maxDurability(id) };
  list.push(inst);
  if (eq[kind] === null) eq[kind] = inst.uid;
  return inst;
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

export interface SavedEquipment {
  weapons: { id: string; durability: number }[];
  bows: { id: string; durability: number }[];
  shields: { id: string; durability: number }[];
  melee: number;
  bow: number;
  shield: number;
  items: Record<string, number>;
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
  return eq;
}
