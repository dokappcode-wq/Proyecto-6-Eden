import { parse, v, type Infer } from '../data/schema';
import type { BindingStorage } from './input/InputManager';

const SAVE_VERSION = 1;

const saveSchema = v.object({
  version: v.number({ integer: true }),
  savedAt: v.number(),
  tutorial: v.array(v.string()),
  hour: v.number({ min: 0, max: 24 }),
  day: v.number({ min: 0, integer: true }),
  exitedCapsule: v.boolean(),
  gateOpen: v.boolean(),
  player: v.object({ x: v.number(), y: v.number(), z: v.number(), yaw: v.number() }),
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
      return data.version === SAVE_VERSION ? data : null;
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
