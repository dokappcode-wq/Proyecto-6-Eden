import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { createCharacterState, jumpVelocity, stepCharacter } from '../src/player/CharacterController';
import { flatEnv, idle } from './helpers';

const data = loadGameData();
const cfg = data.player.movement;
const body = data.player.body;
const DT = 1 / 60;

function run(steps: number, fn: (i: number) => void): void {
  for (let i = 0; i < steps; i++) fn(i);
}

describe('CharacterController', () => {
  it('acelera hasta la velocidad de trote y frena al soltar', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 0, 0);
    run(60, () => stepCharacter(s, idle({ moveZ: -1 }), cfg, body, env, DT));
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(cfg.jogSpeed, 3);
    expect(s.z).toBeLessThan(-4);
    run(30, () => stepCharacter(s, idle(), cfg, body, env, DT));
    expect(Math.hypot(s.vx, s.vz)).toBe(0);
  });

  it('alcanza en el aire la altura de salto configurada', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 0, 0);
    let maxY = 0;
    stepCharacter(s, idle({ jumpPressed: true, jumpHeld: true }), cfg, body, env, DT);
    run(120, () => {
      stepCharacter(s, idle({ jumpHeld: true }), cfg, body, env, DT);
      maxY = Math.max(maxY, s.y);
    });
    expect(maxY).toBeGreaterThan(cfg.jumpHeight * 0.93);
    expect(maxY).toBeLessThan(cfg.jumpHeight * 1.05);
    expect(s.grounded).toBe(true);
  });

  it('salto variable: soltar pronto produce un salto más bajo', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 0, 0);
    let maxY = 0;
    stepCharacter(s, idle({ jumpPressed: true, jumpHeld: true }), cfg, body, env, DT);
    run(120, () => {
      stepCharacter(s, idle({ jumpHeld: false }), cfg, body, env, DT);
      maxY = Math.max(maxY, s.y);
    });
    expect(maxY).toBeLessThan(cfg.jumpHeight * 0.6);
  });

  it('buffer de salto: pulsar justo antes de aterrizar salta al tocar suelo', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 0.6, 0);
    s.grounded = false;
    // Cae ~0.6 m; pulsamos cuando quedan menos de 120 ms para tocar suelo.
    let pressed = false;
    let jumped = false;
    run(60, () => {
      const timeToGround = (-s.vy - Math.sqrt(s.vy * s.vy + 2 * cfg.gravity * s.y)) / -cfg.gravity;
      const press = !pressed && !s.grounded && timeToGround < 0.1;
      if (press) pressed = true;
      const ev = stepCharacter(s, idle({ jumpPressed: press, jumpHeld: true }), cfg, body, env, DT);
      jumped ||= ev.jumped;
    });
    expect(pressed).toBe(true);
    expect(jumped).toBe(true);
  });

  it('coyote time: se puede saltar poco después de salir de un borde', () => {
    const env = flatEnv();
    // Plataforma: colisionador caja con techo en y=2 hasta x=1.
    env.colliders.addBox(-4, 1, 0, 5, 1, 5);
    const s = createCharacterState(0, 2, 0);
    let left = -1;
    let jumped = false;
    run(80, (i) => {
      const ev = stepCharacter(s, idle({ moveX: 1, jumpPressed: left >= 0 && i === left + 4, jumpHeld: true }), cfg, body, env, DT);
      if (left < 0 && !s.grounded) left = i; // acaba de salir del borde
      jumped ||= ev.jumped;
    });
    expect(left).toBeGreaterThan(0);
    expect(jumped).toBe(true);
  });

  it('sin coyote time pasado el margen: no hay salto en el aire', () => {
    const env = flatEnv();
    const s = createCharacterState(0, 5, 0);
    s.grounded = false;
    run(12, () => stepCharacter(s, idle(), cfg, body, env, DT));
    const ev = stepCharacter(s, idle({ jumpPressed: true, jumpHeld: true }), cfg, body, env, DT);
    expect(ev.jumped).toBe(false);
  });

  it('las pendientes demasiado empinadas actúan como pared', () => {
    const env = flatEnv({ wallX: 5 });
    const s = createCharacterState(0, 0, 0);
    run(240, () => stepCharacter(s, idle({ moveX: 1 }), cfg, body, env, DT));
    expect(s.x).toBeLessThan(5.6);
    expect(s.y).toBeLessThan(cfg.stepHeight + 1.5);
  });

  it('sube escalones bajos sin saltar pero no bloques altos', () => {
    const env = flatEnv();
    env.colliders.addBox(3, 0.15, 0, 1, 0.15, 3); // escalón de 0.3 m
    env.colliders.addBox(8, 0.6, 0, 1, 0.6, 3); // bloque de 1.2 m
    const s = createCharacterState(0, 0, 0);
    let maxY = 0;
    run(150, () => {
      stepCharacter(s, idle({ moveX: 1 }), cfg, body, env, DT);
      maxY = Math.max(maxY, s.y);
    });
    expect(maxY).toBeCloseTo(0.3, 2);
    expect(s.x).toBeLessThan(7 - body.radius + 0.01);
  });

  it('un salto permite subir a un bloque de 1.2 m', () => {
    const env = flatEnv();
    env.colliders.addBox(3, 0.6, 0, 1, 0.6, 3);
    const s = createCharacterState(0, 0, 0);
    run(90, (i) => stepCharacter(s, idle({ moveX: 1, jumpPressed: i === 10, jumpHeld: true }), cfg, body, env, DT));
    expect(s.onCollider || s.x > 4).toBe(true);
  });

  it('flota en agua profunda y avanza más lento en agua', () => {
    const env = flatEnv({ water: { level: 3, minX: -100 } });
    const s = createCharacterState(0, 0, 0);
    run(60, () => stepCharacter(s, idle({ moveX: 1 }), cfg, body, env, DT));
    expect(s.floating).toBe(true);
    expect(s.y).toBeCloseTo(3 - cfg.floatDepth, 3);
    expect(Math.abs(s.vx)).toBeCloseTo(cfg.jogSpeed * cfg.waterSpeedMultiplier, 2);
  });

  it('la velocidad de salto deriva de gravedad y altura', () => {
    expect(jumpVelocity(cfg)).toBeCloseTo(Math.sqrt(2 * cfg.gravity * cfg.jumpHeight));
  });
});
