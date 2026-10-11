import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Renderer } from '../core/Renderer';
import type { Entity } from '../core/ecs/World';
import type { Renderable } from '../core/ecs/components';

/**
 * Puente ECS -> Three.js. Crea un Object3D por entidad con `renderable`,
 * lo sincroniza interpolando el Transform y lo libera cuando la entidad desaparece.
 */
export class RenderSystem implements System {
  readonly name = 'render';
  private readonly objects = new Map<Entity, THREE.Mesh>();
  // Geometrías unitarias compartidas: el tamaño va en la escala del mesh.
  private readonly geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(0.5, 24, 16),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  };

  constructor(private readonly renderer: Renderer) {}

  render({ world }: GameContext, alpha: number): void {
    const live = world.query('transform', 'renderable');
    const liveSet = new Set(live);

    for (const [e, mesh] of this.objects) {
      if (!liveSet.has(e)) {
        this.renderer.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.objects.delete(e);
      }
    }

    for (const e of live) {
      const t = world.require(e, 'transform');
      let mesh = this.objects.get(e);
      if (!mesh) {
        mesh = this.createMesh(world.require(e, 'renderable'));
        mesh.name = world.get(e, 'name')?.value ?? `entity_${e}`;
        this.objects.set(e, mesh);
        this.renderer.scene.add(mesh);
      }
      mesh.position.set(lerp(t.prevX, t.x, alpha), lerp(t.prevY, t.y, alpha), lerp(t.prevZ, t.z, alpha));
      mesh.rotation.y = lerp(t.prevRotY, t.rotY, alpha);
    }

    this.renderer.draw();
  }

  private createMesh(r: Renderable): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({
      color: r.color,
      roughness: 0.7,
      emissive: r.emissive ?? '#000000',
      emissiveIntensity: r.emissive ? 0.35 : 0,
    });
    const mesh = new THREE.Mesh(this.geometries[r.shape], material);
    mesh.scale.set(r.size[0], r.size[1], r.size[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
