import { describe, expect, it } from 'vitest';
import { createTimeState, Game, type GameContext, type System } from '../src/core/Game';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/events';
import { World } from '../src/core/ecs/World';
import { InputManager } from '../src/core/input/InputManager';
import { loadGameData } from '../src/data';

function makeGame() {
  const data = loadGameData();
  const bus = new EventBus<GameEvents>();
  const ctx: GameContext = {
    world: new World(),
    bus,
    input: new InputManager(new EventTarget(), data.input, bus, null),
    data,
    time: createTimeState(60),
    session: { mode: 'play' },
  };
  return { game: new Game(ctx), ctx };
}

describe('Game loop', () => {
  it('ejecuta pasos fijos según el tiempo acumulado', () => {
    const { game, ctx } = makeGame();
    let steps = 0;
    game.addSystem({ name: 'count', fixedUpdate: () => steps++ });
    game.tick(1 / 60 + 1e-6);
    game.tick(1 / 120);
    game.tick(1 / 120);
    expect(steps).toBe(2);
    expect(ctx.time.alpha).toBeGreaterThanOrEqual(0);
    expect(ctx.time.alpha).toBeLessThan(1);
  });

  it('limita los subpasos ante un tirón (sin espiral de la muerte)', () => {
    const { game, ctx } = makeGame();
    let steps = 0;
    game.addSystem({ name: 'count', fixedUpdate: () => steps++ });
    game.tick(5);
    expect(steps).toBeLessThanOrEqual(ctx.data.game.loop.maxSubSteps);
    expect(ctx.time.frameDt).toBe(ctx.data.game.loop.maxFrameSeconds);
  });

  it('render recibe alpha y se llama una vez por frame', () => {
    const { game } = makeGame();
    const alphas: number[] = [];
    const sys: System = { name: 'r', render: (_c, a) => alphas.push(a) };
    game.addSystem(sys);
    game.tick(1 / 120);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeCloseTo(0.5);
  });

  it('no pierde una pulsación si el frame no ejecuta ningún paso fijo', () => {
    const { game, ctx } = makeGame();
    const target = new EventTarget();
    const input = new InputManager(target, ctx.data.input, ctx.bus, null);
    Object.assign(ctx, { input });
    let seen = false;
    game.addSystem({ name: 'jump', fixedUpdate: (c) => (seen ||= c.input.wasPressed('jump')) });
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Space' }));
    game.tick(1 / 240); // sin paso fijo
    game.tick(1 / 240);
    game.tick(1 / 60);
    expect(seen).toBe(true);
  });

  it('rechaza sistemas duplicados', () => {
    const { game } = makeGame();
    game.addSystem({ name: 'x' });
    expect(() => game.addSystem({ name: 'x' })).toThrow(/duplicado/);
  });
});
