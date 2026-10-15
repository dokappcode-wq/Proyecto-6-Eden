import { describe, expect, it } from 'vitest';
import { attackReaches, shockwaveRadius } from '../src/ai/attacks';
import { applyHit, ballistic, chooseAttack, createBrain, leadTarget, startAttack, updateAwareness, type Brain } from '../src/ai/brain';
import { dayPhase, routineFor } from '../src/ai/camp';
import type { AIContext, AIEvent, GroupView, PlayerView } from '../src/ai/context';
import { stepGoblin } from '../src/ai/goblin';
import { crystalPosition, crystalStagger, stepGolem } from '../src/ai/golem';
import { stepHawk } from '../src/ai/hawk';
import type { Body, NavEnv } from '../src/ai/locomotion';
import { canStep, walkToward } from '../src/ai/locomotion';
import { sense, sightRange, type PerceptionEnv, type Stimulus } from '../src/ai/perception';
import { stepSlime } from '../src/ai/slime';
import { createRng } from '../src/core/math';
import type { EnemyDef } from '../src/data/schemas';
import { DATA } from './helpers';

const DT = 1 / 60;
const E = (id: string): EnemyDef => {
  const d = DATA.enemies.enemies.find((e) => e.id === id);
  if (!d) throw new Error(id);
  return d;
};
const DAY: PerceptionEnv = { light: 1, rain: 0, airVisibility: DATA.player.combat.airVisibility };
const NIGHT: PerceptionEnv = { ...DAY, light: 0 };
const flatNav: NavEnv = { groundAt: () => 0, waterDepth: () => 0, blocked: () => false, pushOut: () => undefined };

function stim(x: number, z: number, o: Partial<Stimulus> = {}): Stimulus {
  return { x, y: 0, z, alive: true, crouching: false, airborne: false, speed: 0, noise: 0, ...o };
}
function view(x: number, z: number, o: Partial<PlayerView> = {}): PlayerView {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, groundY: 0, airborne: false, gliding: false, alive: true, inWater: false, ...o };
}
function body(def: EnemyDef): Body {
  return { radius: def.radius, height: def.height, maxStep: 0.6, maxWater: 0.5, turnSpeed: def.turnSpeed };
}

/** Simula N pasos de percepción + comportamiento como el EnemySystem. */
function run(b: Brain, def: EnemyDef, p: PlayerView, steps: number, o: { nav?: NavEnv; group?: GroupView | null; env?: PerceptionEnv; stimulus?: Partial<Stimulus>; onEvents?: (ev: AIEvent[]) => void } = {}): void {
  const rng = createRng(7);
  for (let i = 0; i < steps; i++) {
    const r = sense({ x: b.x, y: b.y, z: b.z, yaw: b.yaw, eye: def.height * 0.85, asleep: b.state === 'sleep' }, def.senses, stim(p.x, p.z, { airborne: p.airborne, ...o.stimulus }), o.env ?? DAY, () => true);
    updateAwareness(b, def, r, p.x, p.y, p.z, DT);
    const events: AIEvent[] = [];
    const c: AIContext = { dt: DT, def, player: p, dist: Math.hypot(p.x - b.x, p.z - b.z), nav: o.nav ?? flatNav, body: body(def), rng, group: o.group ?? null, events, hazard: null };
    if (b.kind === 'slime') stepSlime(b, c);
    else if (b.kind === 'goblin') stepGoblin(b, c);
    else if (b.kind === 'golem') stepGolem(b, c);
    else stepHawk(b, c, 0);
    o.onEvents?.(events);
  }
}

