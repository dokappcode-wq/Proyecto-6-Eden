import { parse, v, type Infer } from '../data/schema';
import type { BindingStorage } from './input/InputManager';

const SAVE_VERSION = 4;
/** Versiones anteriores que se pueden migrar (les faltan campos opcionales). */
const COMPATIBLE_VERSIONS = [3, 4];

const gear = v.object({ id: v.string({ minLength: 1 }), durability: v.number({ min: 0, integer: true }) });

const saveSchema = v.object({
  version: v.number({ integer: true }),
  savedAt: v.number(),
  tutorial: v.array(v.string()),
  hour: v.number({ min: 0, max: 24 }),
  day: v.number({ min: 0, integer: true }),
  exitedCapsule: v.boolean(),
  gateOpen: v.boolean(),
  player: v.object({ x: v.number(), y: v.number(), z: v.number(), yaw: v.number() }),
  health: v.object({ fragments: v.number({ min: 0, integer: true }), maxFragments: v.number({ min: 1, integer: true }) }),
  progress: v.object({ towerActivated: v.boolean(), templeOpened: v.boolean(), templeCompleted: v.boolean(), hasGlider: v.boolean() }),
  equipment: v.object({
    weapons: v.array(gear),
    bows: v.array(gear),
    shields: v.array(gear),
    /** Índice equipado en cada lista (-1 = nada / puños). */
    melee: v.number({ integer: true }),
    bow: v.number({ integer: true }),
    shield: v.number({ integer: true }),
    items: v.record(v.number({ min: 0, integer: true })),
  }),
  /** Objetos del valle ya recogidos. */
  collected: v.array(v.string()),
  /** Mundo: cofres de campamento abiertos y jefes derrotados (v4). */
  world: v.optional(v.object({ chestsOpened: v.array(v.string()), bossesDefeated: v.array(v.string()) })),
});

export type SaveData = Infer<typeof saveSchema>;

/**
 * Ranuras de guardado sobre un almacenamiento tipo localStorage.
 * Una partida corrupta o de otra versión se ignora (nunca rompe el arranque).
 */
export class SaveStore {
  constructor(
    private readonly storage: BindingStorage | null,
    private readonly prefix = 'eden.save.',
  ) {}

  write(slot: string, data: Omit<SaveData, 'version' | 'savedAt'>, now = Date.now()): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.prefix + slot, JSON.stringify({ ...data, version: SAVE_VERSION, savedAt: now }));
      return true;
    } catch {
      return false;
    }
  }

  read(slot: string): SaveData | null {
    try {
      const raw = this.storage?.getItem(this.prefix + slot);
      if (!raw) return null;
      const data = parse(saveSchema, JSON.parse(raw), `partida "${slot}"`);
      if (!COMPATIBLE_VERSIONS.includes(data.version)) return null;
      return { ...data, world: data.world ?? { chestsOpened: [], bossesDefeated: [] } };
    } catch {
      return null;
    }
  }

  clear(slot: string): void {
    try {
      this.storage?.removeItem(this.prefix + slot);
    } catch {
      // Almacenamiento no disponible: nada que borrar.
    }
  }
}

export function browserStorage(): BindingStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
