import type * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import { lerp } from '../core/math';
import type { CameraController, CameraEnv } from '../player/CameraController';

/**
 * Aplica el CameraController a la cámara de Three.js cada frame (no a paso fijo:
 * la cámara debe ser tan fluida como la pantalla). En el título hace un travelling lento.
 */
export class CameraSystem implements System {
  readonly name = 'camera';
  private readonly target = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly playerEntity: Entity,
    private readonly controller: CameraController,
    private readonly env: CameraEnv,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly titleOrbit: { center: THREE.Vector3; lookAt: THREE.Vector3; radius: number; height: number },
  ) {}

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

    const t = world.require(this.playerEntity, 'transform');
    const ch = world.require(this.playerEntity, 'character');
    const p = world.require(this.playerEntity, 'player');
    this.target.x = lerp(t.prevX, t.x, alpha);
    this.target.y = lerp(t.prevY, t.y, alpha);
    this.target.z = lerp(t.prevZ, t.z, alpha);
    const speed = Math.hypot(ch.vx, ch.vz);
    this.controller.update(
      {
        lookDX: look.dx,
        lookDY: look.dy,
        zoom,
        target: this.target,
        speed,
        moveYaw: ch.yaw,
        moving: p.control === 'free' && speed > 0.5,
      },
      this.env,
      time.frameDt,
    );
    const c = this.controller;
    this.camera.position.set(c.position.x, c.position.y, c.position.z);
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
