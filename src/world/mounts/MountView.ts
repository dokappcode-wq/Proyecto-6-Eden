import * as THREE from 'three';
import type { MountKind, MountKindDef } from '../../data/schemas';

/**
 * Montura procedural (cuadrúpedo de primitivas): cuerpo, cuello, cabeza, crin, cola y
 * cuatro patas animadas según la marcha. El bisonte lleva cuernos y joroba; el ciervo, astas.
 */
export class MountView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly neck = new THREE.Group();
  private readonly tail: THREE.Mesh;
  private readonly saddle: THREE.Group;
  private phase = 0;

  constructor(kind: MountKind, def: MountKindDef) {
    const coat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85 });
    const mane = new THREE.MeshStandardMaterial({ color: def.mane, roughness: 0.95 });
    const hoof = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.8 });
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    const tank = kind === 'tank';
    const bodyW = tank ? 0.95 : 0.6;
    const bodyH = tank ? 0.95 : 0.7;
    const bodyL = tank ? 1.9 : 1.7;
    const legH = tank ? 0.85 : 1.05;
    this.root.add(this.body);
    this.body.position.y = legH;
    add(this.body, new THREE.BoxGeometry(bodyW, bodyH, bodyL), coat, 0, bodyH / 2, 0);
    if (tank) add(this.body, new THREE.SphereGeometry(0.62, 10, 8), mane, 0, bodyH + 0.1, 0.45);
    // Cuello y cabeza.
    this.neck.position.set(0, bodyH * 0.8, bodyL / 2 - 0.1);
    this.body.add(this.neck);
    const neckLen = tank ? 0.5 : 0.85;
    const neckMesh = add(this.neck, new THREE.BoxGeometry(0.34, neckLen, 0.38), coat, 0, neckLen / 2, 0.1);
    neckMesh.rotation.x = tank ? 0.9 : 0.5;
    const head = add(this.neck, new THREE.BoxGeometry(0.3, 0.32, 0.62), coat, 0, neckLen * 0.85, tank ? 0.55 : 0.5);
    head.rotation.x = 0.3;
    if (!tank) add(this.neck, new THREE.BoxGeometry(0.08, neckLen * 0.9, 0.22), mane, 0, neckLen * 0.55, -0.08).rotation.x = 0.5;
    if (tank) {
      for (const s of [-1, 1]) {
        const horn = add(this.neck, new THREE.ConeGeometry(0.07, 0.45, 6), new THREE.MeshStandardMaterial({ color: '#e8dcc6' }), s * 0.24, neckLen * 0.95, 0.5);
        horn.rotation.z = -s * 1.1;
      }
    } else if (kind === 'sturdy') {
      for (const s of [-1, 1]) {
        const antler = add(this.neck, new THREE.CylinderGeometry(0.03, 0.04, 0.6, 5), new THREE.MeshStandardMaterial({ color: '#d8c8a8' }), s * 0.15, neckLen * 1.15, 0.38);
        antler.rotation.z = -s * 0.5;
        const tine = add(this.neck, new THREE.CylinderGeometry(0.025, 0.03, 0.3, 5), new THREE.MeshStandardMaterial({ color: '#d8c8a8' }), s * 0.28, neckLen * 1.3, 0.45);
        tine.rotation.x = 0.7;
      }
    } else {
      for (const s of [-1, 1]) add(this.neck, new THREE.ConeGeometry(0.05, 0.16, 4), coat, s * 0.1, neckLen * 1.08, 0.32);
    }
    // Cola.
    this.tail = add(this.body, new THREE.BoxGeometry(0.1, 0.65, 0.1), mane, 0, bodyH * 0.55, -bodyL / 2 - 0.1);
    this.tail.geometry.translate(0, -0.3, 0);
    // Patas (pivote en la cadera).
    for (const [sx, sz] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const leg = new THREE.Group();
      leg.position.set(sx * (bodyW / 2 - 0.1), legH, sz * (bodyL / 2 - 0.22));
      add(leg, new THREE.BoxGeometry(0.17, legH, 0.19), coat, 0, -legH / 2, 0);
      add(leg, new THREE.BoxGeometry(0.2, 0.12, 0.22), hoof, 0, -legH + 0.06, 0.01);
      this.root.add(leg);
      this.legs.push(leg);
    }
    // Silla (visible solo en monturas domadas).
    this.saddle = new THREE.Group();
    add(this.saddle, new THREE.BoxGeometry(bodyW + 0.06, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: '#6b3f22', roughness: 0.7 }), 0, bodyH + 0.04, -0.05);
    add(this.saddle, new THREE.BoxGeometry(bodyW + 0.08, 0.05, 0.08), new THREE.MeshBasicMaterial({ color: '#1fd6ff' }), 0, bodyH + 0.08, 0.26);
    this.saddle.visible = false;
    this.body.add(this.saddle);
    this.root.scale.setScalar(def.size);
  }

  setSaddle(on: boolean): void {
    this.saddle.visible = on;
  }

  /** Altura del asiento sobre el suelo (antes de escalar). */
  static seatHeight(kind: MountKind): number {
    return kind === 'tank' ? 1.85 : 1.75;
  }

  animate(speed: number, buck: number, grazing: boolean, dt: number): void {
    this.phase += dt * (2 + speed * 1.15);
    const amp = Math.min(0.75, speed * 0.09);
    const gallop = speed > 9;
    for (let i = 0; i < 4; i++) {
      const off = gallop ? (i < 2 ? 0 : Math.PI * 0.9) : i === 0 || i === 3 ? 0 : Math.PI;
      this.legs[i].rotation.x = Math.sin(this.phase + off) * amp;
    }
    this.body.rotation.x = -buck * 0.6 + (gallop ? Math.sin(this.phase * 2) * 0.05 : 0);
    this.body.position.y = this.legs[0].position.y + Math.abs(Math.sin(this.phase)) * amp * 0.12;
    this.neck.rotation.x = grazing ? 1.1 : buck * 0.4 + Math.sin(this.phase) * amp * 0.15;
    this.tail.rotation.x = 0.4 + Math.sin(this.phase * 0.7) * 0.2 + amp * 0.6;
  }
}
