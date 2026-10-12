import type { WeaponDef } from '../data/schemas';

export interface ArrowShot {
  /** Dirección normalizada. */
  dx: number;
  dy: number;
  dz: number;
  speed: number;
}

/** Fracción de carga 0..1 tras `drawT` segundos tensando. */
export function drawFraction(bow: WeaponDef, drawT: number): number {
  const drawTime = bow.bow?.drawTime ?? 1;
  return Math.min(1, Math.max(0, drawT / drawTime));
}

/**
 * Flechas que salen al soltar: velocidad según la carga y, con carga completa,
 * el especial del arco (triple flecha en abanico).
 */
export function arrowsForShot(bow: WeaponDef, drawT: number, aim: { dx: number; dy: number; dz: number }): ArrowShot[] {
  const cfg = bow.bow;
  if (!cfg) return [];
  const k = drawFraction(bow, drawT);
  const speed = arrowSpeed(bow, drawT);
  const shots: ArrowShot[] = [{ ...aim, speed }];
  if (k >= 1 && bow.heavy.special === 'triple_arrow') {
    for (const side of [-1, 1]) {
      const a = side * cfg.multishotSpread;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Giro alrededor del eje vertical.
      shots.push({ dx: aim.dx * c + aim.dz * s, dy: aim.dy, dz: -aim.dx * s + aim.dz * c, speed });
    }
  }
  return shots;
}

/** Velocidad de salida según la carga. */
export function arrowSpeed(bow: WeaponDef, drawT: number): number {
  const cfg = bow.bow;
  if (!cfg) return 0;
  return cfg.arrowSpeed * (cfg.minSpeedFraction + (1 - cfg.minSpeedFraction) * drawFraction(bow, drawT));
}

/**
 * Corrige la dirección para que la flecha, con gravedad, llegue al punto apuntado
 * (solo hasta `maxDist`: más lejos cae como debe, premiando apuntar alto).
 */
export function compensateDrop(aim: { dx: number; dy: number; dz: number }, dist: number, speed: number, gravity: number, maxDist: number): { dx: number; dy: number; dz: number } {
  if (speed <= 0 || dist <= 0 || dist > maxDist) return aim;
  const t = dist / speed;
  const dy = aim.dy + (0.5 * gravity * t * t) / dist;
  const l = Math.hypot(aim.dx, dy, aim.dz) || 1;
  return { dx: aim.dx / l, dy: dy / l, dz: aim.dz / l };
}
