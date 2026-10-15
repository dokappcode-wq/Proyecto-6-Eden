import type { BiomeDef, BiomeId, ElementsConfig, WeatherType } from '../../data/schemas';

interface BiomeWeather {
  type: WeatherType;
  /** 0..1: cuánto se nota (sube al entrar el frente, baja al irse). */
  intensity: number;
  /** Tiempo que le toca entrar cuando el actual se haya disipado. */
  next: WeatherType | null;
  timer: number;
}

/** Cuánto multiplica cada tiempo el viento del bioma. */
const WIND_BY_WEATHER: Record<WeatherType, number> = { clear: 1, cloudy: 1.2, rain: 1.5, storm: 3.2, snow: 1.8, sandstorm: 3.6, fog: 0.4 };

/**
 * Tiempo atmosférico por bioma: cada bioma cambia de tiempo al azar según sus pesos
 * (biomes.json), con transiciones suaves (el frente se disipa y entra el siguiente).
 * Determinista con la semilla dada. Lógica pura.
 */
export class WeatherModel {
  private readonly states = new Map<BiomeId, BiomeWeather>();
  private readonly defs = new Map<BiomeId, BiomeDef>();
  /** Dirección del viento global (radianes; deriva lentamente). */
  windAngle = 0.9;
  private t = 0;

  constructor(
    biomes: readonly BiomeDef[],
    private readonly cfg: ElementsConfig['weather'],
    private readonly rng: () => number,
  ) {
    for (const b of biomes) {
      this.defs.set(b.id, b);
      this.states.set(b.id, { type: 'clear', intensity: 0, next: null, timer: this.duration() * rng() });
    }
  }

  step(dt: number): void {
    this.t += dt;
    // El viento gira despacio (con algún giro brusco ocasional).
    this.windAngle += (Math.sin(this.t * 0.013) * 0.02 + Math.sin(this.t * 0.07) * 0.01) * dt * 6;
    const fade = dt / this.cfg.transitionSeconds;
    for (const [id, s] of this.states) {
      if (s.next !== null) {
        s.intensity = Math.max(0, s.intensity - fade);
        if (s.intensity === 0) {
          s.type = s.next;
          s.next = null;
        }
        continue;
      }
      s.intensity = Math.min(1, s.intensity + fade);
      s.timer -= dt;
      if (s.timer <= 0) {
        s.timer = this.duration();
        const pick = this.pick(id);
        if (pick !== s.type) s.next = pick;
      }
    }
  }

  /** Tiempo e intensidad en un bioma. */
  at(id: BiomeId): { type: WeatherType; intensity: number } {
    const s = this.states.get(id);
    return s ? { type: s.type, intensity: s.type === 'clear' ? 0 : s.intensity } : { type: 'clear', intensity: 0 };
  }

  /** Fuerza un tiempo (debug y eventos): entra de inmediato. */
  force(id: BiomeId, type: WeatherType): void {
    const s = this.states.get(id);
    if (!s) return;
    s.type = type;
    s.next = null;
    s.intensity = 1;
    s.timer = this.duration();
  }

  /** Viento (m/s) del bioma según su tiempo, con rachas. */
  wind(id: BiomeId): { x: number; z: number; strength: number } {
    const def = this.defs.get(id);
    const w = this.at(id);
    const gust = 1 + Math.sin(this.t * 0.9) * 0.15 + Math.sin(this.t * 2.3) * 0.1;
    const strength = (def?.wind ?? 1) * (1 + (WIND_BY_WEATHER[w.type] - 1) * w.intensity) * gust;
    return { x: Math.sin(this.windAngle) * strength, z: Math.cos(this.windAngle) * strength, strength };
  }

  /** Lluvia efectiva 0..1 (lluvia y tormenta) en un bioma. */
  rain(id: BiomeId): number {
    const w = this.at(id);
    return w.type === 'rain' ? w.intensity * 0.7 : w.type === 'storm' ? w.intensity : 0;
  }

  /** Estado serializable (para el guardado). */
  snapshot(): Record<string, { type: WeatherType; intensity: number; timer: number }> {
    const out: Record<string, { type: WeatherType; intensity: number; timer: number }> = {};
    for (const [id, s] of this.states) out[id] = { type: s.next ?? s.type, intensity: s.next ? 0 : s.intensity, timer: s.timer };
    return out;
  }

  restore(snap: Record<string, { type: WeatherType; intensity: number; timer: number }>): void {
    for (const [id, v] of Object.entries(snap)) {
      const s = this.states.get(id as BiomeId);
      if (!s) continue;
      s.type = v.type;
      s.intensity = v.intensity;
      s.timer = v.timer;
      s.next = null;
    }
  }

  private duration(): number {
    return this.cfg.minSeconds + this.rng() * (this.cfg.maxSeconds - this.cfg.minSeconds);
  }

  private pick(id: BiomeId): WeatherType {
    const def = this.defs.get(id);
    if (!def) return 'clear';
    const entries = Object.entries(def.weather) as [WeatherType, number][];
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.rng() * total;
    for (const [type, w] of entries) {
      r -= w;
      if (r <= 0) return type;
    }
    return entries[entries.length - 1][0];
  }
}

/**
 * Temperatura ambiente (°C): día/noche del bioma, tiempo atmosférico y altitud.
 * `daylight` 0 = noche cerrada, 1 = mediodía.
 */
export function ambientTemperature(b: BiomeDef, daylight: number, y: number, weather: WeatherType, intensity: number, cfg: ElementsConfig['temperature']): number {
  const base = b.temperature.night + (b.temperature.day - b.temperature.night) * Math.max(0, Math.min(1, daylight));
  const altitude = Math.max(0, y - cfg.referenceHeight) * cfg.lapseRate;
  return base + (cfg.weather[weather] ?? 0) * intensity - altitude;
}

export type ThermalBand = 'freezing' | 'cold' | 'ok' | 'hot' | 'scorching';

/** Banda térmica con la resistencia del equipo (°C que amplían el rango cómodo). */
export function thermalBand(temp: number, coldResist: number, heatResist: number, cfg: ElementsConfig['temperature']): ThermalBand {
  if (temp < cfg.freezing - coldResist) return 'freezing';
  if (temp < cfg.cold - coldResist) return 'cold';
  if (temp > cfg.scorching + heatResist) return 'scorching';
  if (temp > cfg.hot + heatResist) return 'hot';
  return 'ok';
}
