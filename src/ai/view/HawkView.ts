import * as THREE from 'three';
import type { EnemyDef } from '../../data/schemas';
import type { Brain } from '../brain';
import { bankAngle } from '../hawk';
import { disposeTree, Overhead, type EnemyView } from './Overhead';

export const HAWK_DEATH_SECONDS = 2.5;
const beakMat = new THREE.MeshStandardMaterial({ color: '#e0b43a', roughness: 0.5 });
const bellyMat = new THREE.MeshStandardMaterial({ color: '#e6d6b8', roughness: 0.9 });

/**
 * Halcón cazador: cuerpo, cabeza con pico, cola y dos alas que aletean, planean,
 * se pliegan en el picado y se abren al chillar antes de atacar.
 */
export class HawkView implements EnemyView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wingL = new THREE.Group();
  private readonly wingR = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly overhead: Overhead;
  private prevYaw = 0;
  private bank = 0;
  private t = Math.random() * 5;

  constructor(def: EnemyDef) {
    this.root.name = `enemy_${def.id}`;
    const s = def.radius * 2;
    this.mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
    this.root.add(this.body);
    this.body.scale.setScalar(s);
    const torso = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6).rotateX(Math.PI / 2), this.mat);
    torso.castShadow = true;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bellyMat);
    belly.scale.set(1, 0.8, 1.8);
    belly.position.set(0, -0.04, 0.05);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), this.mat);
    head.position.set(0, 0.06, 0.45);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 4).rotateX(Math.PI / 2), beakMat);
    beak.position.set(0, 0.03, 0.6);
    const tail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.35), new THREE.Vector3(-0.2, 0, -0.75), new THREE.Vector3(0.2, 0, -0.75)]), this.mat);
    tail.geometry.computeVertexNormals();
    this.body.add(torso, belly, head, beak, tail);
    for (const [w, side] of [
      [this.wingL, -1],
      [this.wingR, 1],
    ] as const) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0.2),
        new THREE.Vector3(side * 1.25, 0, -0.05),
        new THREE.Vector3(0, 0, -0.25),
        new THREE.Vector3(side * 1.25, 0, -0.05),
        new THREE.Vector3(side * 0.9, 0, -0.45),
        new THREE.Vector3(0, 0, -0.25),
      ]);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.mat);
      m.castShadow = true;
      w.add(m);
      w.position.set(side * 0.1, 0.05, 0.05);
      this.body.add(w);
    }
    this.overhead = new Overhead(def.height, 0.9, true);
    this.root.add(this.overhead.group);
  }

  update(b: Brain, def: EnemyDef, deadT: number, dt: number): void {
    this.t += dt;
    this.overhead.update(b, def, dt);
    this.bank += (bankAngle(this.prevYaw, b.yaw, dt) - this.bank) * Math.min(1, dt * 4);
    this.prevYaw = b.yaw;
    const pitch = Math.atan2(-b.vy, Math.hypot(b.vx, b.vz) + 0.01);
    this.body.rotation.set(Math.max(-1.2, Math.min(1.3, pitch)), 0, -this.bank);
    let flap: number;
    let fold = 0;
    if (deadT >= 0) {
      this.body.rotation.z += deadT * 9;
      flap = 0.3;
      fold = 0.6;
    } else if (b.attack?.phase === 'active' && !b.attack.hit) {
      // Picado: alas plegadas.
      flap = 0;
      fold = 1;
    } else if (b.attack?.phase === 'windup') {
      // Chillido: aleteo rápido y amplio.
      flap = Math.sin(this.t * 22) * 0.9;
    } else if (b.vy > 1) {
      flap = Math.sin(this.t * 12) * 0.7;
    } else {
      // Planeo con algún aleteo ocasional.
      flap = Math.sin(this.t * 9) * 0.6 * Math.max(0, Math.sin(this.t * 0.8 + b.homeX));
    }
    this.wingL.rotation.set(0, fold * 1.1, flap);
    this.wingR.rotation.set(0, -fold * 1.1, -flap);
  }

  dispose(): void {
    disposeTree(this.root);
    this.mat.dispose();
    this.overhead.dispose();
  }
}
