import type { MobilityConfig } from '../../data/schemas';

type BootsConfig = MobilityConfig['boots'];

/** Botas de Céfiro: salto en el aire con cargas que se recuperan al tocar el suelo. */
export interface BootsState {
  charges: number;
  /** Tiempo apoyado desde el último uso (recarga). */
  groundT: number;
  /** Plegar el planeador devuelve una carga una vez por vuelo. */
  refoldUsed: boolean;
}

export function createBoots(cfg: BootsConfig): BootsState {
  return { charges: cfg.charges, groundT: 0, refoldUsed: false };
}

/** Recarga al estar apoyado (suelo, pared, agua). */
export function updateBoots(b: BootsState, supported: boolean, cfg: BootsConfig, dt: number): void {
  if (!supported) {
    b.groundT = 0;
    return;
  }
  b.groundT += dt;
  if (b.groundT >= cfg.rechargeSeconds) {
    b.charges = cfg.charges;
    b.refoldUsed = false;
  }
}

/** Al plegar el planeador en el aire se puede volver a impulsar (una vez por vuelo). */
export function onGliderFold(b: BootsState): void {
  if (b.charges === 0 && !b.refoldUsed) {
    b.charges = 1;
    b.refoldUsed = true;
  }
}

/** Intenta un salto en el aire: devuelve la velocidad vertical nueva o null si no quedan cargas. */
export function bootsJump(b: BootsState, vy: number, cfg: BootsConfig): number | null {
  if (b.charges <= 0) return null;
  b.charges--;
  return Math.max(vy, 0) * 0.25 + cfg.jumpSpeed;
}
