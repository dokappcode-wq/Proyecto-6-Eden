import * as THREE from 'three';
import { createTimeState, Game, type GameContext } from './core/Game';
import { EventBus } from './core/EventBus';
import { createTransform } from './core/ecs/components';
import { World } from './core/ecs/World';
import type { GameEvents } from './core/events';
import { InputManager } from './core/input/InputManager';
import { Renderer } from './core/Renderer';
import { browserStorage, SaveStore } from './core/save';
import { loadGameData } from './data';
import { CameraController } from './player/CameraController';
import { createCharacterState, type CharacterEnv } from './player/CharacterController';
import { DustPool, PlayerVisual } from './player/PlayerVisual';
import { CameraSystem } from './systems/CameraSystem';
import { EnvironmentSystem } from './systems/EnvironmentSystem';
import { GateSystem } from './systems/GateSystem';
import { InteractionSystem } from './systems/InteractionSystem';
import { PlayerSystem } from './systems/PlayerSystem';
import { RenderSystem } from './systems/RenderSystem';
import { SaveSystem } from './systems/SaveSystem';
import { TransformSnapshotSystem } from './systems/TransformSnapshotSystem';
import { TutorialSystem } from './systems/TutorialSystem';
import { DebugOverlay } from './ui/DebugOverlay';
import { Hud } from './ui/Hud';
import { codeLabel } from './ui/keyLabels';
import { StaticColliders } from './world/physics/StaticColliders';
import { ChunkManager } from './world/terrain/ChunkManager';
import { FarTerrain } from './world/terrain/FarTerrain';
import { TerrainGenerator } from './world/terrain/TerrainGenerator';
import { buildValley } from './world/valley/ValleyBuilder';
import { WaterBodies } from './world/water/Water';

