import { describe, expect, it } from 'vitest';
import { StaticColliders } from '../src/world/physics/StaticColliders';

describe('StaticColliders', () => {
  it('empuja fuera de una caja rotada', () => {
    const c = new StaticColliders();
    c.addBox(0, 1, 0, 2, 1, 1, Math.PI / 4);
    const p = { x: 0.3, y: 0, z: 0.3 };
    const r = c.pushOut(p, 0.35, 1.75, 0.4);
    expect(r.hit).toBe(true);
    // Ya no solapa: un segundo empuje no hace nada.
    expect(c.pushOut(p, 0.35, 1.75, 0.4).hit).toBe(false);
  });

  it('ignora colisionadores que se suben como escalón o están por encima', () => {
    const c = new StaticColliders();
    c.addBox(0, 0.15, 0, 1, 0.15, 1);
    c.addCylinder(5, 0, 1, 3, 5);
    expect(c.pushOut({ x: 0.5, y: 0, z: 0 }, 0.35, 1.75, 0.4).hit).toBe(false);
    expect(c.pushOut({ x: 5, y: 0, z: 0 }, 0.35, 1.75, 0.4).hit).toBe(false);
  });

  it('topAt devuelve la superficie superior alcanzable', () => {
    const c = new StaticColliders();
    c.addBox(0, 0.5, 0, 1, 0.5, 1);
    expect(c.topAt(0, 0, 0.2, 1.2)).toBe(1);
    expect(c.topAt(0, 0, 0.2, 0.5)).toBe(-Infinity);
    expect(c.topAt(5, 5, 0.2, 10)).toBe(-Infinity);
  });

  it('raycast contra caja y cilindro', () => {
    const c = new StaticColliders();
    c.addBox(10, 0, 0, 1, 1, 1);
    c.addCylinder(0, 10, 1, -1, 1);
    expect(c.raycast(0, 0, 0, 1, 0, 0, 50)).toBeCloseTo(9);
    expect(c.raycast(0, 0, 0, 0, 0, 1, 50)).toBeCloseTo(9);
    expect(c.raycast(0, 5, 0, 1, 0, 0, 50)).toBe(Infinity);
  });

  it('remove/add retira y restaura un colisionador', () => {
    const c = new StaticColliders();
    const b = c.addBox(0, 1, 0, 1, 1, 1);
    c.remove(b);
    expect(c.count).toBe(0);
    expect(c.pushOut({ x: 0, y: 0, z: 0 }, 0.3, 1.7, 0.4).hit).toBe(false);
    c.add(b);
    expect(c.pushOut({ x: 0, y: 0, z: 0 }, 0.3, 1.7, 0.4).hit).toBe(true);
  });
});

describe('raycast desde dentro', () => {
  it('ignora el colisionador que contiene el origen', () => {
    const c = new StaticColliders();
    c.addBox(0, 0, 0, 2, 2, 2);
    c.addCylinder(20, 0, 2, -2, 2);
    expect(c.raycast(0, 0, 0, 1, 0, 0, 50)).toBeCloseTo(18);
    expect(c.raycast(20, 0, 0, -1, 0, 0, 50)).toBeCloseTo(18);
  });
});
