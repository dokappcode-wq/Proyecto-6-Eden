import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math';
import { biomeAt } from '../src/world/biomes';
import { FireField } from '../src/world/elements/FireField';
import { IceField } from '../src/world/elements/IceField';
import { ambientTemperature, thermalBand, WeatherModel } from '../src/world/weather/Weather';
import { DATA } from './helpers';

const EL = DATA.elements;
const flat = () => 0;

function burnFor(field: FireField, seconds: number, wx: number, wz: number, rain = 0): void {
  const rng = createRng(3);
  for (let t = 0; t < seconds; t += 0.1) field.step(0.1, wx, wz, rain, rng);
}

describe('Fuego', () => {
  it('prende la hierba y se propaga más a favor del viento', () => {
    const f = new FireField(EL.fire, () => true, flat);
    expect(f.ignite(0, 0)).toBe(true);
    burnFor(f, 3, 6, 0);
    let east = 0;
    let west = 0;
    for (const c of f.cells.values()) {
      if (c.x > 0) east++;
      if (c.x < 0) west++;
    }
    expect(east).toBeGreaterThan(west * 1.5);
  });
  it('no prende sin combustible ni bajo la lluvia, y la lluvia lo apaga', () => {
    const none = new FireField(EL.fire, () => false, flat);
    expect(none.ignite(0, 0)).toBe(false);
    const f = new FireField(EL.fire, () => true, flat);
    expect(f.ignite(0, 0, 1)).toBe(false);
    f.ignite(0, 0);
    burnFor(f, 1, 0, 0, 1);
    expect(f.burning).toBe(0);
  });
  it('se consume y deja ceniza que rebrota', () => {
    const f = new FireField({ ...EL.fire, spreadChance: 0 }, () => true, flat);
    f.ignite(0, 0);
    burnFor(f, EL.fire.burnSeconds + 0.5, 0, 0);
    expect(f.burning).toBe(0);
    expect(f.cells.size).toBe(1);
    burnFor(f, EL.fire.regrowSeconds + 1, 0, 0);
    expect(f.cells.size).toBe(0);
  });
  it('genera una corriente térmica sobre las llamas', () => {
    const f = new FireField({ ...EL.fire, spreadChance: 0 }, () => true, flat);
    f.igniteArea(0, 0, 4);
    expect(f.liftAt(0, 10, 0)).toBeGreaterThan(2);
    expect(f.liftAt(0, EL.fire.thermalHeight + 5, 0)).toBe(0);
    expect(f.liftAt(40, 10, 0)).toBe(0);
  });
});

describe('Hielo', () => {
  it('congela el agua en una plataforma que se derrite (antes cerca del fuego)', () => {
    const ice = new IceField(EL.ice);
    const p = ice.freeze(0, 0, 10);
    expect(ice.freeze(0.2, 0.1, 10)).toBe(p);
    ice.step(EL.ice.meltSeconds * 0.5, () => 0);
    expect(ice.platforms.length).toBe(1);
    ice.step(EL.ice.meltSeconds * 0.1, () => 1);
    expect(ice.platforms.length).toBe(0);
  });
});

describe('Clima y temperatura', () => {
  it('el tiempo cambia según los pesos del bioma y es determinista', () => {
    const run = () => {
      const m = new WeatherModel(DATA.biomes.biomes, EL.weather, createRng(9));
      const seen = new Set<string>();
      for (let t = 0; t < 3600; t += 1) {
        m.step(1);
        seen.add(m.at('desert').type);
      }
      return [...seen].sort().join(',');
    };
    const a = run();
    expect(a).toBe(run());
    // En el desierto nunca nieva.
    expect(a).not.toContain('snow');
    expect(a.split(',').length).toBeGreaterThan(1);
  });
  it('las tormentas refuerzan el viento y mojan', () => {
    const m = new WeatherModel(DATA.biomes.biomes, EL.weather, createRng(1));
    const calm = m.wind('plains').strength;
    m.force('plains', 'storm');
    expect(m.wind('plains').strength).toBeGreaterThan(calm * 2);
    expect(m.rain('plains')).toBe(1);
  });
  it('desierto: calor de día y frío de noche; la altitud enfría', () => {
    const T = EL.temperature;
    const desert = DATA.biomes.biomes.find((b) => b.id === 'desert');
    const plains = DATA.biomes.biomes.find((b) => b.id === 'plains');
    if (!desert || !plains) throw new Error('biomas');
    expect(thermalBand(ambientTemperature(desert, 1, 30, 'clear', 0, T), 0, 0, T)).toMatch(/hot|scorching/);
    expect(thermalBand(ambientTemperature(desert, 0, 30, 'clear', 0, T), 0, 0, T)).toBe('cold');
    expect(ambientTemperature(plains, 1, 800, 'clear', 0, T)).toBeLessThan(ambientTemperature(plains, 1, 30, 'clear', 0, T) - 10);
    // El equipo amplía el rango cómodo.
    expect(thermalBand(ambientTemperature(desert, 0, 30, 'clear', 0, T), 10, 0, T)).toBe('ok');
  });
  it('biomas del continente', () => {
    const c = DATA.terrain;
    expect(biomeAt(c, 0, 60, 0, 60)).toBe('plains');
    expect(biomeAt(c, 3000, 30, 0, 30)).toBe('desert');
    expect(biomeAt(c, -3000, 50, 0, 50)).toBe('forest');
    expect(biomeAt(c, 0, 400, -3000, 400)).toBe('mountains');
    expect(biomeAt(c, 0, -20, 5000, -25)).toBe('sea');
    expect(biomeAt(c, 0, 500, 0, 60)).toBe('sky');
  });
});
