import { describe, expect, it } from 'vitest';
import { arrowsForShot, compensateDrop } from '../src/combat/bow';
import { computeDamage, inArc, type HitModifiers } from '../src/combat/damage';
import { createDefense, resolveIncoming } from '../src/combat/defense';
import { addGear, addItem, Catalog, createEquipment, equip, equipped, takeItem, wear } from '../src/combat/inventory';
import { comboDuration, createMelee, HOLD_TO_CHARGE, stepMelee, type MeleeStepResult } from '../src/combat/melee';
import { reflectProjectile, segmentSphere, stepProjectile, type Projectile } from '../src/combat/projectiles';
import { DATA } from './helpers';

const cfg = DATA.player.combat;
const catalog = new Catalog(DATA.weapons, DATA.items);
const W = (id: string) => catalog.weapon(id);
const DT = 1 / 60;
const base: HitModifiers = { kind: 'light', multiplier: 1, sneak: false, weakPoint: false, weakPointBonus: 2, breaking: false, targetTags: [] };

describe('Daño', () => {
  it('sigilo ×3 y dagas ×4', () => {
    expect(computeDamage(W('explorer_sword'), { ...base, sneak: true }, cfg)).toBe(W('explorer_sword').damage * 3);
    expect(computeDamage(W('twin_daggers'), { ...base, sneak: true }, cfg)).toBe(W('twin_daggers').damage * 4);
  });
  it('martillo ×2 contra roca, hacha ×2 contra madera/escudos', () => {
    const h = W('boulder_hammer');
    expect(computeDamage(h, { ...base, targetTags: ['rock'] }, cfg)).toBe(computeDamage(h, base, cfg) * 2);
    const a = W('woodcutter_axe');
    expect(computeDamage(a, { ...base, targetTags: ['shield'] }, cfg)).toBe(computeDamage(a, base, cfg) * 2);
  });
  it('explosión al romperse, picado y lanzamiento', () => {
    const s = W('explorer_sword');
    expect(computeDamage(s, { ...base, breaking: true }, cfg)).toBe(s.damage * cfg.breakDamageMultiplier);
    expect(computeDamage(s, { ...base, kind: 'plunge' }, cfg)).toBe(s.damage * cfg.plunge.damageMultiplier);
    expect(computeDamage(s, { ...base, kind: 'thrown' }, cfg)).toBe(Math.round(s.damage * cfg.throwMultiplier));
  });
  it('arco de golpe', () => {
    expect(inArc(0, 0, 0, 0, 1.5, 0.5, 1.5, 90)).toBe(true); // delante
    expect(inArc(0, 0, 0, 0, -1.5, 0.5, 1.5, 90)).toBe(false); // detrás
    expect(inArc(0, 0, 0, 0, -1.5, 0.5, 1.5, 360)).toBe(true);
    expect(inArc(0, 0, 0, 0, 5, 0.5, 1.5, 90)).toBe(false); // lejos
  });
});

describe('Armas distintas entre sí', () => {
  it('cada categoría tiene un ritmo, alcance o especial claramente distinto', () => {
    const all = DATA.weapons.weapons.filter((w) => w.category !== 'bow' && w.category !== 'fists');
    // Un representante por categoría (las variantes, p. ej. goblin, comparten categoría).
    const melee = [...new Map(all.map((w) => [w.category, w])).values()];
    expect(melee.length).toBeGreaterThanOrEqual(7);
    const sig = (w: (typeof melee)[number]) => `${comboDuration(w).toFixed(2)}|${w.reach}|${w.arc}|${w.heavy.special}`;
    expect(new Set(melee.map(sig)).size).toBe(melee.length);
    expect(comboDuration(W('twin_daggers'))).toBeLessThan(comboDuration(W('explorer_sword')));
    expect(comboDuration(W('explorer_sword'))).toBeLessThan(comboDuration(W('boulder_hammer')));
    expect(W('stone_spear').reach).toBeGreaterThan(W('explorer_sword').reach);
  });
});

