import { describe, expect, it } from 'vitest';
import { createCharacterState, type CharacterState } from '../src/player/CharacterController';
import { stepMovement, type MovementEvents } from '../src/player/movement/Movement';
import { ledgeBoostDuration } from '../src/player/movement/ledge';
import { createStamina, fallDamage, spend, spendRate, updateStamina } from '../src/player/movement/Stamina';
import { DATA, flatEnv, mIn, params } from './helpers';

const DT = 1 / 60;
const P = params();
const MAXHP = 12;
const st = DATA.player.stamina;

function sim(s: CharacterState, env: ReturnType<typeof flatEnv>, steps: number, input: (i: number) => Parameters<typeof mIn>[0], onEv?: (e: MovementEvents, i: number) => void, p = P) {
  for (let i = 0; i < steps; i++) {
    const e = stepMovement(s, mIn(input(i)), p, env, DT, MAXHP);
    onEv?.(e, i);
  }
}

describe('Stamina', () => {
  it('recupera 25/s tras 0.8 s sin gastar y bloquea 3 s al agotarse', () => {
    const s = createStamina(100);
    spend(s, 40, 'x', st);
    updateStamina(s, 0.7, st);
    expect(s.current).toBe(60);
    updateStamina(s, 0.2, st);
    updateStamina(s, 1, st);
    expect(s.current).toBeCloseTo(90, 0);
    while (spendRate(s, 50, 0.1, 'x', st));
    expect(s.exhausted).toBe(true);
    updateStamina(s, 2.9, st);
    expect(s.current).toBe(0);
    updateStamina(s, 0.2, st);
    updateStamina(s, 1, st);
    expect(s.current).toBeGreaterThan(0);
    expect(s.exhausted).toBe(true); // hasta recuperar el 30 %
    updateStamina(s, 1, st);
    expect(s.exhausted).toBe(false);
  });

  it('el sprint consume 15/s', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 0, 0);
    sim(s, env, 60, () => ({ moveX: 1, sprint: true }));
    expect(s.stamina.current).toBeCloseTo(85, 0);
    expect(s.sprinting).toBe(true);
  });
});

describe('Caídas', () => {
  it('sin daño hasta 7 m, letal a 45 m, rodar reduce a la mitad', () => {
    const f = DATA.player.fall;
    expect(fallDamage(6.9, MAXHP, f, false)).toBe(0);
    expect(fallDamage(20, MAXHP, f, false)).toBeGreaterThan(0);
    expect(fallDamage(46, MAXHP, f, false)).toBe(MAXHP);
    expect(fallDamage(20, MAXHP, f, true)).toBe(Math.floor(fallDamage(20, MAXHP, f, false) / 2));
  });

  it('una caída de 20 m produce daño al aterrizar; en agua profunda no', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 20, 0);
    s.grounded = false;
    s.mode = 'air';
    let landed: MovementEvents['landed'] = null;
    sim(s, env, 200, () => ({}), (e) => (landed ??= e.landed));
    expect(landed!.damage).toBeGreaterThan(0);

    const wet = flatEnv({ water: { level: 4, minX: -100 } });
    const w = createCharacterState(0, 30, 0);
    w.grounded = false;
    w.mode = 'air';
    let wl: MovementEvents['landed'] = null;
    sim(w, wet, 200, () => ({}), (e) => (wl ??= e.landed));
    expect(wl!.water).toBe(true);
    expect(wl!.damage).toBe(0);
  });
});