function showFatal(err: unknown): void {
  const el = document.getElementById('error');
  if (el) {
    el.style.display = 'block';
    el.textContent = err instanceof Error ? err.message : String(err);
  }
  console.error(err);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Falta el contenedor #app en index.html');

  const data = loadGameData();
  document.title = data.game.title;

  const renderer = new Renderer(container, data.game);
  const bus = new EventBus<GameEvents>();
  const storage = browserStorage();
  const input = new InputManager(window, data.input, bus, storage, () => document.pointerLockElement === renderer.canvas);
  const keyLabel = (action: string) => codeLabel(input.getBindings()[action]?.[0] ?? '?');
  const world = new World();
  const ctx: GameContext = { world, bus, input, data, time: createTimeState(data.game.loop.fixedStepHz), session: { mode: 'loading' } };

  // --- jugador (la entidad existe desde el principio; se coloca al empezar la sesión)
  const playerEntity = world.createEntity();
  world.add(playerEntity, 'name', { value: 'player' });
  world.add(playerEntity, 'transform', createTransform());
  world.add(playerEntity, 'player', { control: 'capsule', scriptTime: 0, cameraYaw: 0 });
  world.add(playerEntity, 'character', createCharacterState(0, 0, 0));

  const camDir = new THREE.Vector3();
  const hud = new Hud(
    ctx,
    () => {
      renderer.camera.getWorldDirection(camDir);
      return ((Math.atan2(camDir.x, -camDir.z) * 180) / Math.PI + 360) % 360;
    },
    () => (ctx.session.mode === 'play' ? world.require(playerEntity, 'transform') : renderer.camera.position),
    () => document.pointerLockElement === renderer.canvas,
    keyLabel,
  );
  await nextFrame(); // deja pintar la pantalla de carga

  // --- mundo
  const terrain = new TerrainGenerator(data.terrain);
  const colliders = new StaticColliders();
  const valley = buildValley(data.valley, terrain, colliders, world);
  renderer.scene.add(valley.group);
  const chunks = new ChunkManager(terrain, data.terrain);
  const far = new FarTerrain(terrain, data.terrain);
  const water = new WaterBodies(data.terrain, data.valley);

  const visual = new PlayerVisual();
  const dust = new DustPool();
  renderer.scene.add(dust.group);
  const cameraCtl = new CameraController(data.player.camera);

  const charEnv: CharacterEnv = {
    terrainHeight: (x, z) => terrain.height(x, z),
    terrainNormal: (x, z, out) => terrain.normal(x, z, out),
    waterLevelAt: (x, z) => terrain.waterLevelAt(x, z),
    colliders,
  };
  const camEnv = {
    terrainHeight: (x: number, z: number) => terrain.height(x, z),
    raycastColliders: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => colliders.raycast(ox, oy, oz, dx, dy, dz, max),
  };

  const [vcx, vcz] = data.terrain.valley.center;
  const titleOrbit = {
    center: new THREE.Vector3(vcx, data.terrain.valley.floorHeight, vcz),
    lookAt: new THREE.Vector3(vcx + 20, data.terrain.valley.floorHeight + 12, vcz - 30),
    radius: 165,
    height: 95,
  };

  // --- sistemas (el orden es el orden de ejecución)
  const environment = new EnvironmentSystem(renderer, playerEntity, chunks, far, water, data.terrain, valley.updaters, ctx);
  const interaction = new InteractionSystem(playerEntity, ctx);
  const playerSystem = new PlayerSystem(playerEntity, data.player, charEnv, cameraCtl, valley.capsule, visual, dust, data.terrain.seaLevel, ctx);
  const gate = new GateSystem(valley.gate, colliders, ctx);
  const tutorial = new TutorialSystem(playerEntity, terrain, keyLabel, ctx);
  const saveSystem = new SaveSystem(
    new SaveStore(storage),
    playerEntity,
    {
      tutorialIds: () => tutorial.tracker.completedIds(),
      hour: () => environment.clock.hour,
      day: () => environment.clock.day,
      gateOpen: () => gate.isOpen,
    },
    ctx,
  );
  const renderSystem = new RenderSystem(renderer);
  const debug = new DebugOverlay(ctx, renderer, colliders, () => world.require(playerEntity, 'transform'));

  const game = new Game(ctx);
  game
    .addSystem(new TransformSnapshotSystem())
    .addSystem(new CameraSystem(playerEntity, cameraCtl, camEnv, renderer.camera, titleOrbit))
    .addSystem(environment)
    .addSystem(interaction)
    .addSystem(playerSystem)
    .addSystem(gate)
    .addSystem(tutorial)
    .addSystem(saveSystem)
    .addSystem(hud)
    .addSystem(debug)
    .addSystem(renderSystem);
  renderSystem.attach(playerEntity, visual.root);

  // --- debug (F3)
  debug.addProvider('posición', () => {
    const t = world.require(playerEntity, 'transform');
    const cs = data.terrain.chunk.size;
    return `${t.x.toFixed(1)}, ${t.y.toFixed(1)}, ${t.z.toFixed(1)}  chunk (${Math.floor(t.x / cs)}, ${Math.floor(t.z / cs)})  capa: superficie`;
  });
  debug.addProvider('jugador', () => {
    const ch = world.require(playerEntity, 'character');
    const ground = terrain.height(ch.x, ch.z);
    return `${playerSystem.modeLabel(ctx)}  v=${Math.hypot(ch.vx, ch.vz).toFixed(2)} m/s  vy=${ch.vy.toFixed(2)}  sobre suelo ${(ch.y - ground).toFixed(2)} m  agua ${ch.waterDepth.toFixed(2)} m`;
  });
  debug.addProvider('terreno', () => {
    const s = chunks.stats;
    return `${s.loaded} chunks (LOD ${s.byLod.join('/')})  pendientes ${s.pending}  último ${s.lastBuildMs.toFixed(1)} ms  colisionadores ${colliders.count}`;
  });
  debug.addProvider('cámara', () => `dist ${cameraCtl.currentDistance.toFixed(2)}/${cameraCtl.distance.toFixed(1)} m  fov ${cameraCtl.fov.toFixed(1)}`);
  debug.addProvider('hora', () => `${environment.hourLabel}  ×${environment.clock.timeScale}`);
  debug.addProvider('tutorial', () => {
    const { done, total } = tutorial.tracker.progress();
    return `${done}/${total}  actual: ${tutorial.tracker.current()?.id ?? 'libre'}`;
  });
  debug.addProvider('sistemas', () => game.getSystemNames().join(' → '));

  hud.addMarker({ x: valley.towerTop.x, z: valley.towerTop.z });

  // --- carga inicial: terreno alrededor del valle antes de mostrar nada
  playerSystem.placeInCapsule(ctx);
  chunks.preload(vcx, vcz);
  bus.emit('world:loaded', { chunks: chunks.loadedCount, colliders: colliders.count });

  ctx.session.mode = 'title';
  game.start();

  const requestLock = () => {
    if (ctx.session.mode !== 'play' || document.pointerLockElement === renderer.canvas) return;
    try {
      const r = renderer.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // Algunos navegadores lo rechazan sin gesto de usuario: el HUD indica "haz clic".
    }
  };
  renderer.canvas.addEventListener('click', requestLock);

  const save = saveSystem.load();
  const choice = await hud.showTitle(save !== null);
  hud.hideScreen();

  if (choice === 'continue' && save) {
    tutorial.reset(ctx, save.tutorial);
    environment.clock.hour = save.hour;
    environment.clock.day = save.day;
    gate.setOpenImmediate(save.gateOpen);
    interaction.syncCapsulePrompt(ctx, save.exitedCapsule);
    if (save.exitedCapsule) playerSystem.placeFree(ctx, save.player.x, save.player.y, save.player.z, save.player.yaw);
    else playerSystem.placeInCapsule(ctx);
  } else {
    tutorial.reset(ctx, []);
    environment.clock.hour = data.dayNight.startHour;
    environment.clock.day = 0;
    gate.setOpenImmediate(false);
    interaction.syncCapsulePrompt(ctx, false);
    playerSystem.placeInCapsule(ctx);
  }
  const pt = world.require(playerEntity, 'transform');
  cameraCtl.snapBehind(pt.rotY, pt);
  ctx.session.mode = 'play';
  bus.emit('session:start', { newGame: choice === 'new' });
  requestLock();

  // Acceso desde la consola en desarrollo, p. ej. eden.ctx.input.rebind('jump', ['KeyJ']).
  if (import.meta.env.DEV) Object.assign(window, { eden: { game, ctx, renderer, terrain, colliders, chunks, environment, player: playerSystem, tutorial, gate } });
}

boot().catch(showFatal);
