import type * as THREE from 'three';
import type { HitFx } from '../combat/HitFx';
import { equipped, type Catalog } from '../combat/inventory';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import { createRng } from '../core/math';
import type { BiomeDef, BiomeId, BiomesConfig, ElementsConfig, TerrainConfig, WeatherType } from '../data/schemas';
import type { Airflow } from '../world/airflow/Airflow';
import { biomeAt } from '../world/biomes';
import { ambientTemperature, thermalBand, WeatherModel, type ThermalBand } from '../world/weather/Weather';
import { WeatherView } from '../world/weather/WeatherView';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { ElementSystem } from './ElementSystem';
import type { EnvironmentSystem } from './EnvironmentSystem';
import type { PlayerSystem } from './PlayerSystem';

export interface WeatherDeps {
  biomes: BiomesConfig;
  cfg: ElementsConfig;
  terrainCfg: TerrainConfig;
  terrain: TerrainGenerator;
  playerEntity: Entity;
  environment: EnvironmentSystem;
  airflow: Airflow;
  elements: ElementSystem;
  player: PlayerSystem;
  catalog: Catalog;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  fx: HitFx;
  /** Resistencia térmica del equipo (°C) y protección contra rayos (Fase 6). */
  resist: () => { cold: number; heat: number; insulated: boolean };
}

const TINT: Partial<Record<WeatherType, { tint: [number, number, number]; k: number; fog: number; light: number }>> = {
  cloudy: { tint: [0.72, 0.76, 0.8], k: 0.35, fog: 1.2, light: 0.75 },
  rain: { tint: [0.5, 0.55, 0.6], k: 0.65, fog: 2.2, light: 0.5 },
  storm: { tint: [0.28, 0.31, 0.36], k: 0.85, fog: 3, light: 0.32 },
  snow: { tint: [0.88, 0.9, 0.95], k: 0.7, fog: 3.2, light: 0.7 },
  sandstorm: { tint: [0.82, 0.58, 0.32], k: 0.9, fog: 9, light: 0.55 },
  fog: { tint: [0.85, 0.87, 0.88], k: 0.6, fog: 5, light: 0.8 },
};

/**
 * Clima jugable: tiempo por bioma (lluvia, tormenta con rayos, nieve, tormenta de arena,
 * niebla), viento dinámico (planeador, fuego), superficies mojadas (escalar resbala),
 * temperatura corporal (frío y calor dañan; el fuego calienta) y efectos visuales.
 */
export class WeatherSystem implements System {
  readonly name = 'weather';
  readonly model: WeatherModel;
  private readonly view = new WeatherView();
  private readonly defs = new Map<BiomeId, BiomeDef>();
  private readonly rng = createRng(777);
  /** Bioma y tiempo donde está el jugador. */
  biome: BiomeId = 'plains';
  local: { type: WeatherType; intensity: number } = { type: 'clear', intensity: 0 };
  /** Superficies mojadas 0..1 (sube con la lluvia, se seca despacio). */
  wetness = 0;
  /** Temperatura que siente el jugador y su banda. */
  temperature = 20;
  band: ThermalBand = 'ok';
  private wind = { x: 0, z: 0, strength: 0 };
  private tempTimer = 0;
  private lightningT = 10;
  private warnT = -1;
  private flash = 0;
  private lastType: WeatherType = 'clear';
  private lastBand: ThermalBand = 'ok';

