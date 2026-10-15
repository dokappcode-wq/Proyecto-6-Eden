import { describe, expect, it } from 'vitest';
import { bootsJump, createBoots, onGliderFold, updateBoots } from '../src/player/mobility/boots';
import { createMotion, createTame, stepMotion, stepTaming } from '../src/player/mobility/mount';
import { stepRaft, type RaftState } from '../src/player/mobility/raft';
import { applyRopeConstraint, createRope, HANG_BELOW, stepRope } from '../src/player/mobility/rope';
import { stepSurf, surfFriction } from '../src/player/mobility/surf';
import { applyImpulse, blastBodies, collideBodies, createBody, segmentHitsBody, stepBody, type Body, type BodyEnv } from '../src/world/physics/Bodies';
import { StaticColliders } from '../src/world/physics/StaticColliders';
import { DATA } from './helpers';

const M = DATA.mobility;
const G = 28;

function env(opts: { water?: number | null; slope?: number } = {}): BodyEnv {
  const slope = opts.slope ?? 0;
  return {
    ground: (_b, x) => -x * slope,
    water: () => opts.water ?? null,
    push: () => null,
    normal: () => {
      const l = Math.hypot(slope, 1);
      return { x: slope / l, y: 1 / l, z: 0 };
    },
  };
}

function run(b: Body, e: BodyEnv, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) stepBody(b, e, G, 1 / 60);
}

describe('Objetos físicos', () => {
  it('caen, aterrizan y se quedan quietos', () => {
    const b = createBody(1, 'crate', M.bodyKinds.crate, 0, 5, 0);
    run(b, env(), 2);
    expect(b.y).toBeCloseTo(0, 2);
    expect(b.grounded).toBe(true);
  });
  it('las esferas ruedan cuesta abajo y las cajas no en pendientes suaves', () => {
    const ball = createBody(1, 'iron_ball', M.bodyKinds.iron_ball, 0, 0, 0);
    const box = createBody(2, 'crate', M.bodyKinds.crate, 0, 0, 0);
    const e = env({ slope: 0.3 });
    ball.grounded = box.grounded = true;
    run(ball, e, 2);
    run(box, e, 2);
    expect(ball.x).toBeGreaterThan(2);
    expect(Math.abs(box.x)).toBeLessThan(0.3);
  });
  it('lo que flota sube a la superficie y lo pesado se hunde', () => {
    const crate = createBody(1, 'crate', M.bodyKinds.crate, 0, -3, 0);
    const iron = createBody(2, 'metal_crate', M.bodyKinds.metal_crate, 0, -3, 0);
    const e: BodyEnv = { ...env({ water: 0 }), ground: () => -10 };
    run(crate, e, 4);
    run(iron, e, 4);
    expect(crate.y).toBeGreaterThan(-1.2);
    expect(iron.y).toBeLessThan(-5);
  });
  it('detenido en el tiempo acumula los golpes y los suelta de golpe', () => {
    const b = createBody(1, 'boulder', M.bodyKinds.boulder, 0, 0, 0);
    b.grounded = true;
    b.stasisT = 1;
    for (let i = 0; i < 3; i++) applyImpulse(b, 5 * b.def.mass, 0, 0);
    expect(b.vx).toBe(0);
    stepBody(b, env(), G, 0.5);
    expect(b.x).toBe(0);
    stepBody(b, env(), G, 0.6);
    expect(b.vx).toBeGreaterThan(10);
  });
  it('la onda expansiva empuja hacia fuera y más cuanto más cerca', () => {
    const near = createBody(1, 'crate', M.bodyKinds.crate, 1, 0, 0);
    const far = createBody(2, 'crate', M.bodyKinds.crate, 4, 0, 0);
    const out = createBody(3, 'crate', M.bodyKinds.crate, 20, 0, 0);
    const hit = blastBodies([near, far, out], 0, 0.5, 0, 5, 20);
    expect(hit.length).toBe(2);
    expect(near.vx).toBeGreaterThan(far.vx);
    expect(far.vx).toBeGreaterThan(0);
    expect(near.vy).toBeGreaterThan(0);
  });
  it('dos objetos no se atraviesan y el ligero se aparta más', () => {
    const light = createBody(1, 'crate', M.bodyKinds.crate, 0, 0, 0);
    const heavy = createBody(2, 'boulder', M.bodyKinds.boulder, 0.8, 0, 0);
    expect(collideBodies(light, heavy)).toBe(true);
    expect(heavy.x - light.x).toBeCloseTo(light.def.radius + heavy.def.radius, 3);
    expect(Math.abs(light.x)).toBeGreaterThan(Math.abs(heavy.x - 0.8));
  });
  it('un segmento detecta el objeto que cruza', () => {
    const b = createBody(1, 'barrel', M.bodyKinds.barrel, 0, 0, 5);
    expect(segmentHitsBody(b, 0, 0.5, 0, 0, 0.5, 10)).toBeCloseTo(0.45, 1);
    expect(segmentHitsBody(b, 3, 0.5, 0, 3, 0.5, 10)).toBeNull();
  });
});

