import { describe, expect, it } from 'vitest';
import { FogOfWar, organicShape, seedOf } from '../src/world/map/FogOfWar';
import { DATA } from './helpers';

describe('Niebla de guerra', () => {
  it('empieza oculta y el jugador revela un círculo suave a su alrededor', () => {
    const f = new FogOfWar(256, 8192);
    expect(f.fraction).toBe(0);
    f.revealCircle(100, 100, 70);
    expect(f.at(100, 100)).toBe(1);
    expect(f.at(100, 300)).toBe(0);
    expect(f.fraction).toBeGreaterThan(0);
  });
  it('una torre revela una región orgánica (no un círculo perfecto) y se anima con el progreso', () => {
    const f = new FogOfWar(512, 8192);
    const seed = seedOf('tower_test');
    f.revealOrganic(0, 0, 900, seed, 0.5);
    const half = f.fraction;
    f.revealOrganic(0, 0, 900, seed, 1);
    expect(f.fraction).toBeGreaterThan(half * 3);
    // A la misma distancia, unos ángulos están revelados y otros no.
    let seen = 0;
    let hidden = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
      const v = f.at(Math.cos(a) * 880, Math.sin(a) * 880);
      if (v > 0.5) seen++;
      else hidden++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
    const shape = organicShape(seed);
    for (let a = 0; a < 6.3; a += 0.1) {
      expect(shape(a)).toBeGreaterThan(0.6);
      expect(shape(a)).toBeLessThan(1.2);
    }
  });
  it('se guarda comprimida y se restaura igual; un dato roto deja la niebla vacía', () => {
    const f = new FogOfWar(256, 8192);
    f.revealOrganic(-500, 300, 700, 7);
    f.revealCircle(1200, -800, 90);
    const data = f.serialize();
    expect(data.length).toBeLessThan(256 * 256);
    const g = new FogOfWar(256, 8192);
    expect(g.restore(data)).toBe(true);
    expect(Array.from(g.cells)).toEqual(Array.from(f.cells));
    expect(g.restore('AAAA')).toBe(false);
    expect(g.fraction).toBe(0);
  });
  it('la semilla de una torre es estable', () => {
    expect(seedOf('tower_plains')).toBe(seedOf('tower_plains'));
    expect(seedOf('tower_plains')).not.toBe(seedOf('tower_forest'));
  });
});

describe('Datos de torres y regiones', () => {
  it('8+ torres con al menos una por bioma terrestre y variaciones estéticas', () => {
    const t = DATA.towers.towers;
    expect(t.length).toBeGreaterThanOrEqual(8);
    const variants = new Set(t.map((x) => x.variant));
    for (const v of ['ruins', 'ice', 'volcanic', 'vegetal'] as const) expect(variants.has(v)).toBe(true);
    expect(t.filter((x) => x.builtin).length).toBe(1);
  });
  it('las regiones cubren las tres capas del mapa', () => {
    const layers = new Set(DATA.regions.regions.map((r) => r.layer));
    expect([...layers].sort()).toEqual(['sky', 'surface', 'underground']);
  });
});
