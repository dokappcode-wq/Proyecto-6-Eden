import type { MobilityConfig } from '../../data/schemas';

type GrappleConfig = MobilityConfig['grapple'];

/** Cuerda del Garfio de Raíz: primero recoge (vuela hacia el ancla) y luego permite columpiarse. */
export interface RopeState {
  ax: number;
  ay: number;
  az: number;
  /** Punto de llegada de la recogida (bajo la anilla, o encima de la piedra). */
  tx: number;
  ty: number;
  tz: number;
  length: number;
  phase: 'reel' | 'swing';
  /** El ancla tiene una piedra encima donde aterrizar al llegar. */
  perch: boolean;
}

export interface RopeBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface RopeInput {
  /** Ejes crudos (-1..1) y vectores de cámara para el balanceo. */
  right: number;
  forward: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  /** Pasar a columpio durante la recogida. */
  swing: boolean;
}

/** Punto de llegada de la recogida: justo bajo el ancla (las manos en la anilla). */
export const HANG_BELOW = 1.9;

/** `perchTop`: altura donde aterrizar al llegar (piedras flotantes); sin ella, se cuelga bajo el ancla. */
export function createRope(ax: number, ay: number, az: number, body: RopeBody, perchTop: number | null = null): RopeState {
  const perch = perchTop !== null;
  return { ax, ay, az, tx: ax, ty: perch ? perchTop : ay - HANG_BELOW, tz: az, length: Math.hypot(ax - body.x, ay - body.y, az - body.z), phase: 'reel', perch };
}

/**
 * Un paso de la cuerda (lógica pura). Devuelve 'arrived' cuando la recogida llega al ancla.
 * Columpio: péndulo con longitud fija, gravedad e impulso con la dirección (relativa a la cámara).
 */
export function stepRope(rope: RopeState, b: RopeBody, input: RopeInput, cfg: GrappleConfig, gravity: number, dt: number): 'ongoing' | 'arrived' {
  if (rope.phase === 'reel') {
    if (input.swing) {
      rope.phase = 'swing';
      rope.length = Math.max(cfg.swingLength, Math.hypot(rope.ax - b.x, rope.ay - b.y, rope.az - b.z));
    } else {
      const tx = rope.tx;
      const ty = rope.ty;
      const tz = rope.tz;
      const dx = tx - b.x;
      const dy = ty - b.y;
      const dz = tz - b.z;
      const d = Math.hypot(dx, dy, dz);
      const step = cfg.reelSpeed * dt;
      if (d <= Math.max(0.35, step)) {
        b.x = tx;
        b.y = ty;
        b.z = tz;
        b.vx = (dx / Math.max(d, 1e-6)) * cfg.reelSpeed * 0.3;
        b.vy = 0;
        b.vz = (dz / Math.max(d, 1e-6)) * cfg.reelSpeed * 0.3;
        rope.length = HANG_BELOW;
        return 'arrived';
      }
      b.vx = (dx / d) * cfg.reelSpeed;
      b.vy = (dy / d) * cfg.reelSpeed;
      b.vz = (dz / d) * cfg.reelSpeed;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      rope.length = d + HANG_BELOW;
      return 'ongoing';
    }
  }

  // --- columpio
  b.vy -= gravity * dt;
  const px = input.fx * input.forward + input.rx * input.right;
  const pz = input.fz * input.forward + input.rz * input.right;
  b.vx += px * cfg.pumpAccel * dt;
  b.vz += pz * cfg.pumpAccel * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  applyRopeConstraint(rope, b);
  return 'ongoing';
}

/** La cuerda no se estira: proyecta la posición y quita la velocidad que la alargaría. */
export function applyRopeConstraint(rope: RopeState, b: RopeBody): void {
  const dx = b.x - rope.ax;
  const dy = b.y - rope.ay;
  const dz = b.z - rope.az;
  const d = Math.hypot(dx, dy, dz);
  if (d <= rope.length || d < 1e-6) return;
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  b.x = rope.ax + ux * rope.length;
  b.y = rope.ay + uy * rope.length;
  b.z = rope.az + uz * rope.length;
  const radial = b.vx * ux + b.vy * uy + b.vz * uz;
  if (radial > 0) {
    b.vx -= radial * ux;
    b.vy -= radial * uy;
    b.vz -= radial * uz;
  }
}

/** Velocidad al soltarse: la del balanceo más un pequeño impulso hacia arriba. */
export function releaseVelocity(b: RopeBody, boost: number): { vx: number; vy: number; vz: number } {
  return { vx: b.vx * 1.05, vy: Math.max(b.vy, 0) + boost, vz: b.vz * 1.05 };
}
