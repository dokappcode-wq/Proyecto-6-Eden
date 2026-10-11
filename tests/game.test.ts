import { describe, expect, it } from 'vitest';
import { createTimeState, Game, type GameContext, type System } from '../src/core/Game';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/events';
import { World } from '../src/core/ecs/World';
import { InputManager } from '../src/core/input/InputManager';
import { loadGameData } from '../src/data';
import { SpinSystem } from '../src/systems/SpinSystem';
import { TransformSnapshotSystem } from '../src/systems/TransformSnapshotSystem';
import { spawnWorld } from '../src/world/spawnWorld';

function makeGame() {
  const data = loadGameData();
  const bus = new EventBus<GameEvents>();
  const ctx: GameContext = {
    world: new World(),
    bus,
    input: new InputManager(new EventTarget(), data.input, bus, null),
    data,
    time: createTimeState(60),
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
    expect(steps).toBe(ctx.data.game.loop.maxSubSteps);
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

  it('rechaza sistemas duplicados', () => {
    const { game } = makeGame();
    game.addSystem({ name: 'x' });
    expect(() => game.addSystem({ name: 'x' })).toThrow(/duplicado/);
  });

  it('integra mundo de datos + sistemas: el cubo ancestral gira', () => {
    const { game, ctx } = makeGame();
    const [cube] = spawnWorld(ctx.world, ctx.data.world, ctx.bus);
    game.addSystem(new TransformSnapshotSystem()).addSystem(new SpinSystem());
    for (let i = 0; i < 60; i++) game.tick(1 / 60 + 1e-6);
    const t = ctx.world.require(cube, 'transform');
    expect(t.rotY).toBeCloseTo(ctx.world.require(cube, 'spin').speed, 1);
    expect(t.prevRotY).toBeLessThan(t.rotY);
  });
});