describe('Combo y carga', () => {
  function run(w: string, presses: number[], holdUntil = -1, steps = 120) {
    const s = createMelee();
    const res: MeleeStepResult[] = [];
    for (let i = 0; i < steps; i++) {
      res.push(stepMelee(s, { pressed: presses.includes(i), held: i <= holdUntil, airborne: false, flurry: false, staminaOk: true }, W(w), cfg.attackMoveMultiplier, DT));
    }
    return { s, res };
  }
  it('tres pulsaciones encadenan el combo de 3 golpes', () => {
    const { res } = run('explorer_sword', [0, 10, 20]);
    const swings = new Set(res.filter((r) => r.window).map((r) => r.window!.swingId));
    expect(swings.size).toBe(3);
  });
  it('una sola pulsación da un solo golpe', () => {
    const { res, s } = run('explorer_sword', [0]);
    expect(new Set(res.filter((r) => r.window).map((r) => r.window!.swingId)).size).toBe(1);
    expect(s.phase).toBe('idle');
  });
  it('mantener carga y al soltar lanza el especial (giro 360° del mandoble)', () => {
    const w = W('ancestral_greatsword');
    const holdSteps = Math.ceil((HOLD_TO_CHARGE + w.heavy.chargeTime) / DT) + 5;
    const { res } = run('ancestral_greatsword', [0], holdSteps, holdSteps + 120);
    expect(res.some((r) => r.started === 'heavy')).toBe(true);
    const heavy = res.filter((r) => r.window && r.window.kind === 'heavy');
    expect(heavy.every((r) => r.window!.arc === 360)).toBe(true);
    expect(new Set(heavy.map((r) => r.window!.swingId)).size).toBeGreaterThanOrEqual(3); // varios subgolpes
  });
  it('la lanza embiste en línea recta durante su ataque cargado', () => {
    const w = W('stone_spear');
    const holdSteps = Math.ceil((HOLD_TO_CHARGE + w.heavy.chargeTime) / DT) + 5;
    const { res } = run('stone_spear', [0], holdSteps, holdSteps + 80);
    expect(Math.max(...res.map((r) => r.lunge))).toBeGreaterThan(5);
  });
  it('soltar antes de cargar del todo no lanza el especial', () => {
    const { res } = run('ancestral_greatsword', [0], 20, 120);
    expect(res.some((r) => r.started === 'heavy')).toBe(false);
  });
});

describe('Esquiva perfecta y parry', () => {
  const player = { x: 0, z: 0, yaw: 0 };
  const front = { x: 0, z: 2 };
  it('esquiva normal, perfecta y golpe', () => {
    const d = createDefense();
    expect(resolveIncoming(d, front, player, null, cfg)).toBe('hit');
    d.dodgeT = 0.05;
    expect(resolveIncoming(d, front, player, null, cfg)).toBe('perfect');
    d.dodgeT = cfg.dodge.perfectWindow + 0.03;
    expect(resolveIncoming(d, front, player, null, cfg)).toBe('dodged');
  });
  it('bloqueo, parry en ventana de 150 ms y sin cobertura por detrás', () => {
    const sh = catalog.shield('wood_shield');
    const d = createDefense();
    d.guarding = true;
    d.guardT = 0.1;
    expect(resolveIncoming(d, front, player, sh, cfg)).toBe('parried');
    d.guardT = 0.5;
    expect(resolveIncoming(d, front, player, sh, cfg)).toBe('blocked');
    expect(resolveIncoming(d, { x: 0, z: -2 }, player, sh, cfg)).toBe('hit');
  });
});