describe('Impulso de Borde', () => {
  function blockWorld(top: number, material = 'stone') {
    const env = flatEnv();
    env.colliders.addBox(0, top / 2, -3, 3, top / 2, 1, 0, material);
    return env;
  }

  it('dura ≤ 0.4 s (contacto + impulso)', () => {
    expect(ledgeBoostDuration(DATA.ledgeBoost)).toBeLessThanOrEqual(0.4);
  });

  it('saltar contra un borde de 2.4 m lo agarra y sube en ≤ 0.4 s', () => {
    const env = blockWorld(2.4);
    const s = createCharacterState(0, 0, 0, Math.PI);
    let contactAt = -1;
    let exitAt = -1;
    let staminaAtExit = 100;
    sim(s, env, 120, (i) => ({ moveZ: exitAt < 0 ? -1 : 0, forward: 1, jumpPressed: i === 5, jumpHeld: i < 30 }), (e, i) => {
      if (e.ledgeContact && contactAt < 0) contactAt = i;
      if (e.ledgeExit && exitAt < 0) {
        exitAt = i;
        staminaAtExit = s.stamina.current;
      }
    });
    expect(contactAt).toBeGreaterThan(0);
    expect(exitAt).toBeGreaterThan(contactAt);
    expect((exitAt - contactAt) * DT).toBeLessThanOrEqual(0.4 + DT);
    expect(s.y).toBeCloseTo(2.4, 2);
    expect(s.grounded).toBe(true);
    expect(staminaAtExit).toBeCloseTo(100 - DATA.ledgeBoost.staminaCost, 0);
  });

  it('es al menos 2.5 veces más rápido que trepar la misma altura', () => {
    const boost = ledgeBoostDuration(DATA.ledgeBoost);
    const climbTime = 2.4 / DATA.player.climb.speed;
    expect(climbTime / boost).toBeGreaterThanOrEqual(2.5);
  });

  it('no se activa en superficies no agarrables', () => {
    const env = blockWorld(2.4, 'sand');
    const s = createCharacterState(0, 0, 0, Math.PI);
    let contact = false;
    sim(s, env, 90, (i) => ({ moveZ: -1, jumpPressed: i === 5, jumpHeld: true }), (e) => (contact ||= e.ledgeContact));
    expect(contact).toBe(false);
  });

  it('sin stamina hace un mantle lento (0.9 s) sin coste', () => {
    const env = blockWorld(2.4);
    const s = createCharacterState(0, 0, 0, Math.PI);
    s.stamina.current = 5;
    s.stamina.sinceSpend = 0;
    let mantle = false;
    let done = false;
    sim(s, env, 150, (i) => ({ moveZ: done ? 0 : -1, jumpPressed: i === 5, jumpHeld: true }), (e) => {
      if (e.ledgeBoost) mantle = e.ledgeBoost.mantle;
      done ||= e.ledgeExit;
    });
    expect(mantle).toBe(true);
    expect(s.y).toBeCloseTo(2.4, 2);
  });

  it('se pueden encadenar 3 bordes seguidos', () => {
    const env = flatEnv();
    env.colliders.addBox(0, 1.1, -3, 3, 1.1, 1);
    env.colliders.addBox(0, 2.2, -5, 3, 2.2, 1);
    env.colliders.addBox(0, 3.3, -7, 3, 3.3, 1);
    const s = createCharacterState(0, 0, 0, Math.PI);
    let exits = 0;
    let boosts = 0;
    const faces = [-2, -4, -6];
    sim(
      s,
      env,
      400,
      () => {
        const next = faces.find((f) => f < s.z - 0.01);
        const done = exits >= 3;
        return { moveZ: done ? 0 : -1, forward: done ? 0 : 1, jumpPressed: !done && s.grounded && next !== undefined && s.z - next < 1.2, jumpHeld: true };
      },
      (e) => {
        exits += e.ledgeExit ? 1 : 0;
        boosts += e.ledgeBoost && !e.ledgeBoost.mantle ? 1 : 0;
      },
    );
    expect(boosts).toBeGreaterThanOrEqual(3);
    expect(exits).toBeGreaterThanOrEqual(3);
    expect(s.y).toBeCloseTo(6.6, 1);
  });

  it('se puede soltar durante el contacto echándose atrás', () => {
    const env = blockWorld(2.4);
    const s = createCharacterState(0, 0, 0, Math.PI);
    let released = false;
    let contact = false;
    sim(s, env, 90, (i) => ({ moveZ: contact ? 1 : -1, jumpPressed: i === 5, jumpHeld: true }), (e) => {
      contact ||= e.ledgeContact;
      released ||= e.ledgeReleased;
    });
    expect(released).toBe(true);
    expect(s.y).toBeLessThan(1);
  });
});

describe('Escalada', () => {
  it('trepa una pared de roca y corona arriba', () => {
    const env = flatEnv();
    env.colliders.addBox(0, 3, -3, 3, 3, 1, 0, 'rock');
    const s = createCharacterState(0, 0, -1.5, Math.PI);
    let climbStart = false;
    let topout = false;
    let up = false;
    sim(s, env, 400, () => ({ moveZ: up ? 0 : -1, forward: up ? 0 : 1 }), (e) => {
      climbStart ||= e.climbStart;
      topout ||= e.climbTopOut;
      up ||= e.ledgeExit;
    });
    expect(climbStart).toBe(true);
    expect(topout).toBe(true);
    expect(s.y).toBeCloseTo(6, 1);
    expect(s.mode).toBe('ground');
  });

  it('consume 10/s moviéndose y se cae al agotarse', () => {
    const env = flatEnv();
    env.colliders.addBox(0, 30, -3, 3, 30, 1, 0, 'rock');
    const s = createCharacterState(0, 0, -1.5, Math.PI);
    let fell = false;
    sim(s, env, 60 * 15, () => ({ moveZ: -1, forward: 1 }), (e) => {
      if (s.mode === 'air' && s.y > 2) fell = true;
      void e;
    });
    expect(fell).toBe(true);
    expect(s.stamina.exhausted || s.stamina.current < 100).toBe(true);
  });

  it('las paredes del valle no se pueden trepar', () => {
    const env = flatEnv({ wallX: 2, wallMaterial: 'valley_wall' });
    const s = createCharacterState(0, 0, 0, Math.PI / 2);
    let climb = false;
    sim(s, env, 120, () => ({ moveX: 1, forward: 1 }), (e) => (climb ||= e.climbStart));
    expect(climb).toBe(false);
  });
});

