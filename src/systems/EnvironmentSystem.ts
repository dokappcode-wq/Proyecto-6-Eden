import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Renderer } from '../core/Renderer';
import type { Entity } from '../core/ecs/World';
import type { TerrainConfig } from '../data/schemas';
import { DayNightClock, type SkyState } from '../world/sky/DayNight';
import { Sky } from '../world/sky/Sky';
import type { ChunkManager } from '../world/terrain/ChunkManager';
import type { FarTerrain } from '../world/terrain/FarTerrain';
import type { WaterBodies } from '../world/water/Water';

/**
 * Mundo vivo: ciclo día/noche (24 min = 1 día), cielo, luces y niebla,
 * streaming de terreno, agua animada y animaciones ambientales de los props.
 */
export class EnvironmentSystem implements System {
  readonly name = 'environment';
  readonly clock: DayNightClock;
  private readonly sky = new Sky();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly fog: THREE.FogExp2;
  private readonly skyState = {} as SkyState;
  private readonly focus = new THREE.Vector3();
  private readonly lastFocus = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly focusVel = new THREE.Vector2();

  constructor(
    private readonly renderer: Renderer,
    private readonly playerEntity: Entity,
    private readonly chunks: ChunkManager,
    private readonly far: FarTerrain,
    private readonly water: WaterBodies,
    private readonly terrainCfg: TerrainConfig,
    private readonly updaters: Array<(time: number, dt: number) => void>,
    ctx: GameContext,
  ) {
    this.clock = new DayNightClock(ctx.data.dayNight);
    const scene = renderer.scene;
    this.fog = new THREE.FogExp2('#b9dcef', terrainCfg.fogDensity);
    scene.fog = this.fog;
    scene.add(this.sky.group, this.hemi, this.sun, this.sun.target, chunks.group, far.mesh, water.group);

    const r = ctx.data.game.render;
    this.sun.castShadow = r.shadows;
    this.sun.shadow.mapSize.set(r.shadowMapSize, r.shadowMapSize);
    const s = r.shadowRadius;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    this.clock.timeScale = ctx.input.isDown('debug_time_fast') ? ctx.data.game.debug.timeScaleFast : 1;
    this.clock.advance(dt);
  }

  render(ctx: GameContext): void {
    const dt = ctx.time.frameDt;
    const time = ctx.time.elapsed;
    const cam = this.renderer.camera;

    // Foco del streaming: el jugador en partida, la cámara en el título.
    if (ctx.session.mode === 'play') {
      const t = ctx.world.require(this.playerEntity, 'transform');
      this.focus.set(t.x, t.y, t.z);
    } else {
      this.focus.copy(cam.position);
    }
    if (!Number.isNaN(this.lastFocus.x) && dt > 0) {
      this.focusVel.set((this.focus.x - this.lastFocus.x) / dt, (this.focus.z - this.lastFocus.z) / dt);
    }
    this.lastFocus.copy(this.focus);

    this.chunks.update(this.focus.x, this.focus.z, this.focusVel.x, this.focusVel.y);
    const cc = this.chunks.coveredCenter;
    this.far.setCoverage(cc.x, cc.y, this.terrainCfg.chunk.lodDistances[2] - 8);

    // Atmósfera.
    const st = this.clock.sample(this.skyState);
    this.sky.apply(st, cam.position, time);
    this.hemi.color.setRGB(...st.ambientSky, THREE.SRGBColorSpace);
    this.hemi.groundColor.setRGB(...st.ambientGround, THREE.SRGBColorSpace);
    this.hemi.intensity = st.ambientIntensity;
    this.sun.color.setRGB(...st.light, THREE.SRGBColorSpace);
    this.sun.intensity = st.lightIntensity;
    this.fog.color.setRGB(...st.fog, THREE.SRGBColorSpace);
    this.renderer.renderer.setClearColor(this.fog.color);

    // La sombra sigue al jugador; el foco se ajusta a la rejilla de texels para evitar parpadeo.
    const texel = (ctx.data.game.render.shadowRadius * 2) / ctx.data.game.render.shadowMapSize;
    const fx = Math.round(this.focus.x / texel) * texel;
    const fz = Math.round(this.focus.z / texel) * texel;
    this.sun.target.position.set(fx, this.focus.y, fz);
    this.sun.position.set(fx + st.lightDir.x * 150, this.focus.y + st.lightDir.y * 150, fz + st.lightDir.z * 150);
    this.sun.target.updateMatrixWorld();

    this.water.update(time, this.focus.x, this.focus.z);
    for (const u of this.updaters) u(time, dt);
  }

  get hourLabel(): string {
    const h = Math.floor(this.clock.hour);
    const m = Math.floor((this.clock.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (día ${this.clock.day + 1})`;
  }
}