describe('Colisionadores dinámicos', () => {
  it('mover un colisionador lo reindexa en su nueva celda', () => {
    const c = new StaticColliders(16);
    const box = c.addBox(0, 0.5, 0, 0.5, 0.5, 0.5);
    c.move(box, 100, 0.5, 100);
    expect(c.query(-1, -1, 1, 1)).not.toContain(box);
    expect(c.query(99, 99, 101, 101)).toContain(box);
    expect(c.topAt(100, 100, 0.2, 10)).toBeCloseTo(1, 5);
    expect(c.topAt(100, 100, 0.2, 10, box)).toBe(-Infinity);
  });
});

describe('Garfio', () => {
  it('recoge hasta colgar bajo el ancla', () => {
    const body = { x: 0, y: 0, z: -20, vx: 0, vy: 0, vz: 0 };
    const rope = createRope(0, 15, 0, body);
    let r: string = 'ongoing';
    for (let i = 0; i < 300 && r !== 'arrived'; i++) r = stepRope(rope, body, { right: 0, forward: 0, fx: 0, fz: 1, rx: 1, rz: 0, swing: false }, M.grapple, G, 1 / 60);
    expect(r).toBe('arrived');
    expect(body.y).toBeCloseTo(15 - HANG_BELOW, 1);
  });
  it('con piedra, aterriza encima', () => {
    const body = { x: 0, y: 0, z: -20, vx: 0, vy: 0, vz: 0 };
    const rope = createRope(0, 16, 0, body, 15);
    for (let i = 0; i < 300; i++) if (stepRope(rope, body, { right: 0, forward: 0, fx: 0, fz: 1, rx: 1, rz: 0, swing: false }, M.grapple, G, 1 / 60) === 'arrived') break;
    expect(body.y).toBeCloseTo(15, 1);
  });
  it('el columpio nunca estira la cuerda y oscila', () => {
    const body = { x: 5, y: 10, z: 0, vx: 0, vy: 0, vz: 0 };
    const rope = createRope(0, 15, 0, body);
    rope.phase = 'swing';
    rope.length = Math.hypot(5, 5);
    let minX = Infinity;
    for (let i = 0; i < 120; i++) {
      stepRope(rope, body, { right: 0, forward: 0, fx: 0, fz: 1, rx: 1, rz: 0, swing: false }, M.grapple, G, 1 / 60);
      expect(Math.hypot(body.x, body.y - 15, body.z)).toBeLessThanOrEqual(rope.length + 1e-6);
      minX = Math.min(minX, body.x);
    }
    expect(minX).toBeLessThan(-2);
    const b2 = { x: 0, y: 0, z: 0, vx: 0, vy: -5, vz: 0 };
    applyRopeConstraint({ ...rope, ax: 0, ay: 5, az: 0, length: 3 }, b2);
    expect(b2.y).toBeCloseTo(2, 5);
    expect(b2.vy).toBe(0);
  });
});

describe('Botas de Céfiro', () => {
  it('una carga por salto, recarga en el suelo y otra al plegar el planeador', () => {
    const b = createBoots(M.boots);
    expect(bootsJump(b, -5, M.boots)).toBeGreaterThan(M.boots.jumpSpeed - 0.01);
    expect(bootsJump(b, -5, M.boots)).toBeNull();
    onGliderFold(b);
    expect(bootsJump(b, 0, M.boots)).not.toBeNull();
    onGliderFold(b);
    expect(b.charges).toBe(0);
    updateBoots(b, true, M.boots, M.boots.rechargeSeconds + 0.01);
    expect(b.charges).toBe(M.boots.charges);
  });
});

describe('Surf con escudo', () => {
  it('acelera cuesta abajo, frena en llano y la nieve desliza más que la roca', () => {
    const s = { vx: 0, vz: 4 };
    const slope = { x: 0, y: 0.9, z: 0.43 };
    for (let i = 0; i < 120; i++) stepSurf(s, 0, slope, surfFriction(M.surf, 'grass'), 1, M.surf, G, 1 / 60);
    expect(s.vz).toBeGreaterThan(10);
    const flat = { x: 0, y: 1, z: 0 };
    const snow = { vx: 0, vz: 10 };
    const rock = { vx: 0, vz: 10 };
    for (let i = 0; i < 60; i++) {
      stepSurf(snow, 0, flat, surfFriction(M.surf, 'snow'), 1, M.surf, G, 1 / 60);
      stepSurf(rock, 0, flat, surfFriction(M.surf, 'rock'), 1, M.surf, G, 1 / 60);
    }
    expect(snow.vz).toBeGreaterThan(rock.vz);
    expect(rock.vz).toBeLessThan(10);
  });
  it('girar a la derecha desvía la velocidad hacia -X (derecha mirando a +Z)', () => {
    const s = { vx: 0, vz: 10 };
    for (let i = 0; i < 30; i++) stepSurf(s, 1, { x: 0, y: 1, z: 0 }, 0, 1, M.surf, G, 1 / 60);
    expect(s.vx).toBeLessThan(-1);
  });
});

