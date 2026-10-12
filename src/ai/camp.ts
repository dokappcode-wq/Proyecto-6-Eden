import type { CampDef, CampRole, EncountersConfig } from '../data/schemas';
import type { Activity } from './brain';

export type DayPhase = 'sleep' | 'meal' | 'day';

/** Fase del día del campamento según la hora (dormir, comer, actividad). */
export function dayPhase(hour: number, s: EncountersConfig['schedule']): DayPhase {
  const inRange = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);
  if (inRange(hour, s.sleepFrom, s.sleepTo)) return 'sleep';
  for (const [from, to] of s.meals) if (inRange(hour, from, to)) return 'meal';
  return 'day';
}

export interface Routine {
  activity: Activity;
  x: number;
  z: number;
  /** Orientación al llegar. */
  yaw: number;
}

/**
 * Qué hace cada rol según la hora:
 * guardias y vigías no duermen; los demás duermen en las tiendas de noche,
 * comen junto a la hoguera a sus horas y de día cada uno a lo suyo.
 */
export function routineFor(camp: CampDef, role: CampRole, index: number, phase: DayPhase, home: [number, number]): Routine {
  const [fx, fz] = camp.fire;
  const [cx, cz] = camp.center;
  const seat = (i: number): Routine => {
    // Sitio alrededor de la hoguera, mirando al fuego.
    const a = i * 2.39996 + 0.4;
    const x = fx + Math.cos(a) * 2.4;
    const z = fz + Math.sin(a) * 2.4;
    return { activity: 'cook', x, z, yaw: Math.atan2(fx - x, fz - z) };
  };
  const tent = (i: number): Routine => {
    const t = camp.tents.length > 0 ? camp.tents[i % camp.tents.length] : null;
    const [x, z] = t ? t.position : home;
    return { activity: 'sleep', x, z, yaw: t ? t.yaw : 0 };
  };
  switch (role) {
    case 'guard': {
      const [px, pz] = campPost(camp, index, home);
      return { activity: 'guard', x: px, z: pz, yaw: Math.atan2(px - cx, pz - cz) };
    }
    case 'lookout': {
      const [x, z] = camp.lookout ? camp.lookout.position : home;
      return { activity: 'lookout', x, z, yaw: Math.atan2(x - cx, z - cz) };
    }
    case 'patrol':
      return phase === 'meal' ? seat(index) : { activity: 'patrol', x: home[0], z: home[1], yaw: 0 };
    case 'leader':
    case 'cook':
    case 'sleeper':
      if (phase === 'sleep') return tent(index);
      if (phase === 'meal' || role !== 'sleeper') return seat(index);
      // De día el dormilón también descansa en su tienda.
      return tent(index);
  }
}

function campPost(camp: CampDef, index: number, home: [number, number]): [number, number] {
  const m = camp.members[index];
  return m?.post ?? home;
}

/** Máximo de miembros atacando cuerpo a cuerpo a la vez (el resto flanquea). */
export const MAX_ATTACKERS = 2;
