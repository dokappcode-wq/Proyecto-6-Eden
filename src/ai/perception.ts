import type { SensesDef } from '../data/schemas';

/** Quien mira/escucha (un enemigo). */
export interface Observer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Altura de los ojos sobre los pies. */
  eye: number;
  asleep: boolean;
}

/** Lo que el enemigo puede percibir del jugador en este paso. */
export interface Stimulus {
  x: number;
  y: number;
  z: number;
  alive: boolean;
  crouching: boolean;
  /** En el aire (saltando, cayendo) o planeando: silueta contra el cielo. */
  airborne: boolean;
  /** Velocidad horizontal (m/s). */
  speed: number;
  /** Radio del ruido que hace ahora mismo (m). */
  noise: number;
  /** Multiplicador de lo visible que es (equipo de sigilo < 1, armadura pesada > 1). */
  visibility?: number;
}

export interface PerceptionEnv {
  /** 0 = noche cerrada, 1 = pleno día (las hogueras iluminan al jugador cercano). */
  light: number;
  /** 0..1 intensidad de la lluvia (Fase 5); reduce vista y oído. */
  rain: number;
  /** Multiplicador de visibilidad en el aire (player.combat.airVisibility). */
  airVisibility: number;
}

/** Fracción del alcance de vista que queda de noche (sin luz). */
export const NIGHT_SIGHT = 0.45;
/** Agachado se le ve desde la mitad de distancia. */
export const CROUCH_SIGHT = 0.5;
/** Lo máximo que puede subir la alerta solo por oído (investiga, pero no ataca a ciegas). */
export const HEARING_CAP = 0.8;

/** Alcance de vista efectivo hacia el estímulo. */
export function sightRange(s: SensesDef, t: Stimulus, env: PerceptionEnv): number {
  let r = s.sight;
  if (t.airborne) {
    // En el aire la silueta se recorta contra el cielo: ni la noche ni agacharse ayudan.
    r *= env.airVisibility;
  } else {
    r *= NIGHT_SIGHT + (1 - NIGHT_SIGHT) * clamp01(env.light);
    if (t.crouching) r *= CROUCH_SIGHT;
  }
  return r * (1 - 0.35 * clamp01(env.rain)) * (t.visibility ?? 1);
}

/** ¿El punto (x,z) está dentro del cono de visión? */
export function inViewCone(o: Observer, fovDeg: number, x: number, z: number): boolean {
  if (fovDeg >= 360) return true;
  const dx = x - o.x;
  const dz = z - o.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return true;
  const cos = (dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw)) / d;
  return cos >= Math.cos(((fovDeg / 2) * Math.PI) / 180);
}

export interface SenseResult {
  /** Velocidad de llenado de la alerta por la vista (1/s). */
  sight: number;
  /** Velocidad de llenado por el oído (1/s). */
  hearing: number;
  /** Lo ve directamente (para recordar su última posición exacta). */
  sees: boolean;
}

/**
 * Cuánto percibe el observador al jugador este paso.
 * `lineOfSight` solo se consulta si hace falta (es un raycast).
 */
export function sense(o: Observer, s: SensesDef, t: Stimulus, env: PerceptionEnv, lineOfSight: () => boolean): SenseResult {
  const res: SenseResult = { sight: 0, hearing: 0, sees: false };
  if (!t.alive) return res;
  const dx = t.x - o.x;
  const dz = t.z - o.z;
  const d = Math.hypot(dx, dz, (t.y - o.y) * 0.5);
  const base = 1 / s.notice;

  // Vista: cono + alcance + línea de visión (un dormido no ve).
  if (!o.asleep) {
    const range = sightRange(s, t, env);
    if (d < range && inViewCone(o, s.fov, t.x, t.z) && lineOfSight()) {
      const k = 1 - d / range;
      // Cerca se llena casi al instante; lejos tarda varios segundos.
      let rate = base * (0.35 + 2.65 * k * k);
      if (t.speed > 2.5) rate *= 1.3;
      else if (t.crouching && t.speed < 0.5) rate *= 0.6;
      res.sight = rate;
      res.sees = true;
    }
  }
  // Presencia muy cercana: lo nota aunque esté a su espalda (dormido, desde más cerca).
  const near = s.nearSense * (t.crouching ? 0.45 : 1) * (o.asleep ? 0.5 : 1);
  if (d < near) {
    res.sight += base * 2.2 * (1 - d / near);
    res.sees = true;
  }

  // Oído: el ruido del jugador (pasos, golpes, aterrizajes) llega en un radio.
  const heard = t.noise * s.hearing * (1 - 0.5 * clamp01(env.rain)) * (o.asleep ? 0.6 : 1);
  if (d < heard) res.hearing = base * 1.4 * (1 - d / heard);
  return res;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
