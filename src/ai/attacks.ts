import { inArc } from '../combat/damage';
import type { EnemyDef } from '../data/schemas';
import type { Brain } from './brain';

/** El jugador tal y como lo necesita la resolución de ataques. */
export interface TargetBody {
  x: number;
  y: number;
  z: number;
  /** Altura del suelo bajo sus pies. */
  groundY: number;
  radius: number;
  height: number;
}

/** Radio actual de una onda expansiva (crece durante la fase activa). */
export function shockwaveRadius(b: Brain): number {
  const a = b.attack;
  if (!a || a.def.kind !== 'shockwave' || a.phase !== 'active') return 0;
  return Math.min(a.def.radius, a.def.speed * a.t);
}

/** Centro del golpe de área (delante del atacante). */
export function slamCenter(b: Brain): { x: number; z: number } {
  const a = b.attack;
  const reach = a?.def.reach ?? 0;
  const yaw = a?.yaw ?? b.yaw;
  return { x: b.x + Math.sin(yaw) * reach, z: b.z + Math.cos(yaw) * reach };
}

/**
 * ¿El ataque activo alcanza al jugador? `margin` amplía el alcance (para detectar
 * esquivas perfectas: esquivar justo cuando el golpe iba a llegar). `areaScale`
 * agranda las áreas (descarga eléctrica en el agua).
 */
export function attackReaches(b: Brain, def: EnemyDef, p: TargetBody, margin = 0, areaScale = 1): boolean {
  const a = b.attack;
  if (!a || a.phase !== 'active' || a.hit) return false;
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const flat = Math.hypot(dx, dz);
  const feetAbove = p.y - p.groundY;
  const overlapsY = p.y < b.y + def.height + 0.4 && p.y + p.height > b.y - 0.4;
  switch (a.def.kind) {
    case 'lunge':
      return overlapsY && flat < def.radius + p.radius + a.def.reach + 0.25 + margin;
    case 'swing':
    case 'thrust':
      return overlapsY && inArc(b.x, b.z, a.yaw, p.x, p.z, p.radius + margin, def.radius + a.def.reach, a.def.arc);
    case 'slam': {
      const c = slamCenter(b);
      return feetAbove < 1.4 && Math.abs(p.y - b.y) < 3 + def.height * 0.3 && Math.hypot(p.x - c.x, p.z - c.z) < a.def.radius * areaScale + p.radius + margin;
    }
    case 'shockwave': {
      // Una onda que recorre el suelo: se esquiva saltando por encima.
      const r = shockwaveRadius(b);
      return feetAbove < 0.45 && Math.abs(p.y - b.y) < 4 && Math.abs(flat - r) < 0.9 + p.radius + margin;
    }
    case 'discharge':
      return Math.hypot(dx, p.y + p.height * 0.5 - (b.y + def.height * 0.5), dz) < a.def.radius * areaScale + p.radius + margin;
    case 'dive':
      return Math.hypot(dx, p.y + p.height * 0.5 - (b.y + def.height * 0.5), dz) < a.def.radius + p.radius + margin;
    default:
      // Proyectiles, lluvia de rocas e invocaciones se resuelven por su cuenta.
      return false;
  }
}

/** Ataques que pueden detenerse con el escudo (los de área y las ondas no). */
export function isBlockable(kind: string): boolean {
  return kind === 'lunge' || kind === 'swing' || kind === 'thrust' || kind === 'dive' || kind === 'slam';
}