describe('Percepción', () => {
  const def = E('goblin_melee');
  const obs = { x: 0, y: 0, z: 0, yaw: 0, eye: 1.2, asleep: false };
  it('ve dentro del cono y no a la espalda', () => {
    expect(sense(obs, def.senses, stim(0, 10), DAY, () => true).sight).toBeGreaterThan(0);
    expect(sense(obs, def.senses, stim(0, -10), DAY, () => true).sight).toBe(0);
  });
  it('la oclusión bloquea la vista', () => {
    expect(sense(obs, def.senses, stim(0, 10), DAY, () => false).sight).toBe(0);
  });
  it('de noche y agachado se ve menos; en el aire, más (y la noche no ayuda)', () => {
    const s = def.senses;
    expect(sightRange(s, stim(0, 0), NIGHT)).toBeLessThan(sightRange(s, stim(0, 0), DAY));
    expect(sightRange(s, stim(0, 0, { crouching: true }), DAY)).toBeLessThan(sightRange(s, stim(0, 0), DAY));
    const air = stim(0, 0, { airborne: true });
    expect(sightRange(s, air, NIGHT)).toBeGreaterThan(sightRange(s, stim(0, 0), DAY));
  });
  it('el ruido se oye por radio (también a la espalda)', () => {
    expect(sense(obs, def.senses, stim(0, -5, { noise: 10 }), DAY, () => true).hearing).toBeGreaterThan(0);
    expect(sense(obs, def.senses, stim(0, -5, { noise: 1 }), DAY, () => true).hearing).toBe(0);
  });
  it('dormido no ve y oye peor', () => {
    const sleep = { ...obs, asleep: true };
    expect(sense(sleep, def.senses, stim(0, 10), DAY, () => true).sight).toBe(0);
    expect(sense(sleep, def.senses, stim(0, 3, { noise: 4 }), DAY, () => true).hearing).toBeLessThan(sense(obs, def.senses, stim(0, 3, { noise: 4 }), DAY, () => true).hearing);
  });
});

describe('Estados de IA', () => {
  const def = E('goblin_melee');
  it('tranquilo → alerta (?) → combate (!) viendo al jugador', () => {
    const b = createBrain(def, 0, 0, 0, 0, 0.2);
    const r = sense({ x: 0, y: 0, z: 0, yaw: 0, eye: 1.2, asleep: false }, def.senses, stim(0, 15), DAY, () => true);
    const seen: string[] = [];
    for (let i = 0; i < 600 && b.state !== 'combat'; i++) {
      updateAwareness(b, def, r, 0, 0, 15, DT);
      if (!seen.includes(b.state)) seen.push(b.state);
    }
    expect(seen).toEqual(['idle', 'suspicious', 'combat']);
    expect(b.aware).toBe(true);
  });
  it('solo con el oído investiga pero no entra en combate', () => {
    const b = createBrain(def, 0, 0, 0, 0, 0.2);
    for (let i = 0; i < 600; i++) updateAwareness(b, def, { sight: 0, hearing: 2, sees: false }, 0, 0, -3, DT);
    expect(b.state).toBe('suspicious');
    expect(b.lastZ).toBe(-3);
  });
  it('combate → búsqueda al perderlo de vista → reagrupar', () => {
    const b = createBrain(def, 0, 0, 0, 0, 0.2);
    applyHit(b, def, 0, { fromX: 0, fromZ: 3, knockback: 0, stagger: false, stun: 0 });
    expect(b.state).toBe('combat');
    const none = { sight: 0, hearing: 0, sees: false };
    for (let i = 0; i < (def.senses.forget + 0.2) / DT; i++) updateAwareness(b, def, none, 0, 0, 0, DT);
    expect(b.state).toBe('search');
    for (let i = 0; i < (def.senses.search + 0.2) / DT; i++) updateAwareness(b, def, none, 0, 0, 0, DT);
    expect(b.state).toBe('regroup');
  });
  it('dormido se despierta con ruido cercano', () => {
    const b = createBrain(def, 0, 0, 0, 0, 0.2);
    b.activity = 'sleep';
    b.state = 'sleep';
    for (let i = 0; i < 300 && b.state === 'sleep'; i++) {
      const r = sense({ x: 0, y: 0, z: 0, yaw: 0, eye: 1.2, asleep: true }, def.senses, stim(0, 2, { noise: DATA.player.combat.noise.sprint }), DAY, () => true);
      updateAwareness(b, def, r, 0, 0, 2, DT);
    }
    expect(b.state).not.toBe('sleep');
  });
  it('un golpe por encima del aplomo interrumpe el ataque', () => {
    const b = createBrain(def, 0, 0, 0, 0, 0.2);
    startAttack(b, def.attacks[0], 0, 0, 2);
    applyHit(b, def, def.poise + 1, { fromX: 0, fromZ: 2, knockback: 3, stagger: false, stun: 0 });
    expect(b.attack).toBeNull();
    expect(b.stunT).toBeGreaterThan(0);
  });
});

