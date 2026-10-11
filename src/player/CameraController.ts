import { DEG2RAD, clamp, damp, dampAngle, type Vec3 } from '../core/math';
import type { CameraConfig } from '../data/schemas';

export interface CameraEnv {
  terrainHeight(x: number, z: number): number;
  /** Distancia al primer obstáculo a lo largo del rayo o Infinity. */
  raycastColliders(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
}

export interface CameraFrameInput {
  /** Píxeles de ratón desde el último frame. */
  lookDX: number;
  lookDY: number;
  /** Pasos de rueda (+ = alejar). */
  zoom: number;
  /** Pies del objetivo (interpolados). */
  target: Vec3;
  /** Velocidad horizontal del objetivo (m/s) y su yaw de movimiento. */
  speed: number;
  moveYaw: number;
  moving: boolean;
  /** Planeando: cámara más abierta y alineada con el rumbo. */
  gliding?: boolean;
  /** Trepando: algo más alejada para ver la pared. */
  climbing?: boolean;
}

/**
 * Cámara orbital en tercera persona. Lógica pura (sin Three.js):
 * - yaw/pitch con el ratón, zoom con la rueda;
 * - colisión: se acerca al instante si algo se interpone y se aleja suavemente;
 * - se recoloca detrás del jugador tras unos segundos sin tocar el ratón;
 * - FOV dinámico con la velocidad (base para el planeador en la Fase 2).
 *
 * Convención: con yaw = 0 la cámara está al sur (+Z) del jugador mirando al norte (-Z).
 */
export class CameraController {
  yaw: number;
  pitch: number;
  /** Distancia deseada (zoom). */
  distance: number;
  /** Distancia real tras colisiones. */
  currentDistance: number;
  fov: number;
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly lookAt: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly pivot: Vec3 = { x: 0, y: 0, z: 0 };
  private idleTime = 0;
  private initialized = false;
  private shake = 0;
  private fovKick = 0;
  private baseFov: number;
  private shakeT = 0;
  private modeDistance = 0;
  /** Desplazamiento de sacudida aplicado este frame (lo suma la cámara de Three.js). */
  readonly shakeOffset: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly cfg: CameraConfig) {
    this.yaw = 0;
    this.pitch = cfg.startPitchDeg * DEG2RAD;
    this.distance = cfg.distance;
    this.currentDistance = cfg.distance;
    this.fov = cfg.fovBase;
    this.baseFov = cfg.fovBase;
  }

  /** Sacudida breve (0..1): aterrizajes, agarres, golpes. */
  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Apertura momentánea del FOV (grados): impulsos y lanzamientos. */
  kickFov(degrees: number): void {
    this.fovKick = Math.max(this.fovKick, degrees);
  }

  /** Coloca la cámara detrás de un yaw dado sin transición (al empezar o reaparecer). */
  snapBehind(yaw: number, target: Vec3): void {
    this.yaw = yaw + Math.PI;
    this.initialized = false;
    this.pivot.x = target.x;
    this.pivot.y = target.y + this.cfg.pivotHeight;
    this.pivot.z = target.z;
  }

