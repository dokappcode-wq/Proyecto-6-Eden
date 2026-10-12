import { describe, expect, it } from 'vitest';
import { SaveStore } from '../src/core/save';
import { BUNDLED_DATA, loadGameData } from '../src/data';
import { DataValidationError } from '../src/data/schema';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

const sample = {
  tutorial: ['exit_capsule'],
  hour: 9.5,
  day: 0,
  exitedCapsule: true,
  gateOpen: false,
  player: { x: 1, y: 61, z: 2, yaw: 0.5 },
  health: { fragments: 10, maxFragments: 12 },
  progress: { towerActivated: true, templeOpened: true, templeCompleted: false, hasGlider: true },
  equipment: { weapons: [{ id: 'branch', durability: 5 }], bows: [], shields: [], melee: 0, bow: -1, shield: -1, items: { arrow: 7 } },
  collected: ['pk_branch'],
  world: { chestsOpened: ['camp_west'], bossesDefeated: [] },
};

describe('SaveStore', () => {
  it('guarda y recupera una partida', () => {
    const s = new SaveStore(memory());
    expect(s.write('a', sample)).toBe(true);
    expect(s.read('a')).toMatchObject(sample);
  });

  it('migra partidas v3 (sin datos de mundo)', () => {
    const mem = memory();
    const { world, ...v3 } = sample;
    void world;
    mem.setItem('eden.save.a', JSON.stringify({ ...v3, version: 3, savedAt: 1 }));
    expect(new SaveStore(mem).read('a')?.world).toEqual({ chestsOpened: [], bossesDefeated: [] });
  });

  it('ignora partidas corruptas sin lanzar', () => {
    const mem = memory();
    mem.setItem('eden.save.a', '{"version":3,"hour":"x"}');
    mem.setItem('eden.save.b', 'no-es-json');
    const s = new SaveStore(mem);
    expect(s.read('a')).toBeNull();
    expect(s.read('b')).toBeNull();
    expect(new SaveStore(null).read('a')).toBeNull();
  });
});

describe('validación cruzada de datos', () => {
  it('detecta marcadores de acción inexistentes en el tutorial', () => {
    const tutorial = structuredClone(BUNDLED_DATA.tutorial) as { steps: { hint: string }[] };
    tutorial.steps[0].hint = 'Pulsa {volar}';
    expect(() => loadGameData({ ...BUNDLED_DATA, tutorial })).toThrow(DataValidationError);
  });

  it('detecta LODs mal ordenados', () => {
    const terrain = structuredClone(BUNDLED_DATA.terrain) as { chunk: { lodDistances: number[] } };
    terrain.chunk.lodDistances = [500, 200, 800];
    expect(() => loadGameData({ ...BUNDLED_DATA, terrain })).toThrow(/creciente/);
  });
});

describe('equipo guardado', () => {
  it('serializa y restaura armas, equipadas y objetos', async () => {
    const { addGear, Catalog, createEquipment, equipped, restoreEquipment, serializeEquipment } = await import('../src/combat/inventory');
    const data = loadGameData();
    const cat = new Catalog(data.weapons, data.items);
    const eq = createEquipment();
    addGear(eq, cat, 'branch', data.player.combat.inventory);
    const sword = addGear(eq, cat, 'explorer_sword', data.player.combat.inventory)!;
    sword.durability = 9;
    eq.melee = sword.uid;
    eq.items.arrow = 12;
    const back = restoreEquipment(serializeEquipment(eq), cat);
    expect(equipped(back, 'melee')).toMatchObject({ id: 'explorer_sword', durability: 9 });
    expect(back.weapons).toHaveLength(2);
    expect(back.items.arrow).toBe(12);
  });
});
