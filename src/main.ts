import { createTimeState, Game, type GameContext } from './core/Game';
import { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import { World } from './core/ecs/World';
import { InputManager } from './core/input/InputManager';
import { Renderer } from './core/Renderer';
import { loadGameData } from './data';
import { RenderSystem } from './systems/RenderSystem';
import { SpinSystem } from './systems/SpinSystem';
import { TransformSnapshotSystem } from './systems/TransformSnapshotSystem';
import { DebugOverlay } from './ui/DebugOverlay';
import { spawnWorld } from './world/spawnWorld';

function showFatal(err: unknown): void {
  const el = document.getElementById('error');
  if (el) {
    el.style.display = 'block';
    el.textContent = err instanceof Error ? err.message : String(err);
  }
  console.error(err);
}

function boot(): Game {
  const container = document.getElementById('app');
  if (!container) throw new Error('Falta el contenedor #app en index.html');

  const data = loadGameData();
  document.title = data.game.title;

  const bus = new EventBus<GameEvents>();
  const input = new InputManager(window, data.input, bus);
  const world = new World();
  const renderer = new Renderer(container, data.game);
  renderer.buildEnvironment(data.world);

  const ctx: GameContext = { world, bus, input, data, time: createTimeState(data.game.loop.fixedStepHz) };
  const game = new Game(ctx);
  const debug = new DebugOverlay(ctx, renderer);

  // Orden = orden de ejecución. El snapshot de transforms siempre primero; render y UI al final.
  game
    .addSystem(new TransformSnapshotSystem())
    .addSystem(new SpinSystem())
    .addSystem(new RenderSystem(renderer))
    .addSystem(debug);

  debug.addProvider('sistemas', () => game.getSystemNames().join(' → '));
  spawnWorld(world, data.world, bus);
  game.start();

  // Acceso desde la consola en desarrollo, p. ej. eden.input.rebind('jump', ['KeyJ']).
  if (import.meta.env.DEV) Object.assign(window, { eden: { game, ctx, renderer } });
  return game;
}

try {
  boot();
} catch (err) {
  showFatal(err);
}