describe('Inventario y durabilidad', () => {
  it('equipa al recoger, avisa al 25 % y se rompe', () => {
    const eq = createEquipment();
    const sword = addGear(eq, catalog, 'explorer_sword', cfg.inventory)!;
    expect(equipped(eq, 'melee')?.uid).toBe(sword.uid);
    const max = W('explorer_sword').durability;
    let warned = false;
    let broken = false;
    for (let i = 0; i < max; i++) {
      const r = wear(eq, catalog, sword.uid, 1, cfg.durabilityWarning);
      warned ||= r === 'warning';
      broken ||= r === 'broken';
    }
    expect(warned).toBe(true);
    expect(broken).toBe(true);
    expect(equipped(eq, 'melee')).toBeNull();
  });
  it('respeta el límite y las pilas de objetos', () => {
    const eq = createEquipment();
    for (let i = 0; i < cfg.inventory.weapons; i++) expect(addGear(eq, catalog, 'branch', cfg.inventory)).not.toBeNull();
    expect(addGear(eq, catalog, 'branch', cfg.inventory)).toBeNull();
    expect(addItem(eq, 'arrow', 120, 99)).toBe(99);
    expect(takeItem(eq, 'arrow', 100)).toBe(false);
    expect(takeItem(eq, 'arrow', 3)).toBe(true);
    equip(eq, 'melee', null);
    expect(equipped(eq, 'melee')).toBeNull();
  });
  it('los puños no se rompen', () => {
    expect(W('fists').durability).toBe(0);
  });
});

describe('Arco y proyectiles', () => {
  it('la carga completa del arco corto dispara 3 flechas más rápidas', () => {
    const b = W('short_bow');
    const weak = arrowsForShot(b, 0.05, { dx: 0, dy: 0, dz: 1 });
    const full = arrowsForShot(b, 2, { dx: 0, dy: 0, dz: 1 });
    expect(weak).toHaveLength(1);
    expect(full).toHaveLength(3);
    expect(full[0].speed).toBeGreaterThan(weak[0].speed);
  });
  it('vuela con gravedad, golpea objetivos y se clava en el escenario', () => {
    const p: Projectile = { id: 1, kind: 'arrow', owner: 'player', x: 0, y: 2, z: 0, vx: 0, vy: 2.45, vz: 40, gravity: 9.8, damage: 6, age: 0, maxAge: 10, stuck: false, alive: true, reflected: false };
    const world = {
      raycastScene: () => Infinity,
      hitTarget: (_p: Projectile, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        const t = segmentSphere(ax, ay, az, bx, by, bz, 0, 2, 20, 0.6);
        return t === null ? null : { id: 7, tHit: t };
      },
    };
    let ev = null;
    for (let i = 0; i < 120 && !ev; i++) ev = stepProjectile(p, world, DT);
    expect(ev).toMatchObject({ type: 'target', id: 7 });

    const q: Projectile = { ...p, id: 2, x: 0, y: 2, z: 0, vz: 40, alive: true, age: 0 };
    const wall = { raycastScene: (_ox: number, _oy: number, oz: number, _dx: number, _dy: number, _dz: number, max: number) => (oz + max >= 10 ? 10 - oz : Infinity), hitTarget: () => null };
    let e2 = null;
    for (let i = 0; i < 120 && !e2; i++) e2 = stepProjectile(q, wall, DT);
    expect(e2?.type).toBe('scene');
    expect(q.stuck).toBe(true);
  });
  it('un parry refleja el proyectil hacia su origen', () => {
    const p: Projectile = { id: 3, kind: 'arrow', owner: 'enemy', x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: -20, gravity: 0, damage: 4, age: 0, maxAge: 5, stuck: false, alive: true, reflected: false };
    reflectProjectile(p, { x: 0, y: 1, z: 10 });
    expect(p.vz).toBeGreaterThan(20);
    expect(p.owner).toBe('player');
  });
});

describe('Compensación de caída de la flecha', () => {
  it('la flecha llega al punto apuntado dentro del alcance asistido', () => {
    const speed = 30;
    const g = 9.8;
    const aim = compensateDrop({ dx: 0, dy: 0, dz: 1 }, 20, speed, g, 45);
    expect(aim.dy).toBeGreaterThan(0);
    // Simula la parábola hasta z = 20.
    const t = 20 / (aim.dz * speed);
    const y = aim.dy * speed * t - 0.5 * g * t * t;
    expect(Math.abs(y)).toBeLessThan(0.1);
  });
  it('más allá del alcance no corrige', () => {
    expect(compensateDrop({ dx: 0, dy: 0, dz: 1 }, 80, 30, 9.8, 45)).toEqual({ dx: 0, dy: 0, dz: 1 });
  });
});
