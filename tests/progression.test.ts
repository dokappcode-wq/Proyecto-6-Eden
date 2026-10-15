import { describe, expect, it } from 'vitest';
import { addArmor, addMeal, Catalog, createEquipment, restoreEquipment, serializeEquipment, toggleArmor } from '../src/combat/inventory';
import { cook, rawFood } from '../src/items/cooking';
import { armorStats, mitigate, pieceDefense, upgradeCost } from '../src/items/stats';
import { damage, createHealth, createStamina, spend } from '../src/player/movement/Stamina';
import { DATA } from './helpers';

const catalog = new Catalog(DATA.weapons, DATA.items, DATA.armor);
const item = (id: string) => catalog.item(id);
const R = DATA.recipes;

describe('Armaduras', () => {
  it('se ponen solas en hueco libre y suman defensa y efectos', () => {
    const eq = createEquipment();
    addArmor(eq, catalog, 'climber_head');
    addArmor(eq, catalog, 'climber_torso');
    const s = armorStats(eq, catalog);
    expect(s.stats.defense).toBe(4);
    expect(s.stats.climbSpeed).toBeCloseTo(0.24);
    // Bonificación de 2 piezas del set de escalador.
    expect(s.stats.ledgeCost).toBeCloseTo(0.4);
    expect(s.sets[0].active).toEqual([2]);
  });
  it('quitarse una pieza pierde la bonificación', () => {
    const eq = createEquipment();
    addArmor(eq, catalog, 'polar_head');
    const t = addArmor(eq, catalog, 'polar_torso');
    expect(armorStats(eq, catalog).stats.iceGrip).toBe(1);
    toggleArmor(eq, catalog, t.uid);
    expect(armorStats(eq, catalog).stats.iceGrip).toBe(0);
  });
  it('mejorar sube la defensa y cuesta materiales del set', () => {
    expect(pieceDefense(3, 0)).toBe(3);
    expect(pieceDefense(3, 4)).toBeGreaterThan(pieceDefense(3, 2));
    const set = DATA.armor.sets.find((x) => x.id === 'guardian');
    if (!set) throw new Error('set');
    expect(upgradeCost(set, 0)[0].item).toBe(set.upgradeItems[0]);
    expect(upgradeCost(set, 3).length).toBe(2);
  });
  it('la defensa amortigua el daño (mínimo 1)', () => {
    expect(mitigate(8, 0)).toBe(8);
    expect(mitigate(8, 24)).toBe(4);
    expect(mitigate(1, 200)).toBe(1);
  });
  it('se guarda y restaura con nivel y piezas puestas', () => {
    const eq = createEquipment();
    const a = addArmor(eq, catalog, 'hunter_head');
    a.level = 2;
    addMeal(eq, { recipe: 'baked_fruit', name: 'Fruta asada', heal: 4, effect: null, potency: 0, seconds: 0 });
    const back = restoreEquipment(serializeEquipment(eq), catalog);
    expect(back.armor[0].level).toBe(2);
    expect(back.worn.head).toBe(back.armor[0].uid);
    expect(back.meals[0].name).toBe('Fruta asada');
  });
});

describe('Cocina', () => {
  it('setas → brocheta; la curación es la suma ×2', () => {
    const r = cook(['vital_mushroom', 'vital_mushroom'], item, R);
    expect(r.recipe).toBe('mushroom_skewer');
    expect(r.heal).toBe(16);
  });
  it('un efecto común sale con nivel y duración; mezclar efectos los anula', () => {
    const hot = cook(['ember_pepper', 'ember_pepper', 'ember_pepper'], item, R);
    expect(hot.effect).toBe('cold');
    expect(hot.potency).toBeGreaterThanOrEqual(2);
    expect(hot.seconds).toBeGreaterThan(300);
    expect(cook(['ember_pepper', 'frost_melon'], item, R).effect).toBeNull();
  });
  it('elixir: bicho + parte de monstruo; solo partes de monstruo = dudoso', () => {
    expect(cook(['sleepy_beetle', 'slime_jelly'], item, R).recipe).toBe('elixir');
    expect(cook(['slime_jelly'], item, R).dubious).toBe(true);
    expect(cook(['sleepy_beetle'], item, R).dubious).toBe(true);
  });
  it('trufa dorada da corazones extra; comer crudo cura menos', () => {
    expect(cook(['golden_truffle'], item, R).effect).toBe('hearty');
    const apple = item('apple');
    if (!apple) throw new Error('apple');
    expect(rawFood(apple, R)?.heal).toBe(2);
    expect(cook(['apple'], item, R).heal).toBe(4);
  });
});

describe('Corazones extra y vigor extra', () => {
  it('los corazones amarillos se pierden primero', () => {
    const h = createHealth(3, 4);
    h.extra = 4;
    damage(h, 6);
    expect(h.extra).toBe(0);
    expect(h.fragments).toBe(10);
  });
  it('el vigor extra se gasta antes que el normal', () => {
    const cfg = DATA.player.stamina;
    const s = createStamina(100);
    s.bonus = 20;
    expect(spend(s, 30, 'test', cfg)).toBe(true);
    expect(s.bonus).toBe(0);
    expect(s.current).toBe(90);
  });
});
