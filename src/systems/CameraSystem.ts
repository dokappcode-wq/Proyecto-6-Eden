import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import { lerp, smoothstep } from '../core/math';
import type { CameraController, CameraEnv } from '../player/CameraController';

export interface CinematicShot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  lookFrom: THREE.Vector3;
  lookTo: THREE.Vector3;
  seconds: number;
  fov?: number;
}

/**
 * Aplica el CameraController a la cámara de Three.js cada frame (no a paso fijo:
 * la cámara debe ser tan fluida como la pantalla). En el título hace un travelling lento
 * y puede reproducir cinemáticas cortas (apertura de la salida del valle).
 */
export class CameraSystem implements System {
  readonly name = 'camera';
  private readonly target = { x: 0, y: 0, z: 0 };
  private cinematic: { id: string; shots: CinematicShot[]; index: number; t: number } | null = null;
  private readonly look = new THREE.Vector3();

  constructor(
    private readonly playerEntity: Entity,
    private readonly controller: CameraController,
    private readonly env: CameraEnv,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly titleOrbit: { center: THREE.Vector3; lookAt: THREE.Vector3; radius: number; height: number },
  ) {}

  /** Reproduce una secuencia de planos; bloquea el control del jugador mientras dura. */
  playCinematic(ctx: GameContext, id: string, shots: CinematicShot[]): void {
    this.cinematic = { id, shots, index: 0, t: 0 };
    ctx.bus.emit('camera:cinematic', { id, active: true });
  }

  get inCinematic(): boolean {
    return this.cinematic !== null;
  }

  render(ctx: GameContext, alpha: number): void {
    const { input, world, time } = ctx;
    // Se consume siempre para que no se acumule movimiento de ratón fuera de partida.
    const look = input.consumeLook();
    const zoom = input.consumeWheel();

    if (ctx.session.mode !== 'play') {
      const a = time.elapsed * 0.035 + 2.2;
      const o = this.titleOrbit;
      this.camera.position.set(o.center.x + Math.cos(a) * o.radius, o.center.y + o.height, o.center.z + Math.sin(a) * o.radius);
      this.camera.lookAt(o.lookAt);
      this.setFov(55);
      return;
    }

    if (this.cinematic) {
      const c = this.cinematic;
      const shot = c.shots[c.index];
      c.t += time.frameDt;
      const k = smoothstep(0, 1, Math.min(1, c.t / shot.seconds));
      this.camera.position.lerpVectors(shot.from, shot.to, k);
      this.look.lerpVectors(shot.lookFrom, shot.lookTo, k);
      this.camera.lookAt(this.look);
      this.setFov(shot.fov ?? 55);
      if (c.t >= shot.seconds) {
        c.index++;
        c.t = 0;
        if (c.index >= c.shots.length) {
          this.cinematic = null;
          ctx.bus.emit('camera:cinematic', { id: c.id, active: false });
        }
      }
      return;
    }

    const t = world.require(this.playerEntity, 'transform');
    const ch = world.require(this.playerEntity, 'character');
    const p = world.require(this.playerEntity, 'player');
    this.target.x = lerp(t.prevX, t.x, alpha);
    this.target.y = lerp(t.prevY, t.y, alpha);
    this.target.z = lerp(t.prevZ, t.z, alpha);
    const speed = ch.mode === 'glide' ? Math.hypot(ch.vx, ch.vz) + Math.max(0, -ch.vy) * 0.5 : Math.hypot(ch.vx, ch.vz);
    this.controller.update(
      {
        lookDX: look.dx,
        lookDY: look.dy,
        zoom,
        target: this.target,
        speed,
        moveYaw: ch.yaw,
        moving: p.control === 'free' && Math.hypot(ch.vx, ch.vz) > 0.5 && ch.mode !== 'climb',
        gliding: ch.mode === 'glide',
        climbing: ch.mode === 'climb',
      },
      this.env,
      time.frameDt,
    );
    const c = this.controller;
    this.camera.position.set(c.position.x + c.shakeOffset.x, c.position.y + c.shakeOffset.y, c.position.z + c.shakeOffset.z);
    this.camera.lookAt(c.lookAt.x, c.lookAt.y, c.lookAt.z);
    this.setFov(c.fov);
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