  update(input: CameraFrameInput, env: CameraEnv, dt: number): void {
    const c = this.cfg;
    const looked = input.lookDX !== 0 || input.lookDY !== 0;
    this.yaw -= input.lookDX * c.sensitivity;
    this.pitch = clamp(this.pitch + input.lookDY * c.sensitivity, c.minPitchDeg * DEG2RAD, c.maxPitchDeg * DEG2RAD);
    this.distance = clamp(this.distance + input.zoom * c.zoomStep, c.minDistance, c.maxDistance);

    // Auto-alineado detrás del jugador cuando se mueve y no se toca el ratón.
    // Planeando se alinea antes y con más fuerza (la vista sigue al rumbo del vuelo).
    this.idleTime = looked ? 0 : this.idleTime + dt;
    if (input.gliding && this.idleTime > 0.4) {
      this.yaw = dampAngle(this.yaw, input.moveYaw + Math.PI, c.glideAlignSharpness, dt);
      this.pitch = damp(this.pitch, 0.12, 1.5, dt);
    } else if (input.moving && this.idleTime > c.autoAlignDelay) {
      this.yaw = dampAngle(this.yaw, input.moveYaw + Math.PI, c.autoAlignSharpness, dt);
    }
    const modeTarget = input.gliding ? c.glideDistanceBonus : input.climbing ? 1.2 : 0;
    this.modeDistance = damp(this.modeDistance, modeTarget, 2.5, dt);
    const wanted = this.distance + this.modeDistance;

    // Pivote suavizado (sigue al jugador sin tirones al aterrizar).
    const tx = input.target.x;
    const ty = input.target.y + c.pivotHeight;
    const tz = input.target.z;
    if (!this.initialized) {
      this.pivot.x = tx;
      this.pivot.y = ty;
      this.pivot.z = tz;
      this.currentDistance = this.distance;
      this.initialized = true;
    } else {
      this.pivot.x = damp(this.pivot.x, tx, c.followSharpness, dt);
      this.pivot.y = damp(this.pivot.y, ty, c.followSharpness * 0.6, dt);
      this.pivot.z = damp(this.pivot.z, tz, c.followSharpness, dt);
    }

    // Desplazamiento de hombro (a la derecha de la vista).
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const px = this.pivot.x + rx * c.shoulderOffset;
    const py = this.pivot.y;
    const pz = this.pivot.z + rz * c.shoulderOffset;

    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * cp;

    const blocked = Math.min(
      env.raycastColliders(px, py, pz, dx, dy, dz, wanted + c.collisionPadding),
      raymarchTerrain(env, px, py, pz, dx, dy, dz, wanted + c.collisionPadding),
    );
    const allowed = Math.max(c.minDistance * 0.4, Math.min(wanted, blocked - c.collisionPadding));
    // Acercarse al instante (nunca atravesar), alejarse con suavidad.
    this.currentDistance = allowed < this.currentDistance ? allowed : damp(this.currentDistance, allowed, c.recoverSharpness, dt);
    // El zoom manual se aplica con su propia suavidad cuando no hay obstáculo.
    if (allowed >= wanted) this.currentDistance = damp(this.currentDistance, wanted, c.zoomSharpness, dt);

    this.position.x = px + dx * this.currentDistance;
    this.position.y = py + dy * this.currentDistance;
    this.position.z = pz + dz * this.currentDistance;
    const floor = env.terrainHeight(this.position.x, this.position.z) + 0.35;
    if (this.position.y < floor) this.position.y = floor;

    this.lookAt.x = px;
    this.lookAt.y = py;
    this.lookAt.z = pz;

    const speedK = clamp((input.speed - 5) / 15, 0, 1);
    this.fovKick = damp(this.fovKick, 0, 5, dt);
    this.baseFov = damp(this.baseFov, c.fovBase + c.fovSpeedBonus * speedK, 4, dt);
    this.fov = this.baseFov + this.fovKick;

    // Sacudida: ruido suave que se apaga rápido.
    this.shake = damp(this.shake, 0, 6, dt);
    this.shakeT += dt * 40;
    const a = this.shake * this.shake * 0.25;
    this.shakeOffset.x = Math.sin(this.shakeT * 1.3) * a;
    this.shakeOffset.y = Math.sin(this.shakeT * 1.7 + 1) * a;
    this.shakeOffset.z = Math.sin(this.shakeT * 1.1 + 2) * a;
  }

  /** Dirección "adelante" de la cámara en el plano XZ. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }
}

/** Primer punto del rayo que queda bajo el terreno (+margen), por marcha y bisección. */
export function raymarchTerrain(env: CameraEnv, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
  const steps = 20;
  const margin = 0.25;
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (maxDist * i) / steps;
    const x = ox + dx * t;
    const z = oz + dz * t;
    if (oy + dy * t < env.terrainHeight(x, z) + margin) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        if (oy + dy * mid < env.terrainHeight(ox + dx * mid, oz + dz * mid) + margin) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    prevT = t;
  }
  return Infinity;
}