  constructor(
    private readonly d: WeatherDeps,
    ctx: GameContext,
  ) {
    for (const b of d.biomes.biomes) this.defs.set(b.id, b);
    this.model = new WeatherModel(d.biomes.biomes, d.cfg.weather, this.rng);
    d.scene.add(this.view.group);
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action !== 'debug_weather' || phase !== 'pressed' || ctx.session.mode !== 'play') return;
      // F9: pasa al siguiente tiempo posible del bioma actual.
      const def = this.defs.get(this.biome);
      if (!def) return;
      const options = Object.keys(def.weather).filter((w) => (def.weather[w] ?? 0) > 0) as WeatherType[];
      const i = options.indexOf(this.local.type);
      this.model.force(this.biome, options[(i + 1) % options.length]);
    });
  }

  /** Lluvia efectiva en la posición del jugador (0..1). */
  get rain(): number {
    return this.model.rain(this.biome);
  }

  get windVector(): { x: number; z: number } {
    return this.wind;
  }

  get biomeName(): string {
    return this.defs.get(this.biome)?.name ?? '';
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const clock = this.d.environment.clock;
    // El tiempo atmosférico sigue al reloj del mundo (T acelera ambos).
    this.model.step(dt * clock.timeScale);
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const ground = this.d.terrain.height(ch.x, ch.z);
    this.biome = biomeAt(this.d.terrainCfg, ch.x, ch.y, ch.z, ground);
    this.local = this.model.at(this.biome);
    if (this.local.type !== this.lastType && this.local.intensity > 0.3) {
      this.lastType = this.local.type;
      ctx.bus.emit('weather:changed', { biome: this.biome, type: this.local.type });
    }

    // Viento: el del bioma y su tiempo; las tormentas refuerzan las zonas de viento.
    this.wind = this.model.wind(this.biome);
    const stormy = this.local.type === 'storm' || this.local.type === 'sandstorm' ? this.local.intensity : 0;
    this.d.airflow.setGlobalWind(this.wind.x, this.wind.z, 1 + stormy * 1.5);

    // Superficies mojadas.
    const rain = this.rain;
    this.wetness = rain > this.wetness ? Math.min(1, this.wetness + dt * 0.25) : Math.max(rain, this.wetness - dt / 40);

    this.updateTemperature(ctx, dt, ch.x, ch.y, ch.z);
    this.updateLightning(ctx, dt, ch.x, ch.z);
  }

  render(ctx: GameContext): void {
    const dt = ctx.time.frameDt;
    this.flash = Math.max(0, this.flash - dt * 4);
    const play = ctx.session.mode === 'play';
    const w = play ? this.local : { type: 'clear' as WeatherType, intensity: 0 };
    const t = TINT[w.type];
    const k = w.intensity;
    if (t) this.d.environment.setWeather(1 + (t.fog - 1) * k, 1 + (t.light - 1) * k, t.tint, t.k * k, this.flash);
    else this.d.environment.setWeather(1, 1, [1, 1, 1], 0, this.flash);
    this.view.update(this.d.camera.position, w.type, k, this.wind.x, this.wind.z, dt);
  }

  private updateTemperature(ctx: GameContext, dt: number, x: number, y: number, z: number): void {
    const def = this.defs.get(this.biome);
    if (!def) return;
    const sky = this.d.environment.clock.sample();
    const daylight = Math.max(0, Math.min(1, (sky.sunDir.y + 0.1) / 0.6));
    const T = this.d.cfg.temperature;
    const ambient = ambientTemperature(def, daylight, y, this.local.type, this.local.intensity, T);
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    // Mojado se pasa más frío; el fuego y las hogueras calientan.
    this.temperature = ambient - this.wetness * 4 - (ch.swimming ? 6 : 0) + this.d.elements.warmthAt(ctx, x, z);
    const r = this.d.resist();
    this.band = thermalBand(this.temperature, r.cold, r.heat, T);
    if (this.band !== this.lastBand) {
      this.lastBand = this.band;
      ctx.bus.emit('player:temperature', { band: this.band, celsius: Math.round(this.temperature) });
    }
    if (this.band === 'ok' || ctx.world.require(this.d.playerEntity, 'player').control !== 'free') {
      this.tempTimer = 0;
      return;
    }
    this.tempTimer += dt;
    const interval = this.band === 'freezing' || this.band === 'scorching' ? T.damageInterval * 0.5 : T.damageInterval;
    if (this.tempTimer >= interval) {
      this.tempTimer = 0;
      this.d.player.damagePlayer(ctx, 1, this.band === 'cold' || this.band === 'freezing' ? 'cold' : 'heat');
    }
  }

  /** Rayos en tormenta: caen cerca; si llevas metal, pueden buscarte (con aviso). */
  private updateLightning(ctx: GameContext, dt: number, px: number, pz: number): void {
    const L = this.d.cfg.lightning;
    const storm = this.local.type === 'storm' && this.local.intensity > 0.5;
    if (this.warnT >= 0) {
      this.warnT -= dt;
      if (Math.random() < 0.25) {
        const ch = ctx.world.require(this.d.playerEntity, 'character');
        this.sparks(ch.x, ch.y, ch.z);
      }
      if (this.warnT < 0) {
        const ch = ctx.world.require(this.d.playerEntity, 'character');
        // Si soltó el metal a tiempo, el rayo cae algo apartado.
        const off = this.carriesMetal(ctx) ? 0 : 6;
        this.strike(ctx, ch.x + off, ch.z + off * 0.5);
      }
      return;
    }
    if (!storm) {
      this.lightningT = Math.max(this.lightningT, L.minInterval * 0.5);
      return;
    }
    this.lightningT -= dt;
    if (this.lightningT > 0) return;
    this.lightningT = L.minInterval + this.rng() * (L.maxInterval - L.minInterval);
    if (this.carriesMetal(ctx) && this.rng() < L.metalAttraction) {
      this.warnT = L.warnSeconds;
      ctx.bus.emit('weather:lightning_warning', {});
      return;
    }
    const a = this.rng() * Math.PI * 2;
    const r = 15 + this.rng() * 35;
    this.strike(ctx, px + Math.cos(a) * r, pz + Math.sin(a) * r);
  }

  private strike(ctx: GameContext, x: number, z: number): void {
    this.flash = 1;
    this.d.elements.strikeLightning(ctx, x, z);
  }

  /** Chisporroteo sobre el jugador: aviso de que el rayo le busca. */
  private sparks(x: number, y: number, z: number): void {
    this.d.fx.burst(x, y + 1.9, z, 'spark', 3);
    this.flash = Math.max(this.flash, 0.06);
  }

  /** ¿Lleva equipado algo metálico (y sin armadura aislante)? */
  private carriesMetal(ctx: GameContext): boolean {
    if (this.d.resist().insulated) return false;
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    const m = equipped(eq, 'melee');
    const b = equipped(eq, 'bow');
    const s = equipped(eq, 'shield');
    return (!!m && this.d.catalog.weapon(m.id).tags.includes('metal')) || (!!b && this.d.catalog.weapon(b.id).tags.includes('metal')) || (!!s && this.d.catalog.shield(s.id).tags.includes('metal'));
  }
}
