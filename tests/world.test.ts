import { describe, expect, it } from 'vitest';
import { World } from '../src/core/ecs/World';
import { createTransform } from '../src/core/ecs/components';

describe('World (ECS)', () => {
  it('crea entidades con ids únicos y las cuenta', () => {
    const w = new World();
    const a = w.createEntity();
    const b = w.createEntity();
    expect(a).not.toBe(b);
    expect(w.entityCount).toBe(2);
  });

  it('query devuelve solo entidades con TODOS los componentes', () => {
    const w = new World();
    const a = w.createEntity();
    const b = w.createEntity();
    w.add(a, 'transform', createTransform());
    w.add(a, 'spin', { speed: 1 });
    w.add(b, 'transform', createTransform());
    expect(w.query('transform', 'spin')).toEqual([a]);
    expect(w.query('transform').sort()).toEqual([a, b].sort());
    expect(w.query('renderable')).toEqual([]);
  });

  it('destroyEntity elimina todos sus componentes', () => {
    const w = new World();
    const a = w.createEntity();
    w.add(a, 'spin', { speed: 2 });
    w.destroyEntity(a);
    expect(w.isAlive(a)).toBe(false);
    expect(w.get(a, 'spin')).toBeUndefined();
    expect(w.query('spin')).toEqual([]);
  });

  it('no permite añadir componentes a entidades inexistentes', () => {
    const w = new World();
    expect(() => w.add(99, 'spin', { speed: 1 })).toThrow(/no existe/);
  });

  it('require lanza si falta el componente', () => {
    const w = new World();
    const a = w.createEntity();
    expect(() => w.require(a, 'transform')).toThrow(/transform/);
  });
});