describe('Balsa de vela', () => {
  const R = M.rafts;
  const deep = () => 5;
  it('el viento de popa con la vela izada la mueve mucho más que sin vela', () => {
    const a: RaftState = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, sail: true };
    const b: RaftState = { ...a, sail: false };
    for (let i = 0; i < 600; i++) {
      stepRaft(a, { turn: 0, paddle: 0 }, 0, 5, R, deep, 1 / 60);
      stepRaft(b, { turn: 0, paddle: 0 }, 0, 5, R, deep, 1 / 60);
    }
    expect(a.z).toBeGreaterThan(b.z * 2);
    expect(a.z).toBeGreaterThan(5);
  });
  it('la quilla frena la deriva lateral y no sale del agua', () => {
    const r: RaftState = { x: 0, z: 0, yaw: 0, vx: 4, vz: 0, sail: false };
    for (let i = 0; i < 60; i++) stepRaft(r, { turn: 0, paddle: 0 }, 0, 0, R, deep, 1 / 60);
    expect(Math.abs(r.vx)).toBeLessThan(0.5);
    const s: RaftState = { x: 0, z: 0, yaw: 0, vx: 0, vz: 3, sail: false };
    const grounded = stepRaft(s, { turn: 0, paddle: 0 }, 0, 0, R, (_x, z) => (z > 0.01 ? 0.1 : 5), 1 / 60);
    expect(grounded).toBe(true);
    expect(s.z).toBe(0);
  });
});

describe('Monturas', () => {
  const def = M.mounts.kinds.swift;
  it('adelante es medio galope; la espuela da galope y gasta espuelas que se recargan', () => {
    const m = createMotion(def);
    for (let i = 0; i < 180; i++) stepMotion(m, { forward: 1, right: 0, spurPressed: false }, def, 1 / 60);
    expect(m.speed).toBeCloseTo(def.speeds[2], 1);
    expect(stepMotion(m, { forward: 1, right: 0, spurPressed: true }, def, 1 / 60)).toBe(true);
    expect(m.spurs).toBe(def.spurs - 1);
    for (let i = 0; i < 40; i++) stepMotion(m, { forward: 1, right: 0, spurPressed: false }, def, 1 / 60);
    expect(m.speed).toBeGreaterThan(def.speeds[2]);
    for (let i = 0; i < 60 * (def.spurRecharge + def.spurSeconds + 1); i++) stepMotion(m, { forward: 1, right: 0, spurPressed: false }, def, 1 / 60);
    expect(m.spurs).toBe(def.spurs);
    const n = m.spurs;
    for (let i = 0; i < n; i++) stepMotion(m, { forward: 1, right: 0, spurPressed: true }, def, 1 / 60);
    expect(m.spurs).toBe(0);
    expect(stepMotion(m, { forward: 1, right: 0, spurPressed: true }, def, 1 / 60)).toBe(false);
  });
  it('se doma calmándola a tiempo; sin vigor te tira', () => {
    const t = createTame();
    let r = 'ongoing';
    for (let i = 0; i < 600 && r === 'ongoing'; i++) r = stepTaming(t, i % 6 === 0, def.temper, M.mounts.taming, () => true, 1 / 60);
    expect(r).toBe('tamed');
    const t2 = createTame();
    let stamina = 1;
    let r2 = 'ongoing';
    for (let i = 0; i < 600 && r2 === 'ongoing'; i++)
      r2 = stepTaming(t2, false, def.temper, M.mounts.taming, (a) => (stamina -= a) > 0, 1 / 60);
    expect(r2).toBe('thrown');
  });
});

describe('Datos de movilidad', () => {
  it('cuatro runas con nombre propio y tres tipos de montura', () => {
    expect(M.runes.map((r) => r.id).sort()).toEqual(['bomb', 'frost', 'magnet', 'stasis']);
    expect(new Set(M.runes.map((r) => r.name)).size).toBe(4);
    expect(Object.keys(M.mounts.kinds).sort()).toEqual(['sturdy', 'swift', 'tank']);
  });
  it('la isla flotante tiene al menos tres accesos (rayo, elevador y anclas)', () => {
    const isl = M.islands[0];
    const [ix, iz] = isl.position;
    const beam = DATA.airflow.thermals.some((t) => t.kind === 'ancestral_vent' && Math.hypot(t.position[0] - ix, t.position[1] - iz) < isl.radius + 12);
    const lift = M.elevators.some((e) => e.top >= isl.top && Math.hypot(e.position[0] - ix, e.position[1] - iz) < isl.radius + e.half + 2);
    const anchors = M.anchors.filter((a) => a.perch && Math.abs(a.y - isl.top) < 1 && Math.hypot(a.position[0] - ix, a.position[1] - iz) < isl.radius + 2);
    expect(beam).toBe(true);
    expect(lift).toBe(true);
    expect(anchors.length).toBeGreaterThan(0);
  });
});