describe('Ataques', () => {
  it('elige solo ataques a distancia contra un jugador inalcanzable', () => {
    const def = E('goblin_melee');
    const b = createBrain(def, 0, 0, 0, 0, 0.3);
    const a = chooseAttack(b, def, { dist: 8, targetAir: false, unreachable: true, rng: createRng(1) });
    expect(a?.kind).toBe('projectile');
    expect(chooseAttack(b, def, { dist: 8, targetAir: false, unreachable: false, rng: createRng(1) })?.kind).not.toBe('projectile');
  });
  it('los arqueros priorizan al jugador planeando', () => {
    const def = E('goblin_archer');
    const b = createBrain(def, 0, 0, 0, 0, 0.3);
    let air = 0;
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) if (chooseAttack(b, def, { dist: 15, targetAir: true, unreachable: false, rng })?.id === 'shoot_air') air++;
    expect(air).toBeGreaterThan(30);
  });
  it('golpe en arco, área y onda expansiva (se esquiva saltando)', () => {
    const g = E('golem_large');
    const b = createBrain(g, 0, 0, 0, 0, 0.3);
    const sweep = g.attacks.find((a) => a.id === 'sweep');
    if (!sweep) throw new Error('sweep');
    const at = startAttack(b, sweep, 0, 0, 3);
    at.phase = 'active';
    const target = { x: 0, y: 0, z: 3, groundY: 0, radius: 0.35, height: 1.7 };
    expect(attackReaches(b, g, target)).toBe(true);
    expect(attackReaches(b, g, { ...target, z: -3 })).toBe(false);
    const stomp = g.attacks.find((a) => a.kind === 'shockwave');
    if (!stomp) throw new Error('stomp');
    const w = startAttack(b, stomp, 0, 0, 5);
    w.phase = 'active';
    w.t = 5 / stomp.speed;
    expect(shockwaveRadius(b)).toBeCloseTo(5, 3);
    expect(attackReaches(b, g, { ...target, z: 5 })).toBe(true);
    expect(attackReaches(b, g, { ...target, z: 5, y: 1.2 })).toBe(false);
  });
  it('adelanta el tiro a un objetivo en movimiento y lanza en parábola', () => {
    const l = leadTarget(0, 0, 0, 0, 0, 20, 10, 0, 0, 40);
    expect(l.x).toBeGreaterThan(4);
    const v = ballistic(0, 0, 0, 10, 0, 0, 1, 10);
    expect(v.vy).toBeCloseTo(5, 5);
  });
});

