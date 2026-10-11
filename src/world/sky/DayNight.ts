import { DEG2RAD, hexToRgb, lerp, type Vec3 } from '../../core/math';
import type { DayKeyframe, DayNightConfig } from '../../data/schemas';

type Rgb = [number, number, number];

export interface SkyState {
  hour: number;
  zenith: Rgb;
  horizon: Rgb;
  light: Rgb;
  lightIntensity: number;
  ambientSky: Rgb;
  ambientGround: Rgb;
  ambientIntensity: number;
  fog: Rgb;
  stars: number;
  /** Dirección HACIA el sol (normalizada). */
  sunDir: Vec3;
  /** Dirección hacia la luz principal (sol de día, luna de noche). */
  lightDir: Vec3;
  isNight: boolean;
}

interface ParsedKey {
  hour: number;
  zenith: Rgb;
  horizon: Rgb;
  light: Rgb;
  lightIntensity: number;
  ambientSky: Rgb;
  ambientGround: Rgb;
  ambientIntensity: number;
  fog: Rgb;
  stars: number;
}

/** Reloj del mundo: 24 min reales = 1 día (configurable) e interpolación de la atmósfera. */
export class DayNightClock {
  /** Hora del día en [0, 24). */
  hour: number;
  /** Días completos transcurridos (para la luna de sangre en fases futuras). */
  day = 0;
  timeScale = 1;
  private readonly keys: ParsedKey[];

  constructor(private readonly cfg: DayNightConfig) {
    this.hour = cfg.startHour % 24;
    this.keys = cfg.keyframes.map(parseKey);
  }

  advance(dtSeconds: number): void {
    this.hour += (dtSeconds * this.timeScale * 24) / this.cfg.dayLengthSeconds;
    while (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }
  }

  sample(out?: SkyState): SkyState {
    return sampleSky(this.keys, this.hour, this.cfg.sunTiltDeg, out);
  }
}

export function sampleSky(keys: readonly ParsedKey[], hour: number, sunTiltDeg: number, out?: SkyState): SkyState {
  // Busca los keyframes que rodean la hora (con vuelta de 24 h a 0 h).
  let a = keys[keys.length - 1];
  let b = keys[0];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].hour > hour) {
      b = keys[i];
      a = keys[(i - 1 + keys.length) % keys.length];
      break;
    }
    if (i === keys.length - 1) {
      a = keys[i];
      b = keys[0];
    }
  }
  const span = (b.hour - a.hour + 24) % 24 || 24;
  const t = ((hour - a.hour + 24) % 24) / span;

  // Sol: sale a las 6:00 por el este (+X), cénit a las 12:00, se pone a las 18:00 por el oeste.
  const ang = ((hour - 6) / 24) * Math.PI * 2;
  const tilt = sunTiltDeg * DEG2RAD;
  const sx = Math.cos(ang);
  const sy = Math.sin(ang) * Math.cos(tilt);
  const sz = Math.sin(ang) * Math.sin(tilt); // inclinación hacia el sur (+Z)
  const sunDir = { x: sx, y: sy, z: sz };
  const isNight = sy < -0.05;
  // De noche la luz principal es la luna, opuesta al sol.
  const lightDir = isNight ? { x: -sx, y: -sy, z: -sz } : { x: sx, y: Math.max(sy, 0.04), z: sz };
  normalize(lightDir);

  const s: SkyState = out ?? ({} as SkyState);
  s.hour = hour;
  s.zenith = mix(a.zenith, b.zenith, t);
  s.horizon = mix(a.horizon, b.horizon, t);
  s.light = mix(a.light, b.light, t);
  s.lightIntensity = lerp(a.lightIntensity, b.lightIntensity, t);
  s.ambientSky = mix(a.ambientSky, b.ambientSky, t);
  s.ambientGround = mix(a.ambientGround, b.ambientGround, t);
  s.ambientIntensity = lerp(a.ambientIntensity, b.ambientIntensity, t);
  s.fog = mix(a.fog, b.fog, t);
  s.stars = lerp(a.stars, b.stars, t);
  s.sunDir = sunDir;
  s.lightDir = lightDir;
  s.isNight = isNight;
  return s;
}

export function parseKey(k: DayKeyframe): ParsedKey {
  return {
    hour: k.hour,
    zenith: hexToRgb(k.zenith),
    horizon: hexToRgb(k.horizon),
    light: hexToRgb(k.light),
    lightIntensity: k.lightIntensity,
    ambientSky: hexToRgb(k.ambientSky),
    ambientGround: hexToRgb(k.ambientGround),
    ambientIntensity: k.ambientIntensity,
    fog: hexToRgb(k.fog),
    stars: k.stars,
  };
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function normalize(v: Vec3): void {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l;
  v.y /= l;
  v.z /= l;
}
