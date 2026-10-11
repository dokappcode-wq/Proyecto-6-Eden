import type * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Renderer } from '../core/Renderer';
import type { Entity } from '../core/ecs/World';
import { lerp, wrapAngle } from '../core/math';

/**
 * Puente ECS -> Three.js: los Object3D vinculados a entidades siguen su Transform
 * interpolado (paso fijo -> framerate de pantalla). Debe ser el último sistema: dibuja el frame.
 */
export class RenderSystem implements System {
  readonly name = 'render';
  private readonly attached = new Map<Entity, THREE.Object3D>();

  constructor(private readonly renderer: Renderer) {}

  attach(entity: Entity, object: THREE.Object3D): void {
    this.attached.set(entity, object);
    if (!object.parent) this.renderer.scene.add(object);
  }

  render({ world }: GameContext, alpha: number): void {
    for (const [e, obj] of this.attached) {
      const t = world.get(e, 'transform');
      if (!t) {
        // La entidad ya no existe: soltamos su objeto.
        obj.removeFromParent();
        this.attached.delete(e);
        continue;
      }
      obj.position.set(lerp(t.prevX, t.x, alpha), lerp(t.prevY, t.y, alpha), lerp(t.prevZ, t.z, alpha));
      obj.rotation.y = t.prevRotY + wrapAngle(t.rotY - t.prevRotY) * alpha;
    }
    this.renderer.draw();
  }
}
