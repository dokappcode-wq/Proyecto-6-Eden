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
import { HitFx } from './combat/HitFx';
import { Catalog, createEquipment, equipped, restoreEquipment } from './combat/inventory';
import { ProjectileManager } from './combat/ProjectileManager';
import { CameraController } from './player/CameraController';
import { createCharacterState, type CharacterEnv } from './player/CharacterController';
import { gliderModifiers } from './player/movement/glide';
import type { MovementParams } from './player/movement/Movement';
import { createHealth } from './player/movement/Stamina';
import { DustPool, PlayerVisual } from './player/PlayerVisual';
import { CameraSystem } from './systems/CameraSystem';
import { CombatSystem, createCombatState } from './systems/CombatSystem';
import { ElementSystem } from './systems/ElementSystem';
import { EncounterSystem } from './systems/EncounterSystem';
import { WeatherSystem } from './systems/WeatherSystem';
import { EnemySystem } from './systems/EnemySystem';
import { PickupSystem } from './systems/PickupSystem';
import { EnvironmentSystem } from './systems/EnvironmentSystem';
import { GateSystem } from './systems/GateSystem';
import { InteractionSystem } from './systems/InteractionSystem';
import { PlayerSystem } from './systems/PlayerSystem';
import { RenderSystem } from './systems/RenderSystem';
import { SaveSystem } from './systems/SaveSystem';
import { TransformSnapshotSystem } from './systems/TransformSnapshotSystem';
import { TutorialSystem } from './systems/TutorialSystem';
import { ValleyProgressSystem } from './systems/ValleyProgressSystem';
import { DebugOverlay } from './ui/DebugOverlay';
import { Hud } from './ui/Hud';
import { CombatHud } from './ui/CombatHud';
import { codeLabel } from './ui/keyLabels';
import { PlayerHud } from './ui/PlayerHud';
import { Airflow, emptyAir } from './world/airflow/Airflow';
import { AirflowVisuals } from './world/airflow/AirflowVisuals';
import { StaticColliders } from './world/physics/StaticColliders';
import { buildEncounterProps } from './world/camps/EncounterProps';
import { buildTempleCourse } from './world/temple/TempleCourse';
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
  const hp = data.player.health;
  const playerEntity = world.createEntity();
  world.add(playerEntity, 'name', { value: 'player' });
  world.add(playerEntity, 'transform', createTransform());
  world.add(playerEntity, 'player', { control: 'capsule', scriptTime: 0, cameraYaw: 0, health: createHealth(hp.startHearts, hp.fragmentsPerHeart) });
  world.add(playerEntity, 'character', createCharacterState(0, 0, 0, 0, data.player.stamina.base, data.player.swim.airSeconds));
  world.add(playerEntity, 'combat', createCombatState(createEquipment()));
  const catalog = new Catalog(data.weapons, data.items);

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
  const airflow = new Airflow(data.airflow, (x, z) => terrain.height(x, z));
  const airVisuals = new AirflowVisuals(airflow);
  renderer.scene.add(airVisuals.group);
  const templeDef = data.temples.temples.find((t) => t.id === data.valley.temple.id);
  if (!templeDef) throw new Error(`Templo "${data.valley.temple.id}" no definido en temples.json`);
  const course = buildTempleCourse(templeDef, colliders, world);
  renderer.scene.add(course.group);
  // Campamentos y arenas (sus colisionadores deben existir antes de colocar enemigos).
  const encounterProps = buildEncounterProps(
    data.encounters.camps,
    data.encounters.bosses.map((b) => ({ position: b.position, radius: data.enemies.enemies.find((e) => e.id === b.enemy)?.boss?.arenaRadius ?? 30 })),
    terrain,
    colliders,
  );

  const visual = new PlayerVisual();
  const dust = new DustPool();
  renderer.scene.add(dust.group, visual.trails);
  const cameraCtl = new CameraController(data.player.camera);

  // El overlay de debug existe antes que el entorno físico para poder dibujar sus rayos.
  const debug = new DebugOverlay(ctx, renderer, colliders, () => world.require(playerEntity, 'transform'));
  const charEnv: CharacterEnv = {
    terrainHeight: (x, z) => terrain.height(x, z),
    terrainNormal: (x, z, out) => terrain.normal(x, z, out),
    terrainMaterial: (x, z, ny) => terrain.materialAt(x, z, ny),
    materials: data.materials,
    waterLevelAt: (x, z) => terrain.waterLevelAt(x, z),
    waterCurrentAt: (x, z, out) => terrain.waterCurrentAt(x, z, out),
    airflowAt: (x, y, z, out) => airflow.sample(x, y, z, out),
    colliders,
    debugRay: (ax, ay, az, bx, by, bz, hit) => debug.ray(ax, ay, az, bx, by, bz, hit),
    // La lluvia moja las paredes (escalar resbala) y reduce el control del planeador.
    wetness: () => weather.wetness,
  };
  const camEnv = {
    terrainHeight: (x: number, z: number) => terrain.height(x, z),
    raycastColliders: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => colliders.raycast(ox, oy, oz, dx, dy, dz, max),
  };
  const movementParams: MovementParams = {
    player: data.player,
    ledge: data.ledgeBoost,
    glider: data.glider,
    gliderMods: gliderModifiers([]),
    ledgeRequiresHold: data.settings.accessibility.ledgeBoostRequiresHold,
    gliderInput: data.settings.accessibility.gliderInput,
  };

  const [vcx, vcz] = data.terrain.valley.center;
  const titleOrbit = {
    center: new THREE.Vector3(vcx, data.terrain.valley.floorHeight, vcz),
    lookAt: new THREE.Vector3(vcx + 20, data.terrain.valley.floorHeight + 12, vcz - 30),
    radius: 165,
    height: 95,
  };

  // --- sistemas (el orden es el orden de ejecución)
  const updaters = [...valley.updaters, (t: number) => course.update(t), (t: number) => airVisuals.update(t)];
  const environment = new EnvironmentSystem(renderer, playerEntity, chunks, far, water, data.terrain, updaters, ctx);
  const interaction = new InteractionSystem(playerEntity, ctx);
  const cameraSystem = new CameraSystem(playerEntity, cameraCtl, camEnv, renderer.camera, titleOrbit);
  const renderSystem = new RenderSystem(renderer);
  const playerSystem = new PlayerSystem(
    playerEntity,
    data.player,
    movementParams,
    charEnv,
    cameraCtl,
    valley.capsule,
    visual,
    dust,
    data.terrain.seaLevel,
    () => interaction.hasFocus,
    ctx,
  );
  const progress = new ValleyProgressSystem(playerEntity, valley, course, playerSystem, environment, cameraSystem, chunks, ctx);
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
      progress: () => progress.progress,
      canSave: () => !progress.isInTemple,
      equipment: () => world.require(playerEntity, 'combat').equipment,
      collected: () => [...pickups.collected],
      chestsOpened: () => [...encounters.chestsOpened],
      bossesDefeated: () => [...enemies.defeatedBosses],
    },
    ctx,
  );

  // --- combate, enemigos y objetos
  const fx = new HitFx();
  const projectiles = new ProjectileManager();
  renderer.scene.add(fx.group, projectiles.group);
  const sky = environment.clock.sample();
  const enemies = new EnemySystem(
    {
      defs: data.enemies.enemies,
      encounters: data.encounters,
      playerEntity,
      terrain,
      colliders,
      renderSystem,
      projectiles,
      fx,
      scene: renderer.scene,
      combat: data.player.combat,
      movement: data.player.movement,
      elements: data.elements,
      rain: () => weather.rain,
      skyLight: () => {
        environment.clock.sample(sky);
        // Luz por la altura del sol (la luna deja algo de visibilidad).
        return Math.min(1, Math.max(0, (sky.sunDir.y + 0.08) / 0.3));
      },
      hour: () => environment.clock.hour,
      shake: (a) => cameraCtl.addShake(a),
    },
    ctx,
  );
  const pickups = new PickupSystem(playerEntity, catalog, data.loot, data.player.combat.inventory, terrain, (x, z, y) => enemies.groundAt(x, z, y), renderer.scene, ctx);
  const encounters = new EncounterSystem(data.encounters, encounterProps, enemies, pickups, playerSystem, terrain, () => environment.clock.sample(sky).isNight, renderer.scene, ctx);
  const combat = new CombatSystem(
    { playerEntity, cfg: data.player.combat, stamina: data.player.stamina, catalog, player: playerSystem, enemies, pickups, camera: cameraCtl, threeCamera: renderer.camera, colliders, terrain, fx, projectiles, elementsCfg: data.elements, rain: () => weather.rain },
    ctx,
  );
  // --- elementos y clima
  const elements = new ElementSystem({
    cfg: data.elements,
    playerEntity,
    terrain,
    colliders,
    enemies,
    catalog,
    fx,
    airflow,
    scene: renderer.scene,
    rain: () => weather.rain,
    wind: () => weather.windVector,
    campfires: data.encounters.camps.map((c) => c.fire),
  });
  combat.elements = elements;
  elements.hooks = {
    hurt: (c, dmg, el, x, z, kb) => combat.hurtFromWorld(c, dmg, el, x, z, kb),
    status: (c, kind) => combat.applyStatus(c, kind),
    dropWeapon: (c, id, x, y, z) => combat.dropWeapon(c, id, x, y, z),
  };
  enemies.killHandler = (c, e) => combat.killFromWorld(c, e);
  const weather = new WeatherSystem(
    {
      biomes: data.biomes,
      cfg: data.elements,
      terrainCfg: data.terrain,
      terrain,
      playerEntity,
      environment,
      airflow,
      elements,
      player: playerSystem,
      catalog,
      camera: renderer.camera,
      scene: renderer.scene,
      fx,
      // La Fase 6 (armaduras y comida) amplía estas resistencias.
      resist: () => ({ cold: 0, heat: 0, insulated: false }),
    },
    ctx,
  );
  cameraSystem.lookSink = (dx, dy) => {
    if (!world.require(playerEntity, 'combat').wheelOpen) return false;
    combat.wheelLook(dx, dy);
    return true;
  };
  cameraSystem.combatView = () => ({ aim: world.require(playerEntity, 'combat').aiming ? data.player.combat.aimCamera : null, lock: combat.lockPosition(ctx) });
  const loadout = {
    name: 'loadout',
    render: () => {
      const eq = world.require(playerEntity, 'combat').equipment;
      const m = equipped(eq, 'melee');
      const b = equipped(eq, 'bow');
      const sh = equipped(eq, 'shield');
      visual.setLoadout({
        melee: m ? catalog.weapon(m.id).model : null,
        bow: b ? catalog.weapon(b.id).model : null,
        shield: sh ? catalog.shield(sh.id).model : null,
      });
      visual.setTorchLit(elements.torchLit);
    },
  };

  const anchor = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const air = emptyAir();
  const playerHud = new PlayerHud(ctx, playerEntity, {
    wheelAnchor: () => {
      const t = world.require(playerEntity, 'transform');
      camRight.setFromMatrixColumn(renderer.camera.matrixWorld, 0);
      anchor.set(t.x, t.y + 1.25, t.z).addScaledVector(camRight, 0.75).project(renderer.camera);
      if (anchor.z > 1) return null;
      const canvas = renderer.canvas;
      return { x: ((anchor.x + 1) / 2) * canvas.clientWidth, y: ((1 - anchor.y) / 2) * canvas.clientHeight };
    },
    flight: () => {
      const ch = world.require(playerEntity, 'character');
      const ground = Math.max(terrain.height(ch.x, ch.z), terrain.waterLevelAt(ch.x, ch.z) ?? -Infinity, colliders.topAt(ch.x, ch.z, 0.3, ch.y));
      airflow.sample(ch.x, ch.y, ch.z, air);
      return { height: ch.y - ground, windX: air.windX, windZ: air.windZ, thermal: air.lift > 0.1, heading: cameraCtl.yaw + Math.PI };
    },
    keyLabel,
    flightIndicators: data.settings.accessibility.flightIndicators,
  });

  const projectPoint = new THREE.Vector3();
  const combatHud = new CombatHud(
    ctx,
    playerEntity,
    combat,
    catalog,
    (x, y, z) => {
      projectPoint.set(x, y, z).project(renderer.camera);
      if (projectPoint.z > 1) return null;
      return { x: ((projectPoint.x + 1) / 2) * renderer.canvas.clientWidth, y: ((1 - projectPoint.y) / 2) * renderer.canvas.clientHeight };
    },
    {
      boss: () => {
        const b = enemies.activeBoss(ctx);
        const phases = b ? data.enemies.enemies.find((e) => e.name === b.name)?.boss?.phases ?? [] : [];
        return b ? { ...b, phases } : null;
      },
      climate: () => ({ biome: weather.biomeName, weather: weather.local.intensity > 0.15 ? weather.local.type : 'clear', celsius: Math.round(weather.temperature), band: weather.band }),
      stealth: () => {
        const ch = world.require(playerEntity, 'character');
        if (!input.isDown('crouch') || !ch.grounded || ch.swimming) return null;
        const t = world.require(playerEntity, 'transform');
        let seen = false;
        for (const e of world.query('enemy')) {
          const b = world.require(e, 'enemy').brain;
          if ((b.state === 'suspicious' || b.state === 'combat') && Math.hypot(b.x - t.x, b.z - t.z) < 40) seen = true;
        }
        return { level: enemies.currentNoise(ctx) / data.player.combat.noise.jog, seen };
      },
    },
  );

  const game = new Game(ctx);
  game
    .addSystem(new TransformSnapshotSystem())
    .addSystem({ name: 'debug-rays', fixedUpdate: () => debug.beginRays() })
    .addSystem(cameraSystem)
    .addSystem(environment)
    .addSystem(weather)
    .addSystem(interaction)
    .addSystem(combat.pre)
    .addSystem(playerSystem)
    .addSystem(enemies)
    .addSystem(elements)
    .addSystem({ name: 'ai-debug', fixedUpdate: (c) => debug.isVisible && enemies.debugCones(c, (ax, ay, az, bx, by, bz, hit) => debug.ray(ax, ay, az, bx, by, bz, hit)) })
    .addSystem(combat.post)
    .addSystem(pickups)
    .addSystem(encounters)
    .addSystem(progress)
    .addSystem(gate)
    .addSystem(tutorial)
    .addSystem(saveSystem)
    .addSystem(hud)
    .addSystem(playerHud)
    .addSystem(combatHud)
    .addSystem(loadout)
    .addSystem(debug)
    .addSystem(renderSystem);
  renderSystem.attach(playerEntity, visual.root);

  // --- debug (F3)
  debug.addProvider('posición', () => {
    const t = world.require(playerEntity, 'transform');
    const cs = data.terrain.chunk.size;
    return `${t.x.toFixed(1)}, ${t.y.toFixed(1)}, ${t.z.toFixed(1)}  chunk (${Math.floor(t.x / cs)}, ${Math.floor(t.z / cs)})  capa: ${progress.isInTemple ? 'templo' : 'superficie'}`;
  });
  debug.addProvider('jugador', () => {
    const ch = world.require(playerEntity, 'character');
    const ground = terrain.height(ch.x, ch.z);
    return `${playerSystem.modeLabel(ctx)}  v=${Math.hypot(ch.vx, ch.vz).toFixed(2)} m/s  vy=${ch.vy.toFixed(2)}  sobre suelo ${(ch.y - ground).toFixed(2)} m  agua ${ch.waterDepth.toFixed(2)} m`;
  });
  debug.addProvider('stamina', () => {
    const st = world.require(playerEntity, 'character').stamina;
    return `${st.current.toFixed(1)}/${st.max}${st.exhausted ? ' AGOTADO' : ''}  gasto/paso ${st.spentThisStep.toFixed(2)} (${st.lastSource || '—'})`;
  });
  debug.addProvider('impulso de borde', () => playerSystem.ledgeLabel(ctx));
  debug.addProvider('planeador', () => {
    const ch = world.require(playerEntity, 'character');
    const g = ch.glide;
    return `${playerSystem.glideLabel(ctx)}  vel ${g.speed.toFixed(1)} m/s  caída ${(-ch.vy).toFixed(1)} m/s  viento (${g.windX.toFixed(1)}, ${g.windZ.toFixed(1)})`;
  });
  debug.addProvider('terreno', () => {
    const s = chunks.stats;
    return `${s.loaded} chunks (LOD ${s.byLod.join('/')})  pendientes ${s.pending}  último ${s.lastBuildMs.toFixed(1)} ms  colisionadores ${colliders.count}`;
  });
  debug.addProvider('cámara', () => `dist ${cameraCtl.currentDistance.toFixed(2)}/${cameraCtl.distance.toFixed(1)} m  fov ${cameraCtl.fov.toFixed(1)}`);
  debug.addProvider('hora', () => `${environment.hourLabel}  ×${environment.clock.timeScale}`);
  debug.addProvider('progreso', () => {
    const p = progress.progress;
    return `torre ${p.towerActivated ? '✓' : '·'}  templo ${p.templeCompleted ? '✓' : p.templeOpened ? 'abierto' : '·'}  planeador ${p.hasGlider ? '✓' : '·'}  salida ${gate.isOpen ? 'abierta' : 'cerrada'}`;
  });
  debug.addProvider('combate', () => {
    const c = world.require(playerEntity, 'combat');
    const m = c.melee;
    return `${combat.meleeDef(c).name}  ${m.phase}${m.phase !== 'idle' ? ` (${m.kind} ${m.comboIndex + 1})` : ''}  ${c.aiming ? `apuntando ${c.drawT.toFixed(2)}s` : ''}${c.defense.guarding ? 'guardia' : ''}${c.plunging ? 'PICADO' : ''}${c.flurryT > 0 ? ' RÁFAGA' : ''}  fijado ${c.lockTarget ?? '—'}  tiempo ×${ctx.time.worldScale.toFixed(2)}/${ctx.time.playerScale.toFixed(2)}`;
  });
  debug.addProvider('IA', () => `${enemies.debugLabel(ctx)}  proyectiles ${projectiles.list.length}`);
  debug.addProvider('clima', () => `${weather.biomeName} · ${weather.local.type} ${(weather.local.intensity * 100).toFixed(0)}%  viento ${Math.hypot(weather.windVector.x, weather.windVector.z).toFixed(1)} m/s  lluvia ${weather.rain.toFixed(2)} mojado ${weather.wetness.toFixed(2)}  ${weather.temperature.toFixed(1)}°C (${weather.band})  fuego ${elements.fire.burning} celdas  hielo ${elements.ice.platforms.length}  (F9 cambia el tiempo)`);
  debug.addProvider('tutorial', () => {
    const { done, total } = tutorial.tracker.progress();
    return `${done}/${total}  actual: ${tutorial.tracker.current()?.id ?? 'libre'}`;
  });

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

  const noProgress = { towerActivated: false, templeOpened: false, templeCompleted: false, hasGlider: false };
  if (choice === 'continue' && save) {
    tutorial.reset(ctx, save.tutorial);
    environment.clock.hour = save.hour;
    environment.clock.day = save.day;
    gate.setOpenImmediate(save.gateOpen);
    interaction.syncCapsulePrompt(ctx, save.exitedCapsule);
    if (save.exitedCapsule) playerSystem.placeFree(ctx, save.player.x, save.player.y, save.player.z, save.player.yaw);
    else playerSystem.placeInCapsule(ctx);
    progress.apply(ctx, save.progress, save.gateOpen);
    world.require(playerEntity, 'combat').equipment = restoreEquipment(save.equipment, catalog);
    pickups.spawnValley(ctx, [...data.valley.pickups, ...data.encounters.pickups], save.collected);
    const p = world.require(playerEntity, 'player');
    p.health.maxFragments = save.health.maxFragments;
    p.health.fragments = Math.min(save.health.fragments, save.health.maxFragments);
  } else {
    tutorial.reset(ctx, []);
    environment.clock.hour = data.dayNight.startHour;
    environment.clock.day = 0;
    gate.setOpenImmediate(false);
    interaction.syncCapsulePrompt(ctx, false);
    playerSystem.placeInCapsule(ctx);
    progress.apply(ctx, noProgress, false);
    world.require(playerEntity, 'combat').equipment = createEquipment();
    pickups.spawnValley(ctx, [...data.valley.pickups, ...data.encounters.pickups], []);
  }
  const worldSave = choice === 'continue' && save ? save.world : undefined;
  enemies.spawnAll(ctx, data.valley.enemySpawns, worldSave?.bossesDefeated ?? []);
  encounters.restore(ctx, worldSave?.chestsOpened ?? []);
  const pt = world.require(playerEntity, 'transform');
  cameraCtl.snapBehind(pt.rotY, pt);
  ctx.session.mode = 'play';
  bus.emit('session:start', { newGame: choice === 'new' });
  requestLock();

  // Acceso desde la consola en desarrollo, p. ej. eden.ctx.input.rebind('jump', ['KeyJ']).
  if (import.meta.env.DEV) {
    Object.assign(window, { eden: { game, ctx, renderer, terrain, colliders, chunks, environment, player: playerSystem, tutorial, gate, progress, camera: cameraSystem, combat, enemies, pickups, encounters, elements, weather } });
  }
}

boot().catch(showFatal);
