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
};

describe('SaveStore', () => {
  it('guarda y recupera una partida', () => {
    const s = new SaveStore(memory());
    expect(s.write('a', sample)).toBe(true);
    expect(s.read('a')).toMatchObject(sample);
  });

  it('ignora partidas corruptas sin lanzar', () => {
    const mem = memory();
    mem.setItem('eden.save.a', '{"version":2,"hour":"x"}');
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