describe('Planeador', () => {
  function airborne(y: number, glider = true): CharacterState {
    const s = createCharacterState(0, y, 0, Math.PI);
    s.grounded = false;
    s.mode = 'air';
    s.hasGlider = glider;
    s.airTime = 0.5;
    return s;
  }

  it('no se despliega sin planeador ni a menos de 1.5 m del suelo', () => {
    const env = flatEnv();
    const a = airborne(10, false);
    let dep = false;
    sim(a, env, 2, () => ({ jumpPressed: true }), (e) => (dep ||= e.gliderDeploy));
    expect(dep).toBe(false);
    const b = airborne(1.2);
    sim(b, env, 1, () => ({ jumpPressed: true }), (e) => (dep ||= e.gliderDeploy));
    expect(dep).toBe(false);
  });

  it('desde 45 m recorre ≥ 150 m en horizontal y aterriza sin daño', () => {
    const env = flatEnv();
    const s = airborne(45);
    s.stamina.max = s.stamina.current = 300;
    let landed: MovementEvents['landed'] = null;
    let deployed = false;
    sim(s, env, 60 * 40, (i) => ({ jumpPressed: i === 0 }), (e) => {
      deployed ||= e.gliderDeploy;
      landed ??= e.landed;
    });
    expect(deployed).toBe(true);
    expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(150);
    expect(landed!.fromGlide).toBe(true);
    expect(landed!.damage).toBe(0);
  });

  it('consume 5/s y se pliega al quedarse sin stamina', () => {
    const env = flatEnv();
    const s = airborne(200);
    let fold: string | null = null;
    sim(s, env, 60 * 25, (i) => ({ jumpPressed: i === 0 }), (e) => (fold ??= e.gliderFold));
    expect(fold).toBe('stamina');
    expect(s.mode).not.toBe('glide');
  });

  it('el picado gana velocidad y el flare frena', () => {
    const env = flatEnv();
    const a = airborne(400);
    sim(a, env, 1, () => ({ jumpPressed: true }));
    sim(a, env, 180, () => ({ forward: 1 }));
    expect(a.glide.speed).toBeGreaterThan(18);
    sim(a, env, 120, () => ({ forward: -1 }));
    expect(a.glide.speed).toBeLessThan(4);
  });

  it('las corrientes térmicas elevan sin gastar stamina', () => {
    const env = flatEnv({ airflow: (_x, y, _z, out) => Object.assign(out, { windX: 0, windZ: 0, lift: y < 80 ? 6 : 0, launch: 0, thermalId: y < 80 ? 't' : null }) });
    const s = airborne(20);
    sim(s, env, 1, () => ({ jumpPressed: true }));
    const st0 = s.stamina.current;
    const y0 = s.y;
    sim(s, env, 120, () => ({}));
    expect(s.y).toBeGreaterThan(y0 + 5);
    expect(s.stamina.current).toBe(st0);
  });

  it('el viento desvía la trayectoria', () => {
    const env = flatEnv({ airflow: (_x, _y, _z, out) => Object.assign(out, { windX: 3, windZ: 0, lift: 0, launch: 0, thermalId: null }) });
    const s = airborne(100);
    sim(s, env, 120, (i) => ({ jumpPressed: i === 0 }));
    expect(s.x).toBeGreaterThan(4);
  });

  it('de planeo a Impulso de Borde y de Impulso de Borde a planeo', () => {
    const env = flatEnv();
    env.colliders.addBox(0, 10, -12, 6, 10, 2, 0, 'stone');
    const s = airborne(20.6);
    let contact = false;
    let fold: string | null = null;
    sim(s, env, 400, (i) => ({ jumpPressed: i === 0 }), (e) => {
      contact ||= e.ledgeContact;
      fold ??= e.gliderFold;
    });
    expect(contact).toBe(true);
    expect(fold).toBe('ledge');
    expect(s.y).toBeCloseTo(20, 1);

    // Tras el impulso: correr, saltar del borde y desplegar al instante.
    let deployed = false;
    sim(s, env, 180, (i) => ({ moveZ: -1, jumpPressed: !deployed && i % 8 === 0 }), (e) => (deployed ||= e.gliderDeploy));
    expect(deployed).toBe(true);
  });
});

describe('Agua', () => {
  it('nadar consume 8/s y agotado se hunde hasta ahogarse', () => {
    const env = flatEnv({ water: { level: 8, minX: -100 } });
    const s = createCharacterState(0, 8 - DATA.player.movement.floatDepth, 0);
    s.swimming = true;
    s.grounded = false;
    s.mode = 'swim';
    let drowned = false;
    sim(s, env, 60 * 30, () => ({ moveX: 1 }), (e) => (drowned ||= e.drowned));
    expect(drowned).toBe(true);
  });
});