describe('Familias', () => {
  it('slime: detecta, se encoge (aviso) y embiste', () => {
    const def = E('slime_green');
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    const kinds: string[] = [];
    run(b, def, view(0, 5), 60 * 6, { onEvents: (ev) => ev.forEach((e) => e.type === 'attack_active' && kinds.push(e.attack.def.kind)) });
    expect(kinds).toContain('lunge');
  });
  it('slime tóxico escupe a distancia; eléctrico se carga periódicamente', () => {
    const tox = E('slime_toxic');
    const b = createBrain(tox, 0, 0, 0, 0, 0.1);
    const kinds: string[] = [];
    run(b, tox, view(0, 6), 60 * 8, { onEvents: (ev) => ev.forEach((e) => e.type === 'attack_active' && kinds.push(e.attack.def.id)) });
    expect(kinds).toContain('spit');
    const el = E('slime_electric');
    const s = createBrain(el, 0, 0, 0, 0, 0.1);
    let charged = 0;
    run(s, el, view(0, 60), 60 * 10, { onEvents: () => (charged += s.charged ? 1 : 0) });
    expect(charged).toBeGreaterThan(0);
  });
  it('goblin: rodea si no tiene turno y ataca si lo tiene', () => {
    const def = E('goblin_melee');
    const noToken: GroupView = { alarm: true, hornCaller: false, hornX: 0, hornZ: 0, canTakeToken: false, regroupX: 0, regroupZ: 0 };
    const a = createBrain(def, 0, 0, 0, 0, 0.1);
    let attacked = false;
    run(a, def, view(0, 4), 120, { group: noToken, onEvents: (ev) => (attacked ||= ev.some((e) => e.type === 'attack_start' && e.attack.def.kind !== 'projectile')) });
    expect(attacked).toBe(false);
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    run(b, def, view(0, 4), 240, { group: { ...noToken, canTakeToken: true }, onEvents: (ev) => (attacked ||= ev.some((e) => e.type === 'attack_start')) });
    expect(attacked).toBe(true);
  });
  it('goblin: el elegido corre al cuerno y lo toca', () => {
    const def = E('goblin_melee');
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    let horn = false;
    run(b, def, view(0, 12), 60 * 8, { group: { alarm: true, hornCaller: true, hornX: 6, hornZ: 0, canTakeToken: true, regroupX: 0, regroupZ: 0 }, onEvents: (ev) => (horn ||= ev.some((e) => e.type === 'horn')) });
    expect(horn).toBe(true);
  });
  it('golem dormido se despierta al acercarse y el cristal lo pone de rodillas', () => {
    const def = E('golem_small');
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    expect(b.state).toBe('sleep');
    let woke = false;
    run(b, def, view(0, 1.2), 60 * 4, { onEvents: (ev) => (woke ||= ev.some((e) => e.type === 'woke')) });
    expect(woke).toBe(true);
    crystalStagger(b, 3);
    expect(b.kneel).toBe(true);
    const g = def.golem;
    if (!g) throw new Error('golem');
    const c = crystalPosition(b, def.height, g.crystalHeight, g.crystalSide, def.radius);
    expect(c.y).toBeLessThan(b.y + def.height * g.crystalHeight);
  });
  it('el Coloso cambia de fase por umbrales de vida', () => {
    const def = E('golem_giant');
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    b.wakeT = -1;
    b.activity = 'hold';
    b.state = 'idle';
    applyHit(b, def, def.hp * 0.5, { fromX: 0, fromZ: 5, knockback: 0, stagger: false, stun: 0 });
    const phases: number[] = [];
    run(b, def, view(0, 8), 3, { onEvents: (ev) => ev.forEach((e) => e.type === 'phase' && phases.push(e.phase)) });
    expect(phases).toEqual([2]);
  });
  it('el halcón ignora a quien va a pie y caza a quien planea', () => {
    const def = E('hawk_hunter');
    const hk = def.hawk;
    if (!hk) throw new Error('hawk');
    const b = createBrain(def, 0, hk.altitude, 0, 0, 0.1);
    run(b, def, view(10, 10), 300, { stimulus: { alive: false } });
    expect(b.state).not.toBe('combat');
    let dive = false;
    const flying = view(10, 10, { y: 30, airborne: true, gliding: true, vz: 9 });
    run(b, def, flying, 60 * 8, { onEvents: (ev) => (dive ||= ev.some((e) => e.type === 'attack_active' && e.attack.def.kind === 'dive')) });
    expect(dive).toBe(true);
  });
});

describe('Locomoción y campamentos', () => {
  it('rodea un obstáculo en lugar de atravesarlo', () => {
    const def = E('goblin_melee');
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    // Muro entre x -2..2, z 2..3.
    const wall = (x: number, z: number) => x > -2 && x < 2 && z > 2 && z < 3;
    const nav: NavEnv = { ...flatNav, blocked: (x, _y, z, r) => wall(x, z) || wall(x + r, z) || wall(x - r, z) || wall(x, z + r) || wall(x, z - r) };
    expect(canStep(b, 0, 1, 1.6, nav, body(def))).toBe(false);
    for (let i = 0; i < 60 * 10; i++) walkToward(b, 0, 8, 3, DT, nav, body(def));
    expect(b.z).toBeGreaterThan(6);
  });
  it('los golems no suben escalones altos', () => {
    const def = E('golem_medium');
    const b = createBrain(def, 0, 0, 0, 0, 0.1);
    const step: NavEnv = { ...flatNav, groundAt: (_x, z) => (z > 3 ? 2.5 : 0) };
    for (let i = 0; i < 60 * 5; i++) walkToward(b, 0, 10, 2, DT, step, { ...body(def), maxStep: 0.5 });
    expect(b.z).toBeLessThan(3.5);
  });
  it('horario: dormir de noche, comer a sus horas; los guardias no duermen', () => {
    const s = DATA.encounters.schedule;
    expect(dayPhase(23, s)).toBe('sleep');
    expect(dayPhase(3, s)).toBe('sleep');
    expect(dayPhase(7.5, s)).toBe('meal');
    expect(dayPhase(13, s)).toBe('day');
    const camp = DATA.encounters.camps[0];
    expect(routineFor(camp, 'cook', 2, 'sleep', [0, 0]).activity).toBe('sleep');
    expect(routineFor(camp, 'guard', 1, 'sleep', [0, 0]).activity).toBe('guard');
    expect(routineFor(camp, 'cook', 2, 'meal', [0, 0]).activity).toBe('cook');
  });
});
