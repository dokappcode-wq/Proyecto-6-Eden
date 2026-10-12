import * as THREE from 'three';
import { buildWeaponModel } from '../../combat/WeaponModels';
import type { EnemyDef } from '../../data/schemas';
import type { Brain } from '../brain';
import { disposeTree, Overhead, type EnemyView } from './Overhead';

export const GOBLIN_DEATH_SECONDS = 1.4;
const BASE_HEIGHT = 1.45;

const clothMat = new THREE.MeshStandardMaterial({ color: '#6a4a32', roughness: 0.95 });
const boneMat = new THREE.MeshStandardMaterial({ color: '#e9e1c8', roughness: 0.7 });
const hornMat = new THREE.MeshStandardMaterial({ color: '#d8c9a0', roughness: 0.6 });
const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffcf4a' });

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * Goblin low-poly: cabeza grande con orejas largas, taparrabos y arma en la mano.
 * Animación procedural según estado: andar/correr, guardia, sentado junto al fuego,
 * dormido, tocando el cuerno, preparando/lanzando golpes, tensando el arco, huyendo y muerte.
 */
export class GoblinView implements EnemyView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly horn: THREE.Mesh;
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly overhead: Overhead;
  private readonly bow: boolean;

  constructor(def: EnemyDef) {
    this.root.name = `enemy_${def.id}`;
    const s = def.height / BASE_HEIGHT;
    this.skin = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85, flatShading: true });
    this.body.scale.setScalar(s);
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.62;
    this.hips.add(this.torso);
    // Torso encorvado y taparrabos.
    this.torso.add(part(new THREE.BoxGeometry(0.42, 0.42, 0.28), this.skin, 0, 0.24, 0));
    this.torso.add(part(new THREE.BoxGeometry(0.46, 0.16, 0.32), clothMat, 0, 0.02, 0));
    this.torso.rotation.x = 0.18;
    // Cabeza: cráneo, nariz, orejas, ojos.
    this.head.position.set(0, 0.56, 0.04);
    this.torso.add(this.head);
    this.head.add(part(new THREE.DodecahedronGeometry(0.2, 0), this.skin, 0, 0.12, 0));
    this.head.add(part(new THREE.ConeGeometry(0.05, 0.18, 4).rotateX(Math.PI / 2), this.skin, 0, 0.1, 0.24));
    for (const side of [-1, 1]) {
      const ear = part(new THREE.ConeGeometry(0.06, 0.34, 4), this.skin, side * 0.24, 0.17, -0.02);
      ear.rotation.z = -side * 1.25;
      this.head.add(ear);
      this.head.add(part(new THREE.SphereGeometry(0.03, 6, 4), eyeMat, side * 0.08, 0.16, 0.17));
    }
    if (def.variant === 'leader') {
      // Casco de hueso con cuernos.
      this.head.add(part(new THREE.SphereGeometry(0.21, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), boneMat, 0, 0.17, 0));
      for (const side of [-1, 1]) {
        const h = part(new THREE.ConeGeometry(0.05, 0.3, 5), boneMat, side * 0.16, 0.38, 0);
        h.rotation.z = -side * 0.5;
        this.head.add(h);
      }
    }
    // Brazos y piernas (grupos pivotando en hombro/cadera).
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(side * 0.27, 0.4, 0);
      arm.add(part(new THREE.BoxGeometry(0.11, 0.5, 0.11).translate(0, -0.25, 0), this.skin));
      this.torso.add(arm);
    }
    for (const [leg, side] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as const) {
      leg.position.set(side * 0.12, 0, 0);
      leg.add(part(new THREE.BoxGeometry(0.13, 0.62, 0.13).translate(0, -0.31, 0), this.skin));
      leg.add(part(new THREE.BoxGeometry(0.14, 0.06, 0.22), clothMat, 0, -0.6, 0.04));
      this.hips.add(leg);
    }
    // Arma en la mano derecha.
    const g = def.goblin;
    this.bow = g?.weapon.kind === 'bow';
    if (g) {
      const w = buildWeaponModel(g.weapon.kind, g.weapon.length, g.weapon.color).group;
      w.position.set(0, -0.48, 0.04);
      if (this.bow) {
        w.rotation.set(0, Math.PI / 2, 0);
        this.armL.add(w);
      } else {
        w.rotation.x = Math.PI / 2;
        this.armR.add(w);
      }
    }
    // Cuerno de alarma (solo visible al tocarlo).
    this.horn = part(new THREE.ConeGeometry(0.07, 0.42, 6).rotateX(-Math.PI / 2), hornMat, 0, -0.45, 0.2);
    this.horn.visible = false;
    this.armL.add(this.horn);

    this.overhead = new Overhead(def.height, 0.9, !def.boss);
    this.root.add(this.overhead.group);
  }

  update(b: Brain, def: EnemyDef, deadT: number, dt: number): void {
    this.overhead.update(b, def, dt);
    const t = b.anim;
    const body = this.body;
    // Reinicio de la pose.
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    this.hips.position.y = 0.62;
    this.torso.rotation.set(0.18, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.horn.visible = false;

    if (deadT >= 0) {
      // Cae de espaldas y se hunde.
      const k = Math.min(1, deadT / 0.5);
      body.rotation.x = -k * 1.45;
      body.position.y = -Math.max(0, deadT - 0.9) * 1.2;
      this.armL.rotation.z = -k;
      this.armR.rotation.z = k;
      return;
    }

    if (b.state === 'sleep') {
      // Tumbado de lado, respirando.
      body.rotation.z = Math.PI / 2;
      body.position.set(0, 0.2, 0);
      this.torso.rotation.x = 0.1 + Math.sin(t * 1.2) * 0.03;
      this.legL.rotation.x = -0.6;
      this.legR.rotation.x = -0.4;
      this.armR.rotation.x = -1;
      return;
    }

    const a = b.attack;
    const moving = b.speed > 0.3 && b.grounded;
    if (moving) {
      const run = b.speed > def.moveSpeed + 0.4;
      const amp = run ? 0.9 : 0.55;
      const sw = Math.sin(t * (run ? 9 : 6.5));
      this.legL.rotation.x = sw * amp;
      this.legR.rotation.x = -sw * amp;
      this.armL.rotation.x = -sw * amp * 0.7;
      this.armR.rotation.x = sw * amp * 0.7;
      this.hips.position.y = 0.62 + Math.abs(Math.cos(t * (run ? 9 : 6.5))) * 0.05;
      this.torso.rotation.x = run ? 0.42 : 0.24;
    } else if (b.activity === 'cook' && b.state === 'idle') {
      // Sentado junto a la hoguera.
      this.hips.position.y = 0.3;
      this.legL.rotation.x = -1.4;
      this.legR.rotation.x = -1.4;
      this.armR.rotation.x = -0.6 + Math.sin(t * 1.4) * 0.2;
      this.head.rotation.x = 0.2;
    } else {
      // Respiración.
      this.torso.rotation.x = 0.18 + Math.sin(t * 2) * 0.03;
      if (this.bow) this.armL.rotation.x = -0.3;
    }

    if (b.activity === 'horn') {
      this.horn.visible = true;
      this.armL.rotation.set(-2.4, 0, 0.5);
      this.head.rotation.x = -0.4;
      this.torso.rotation.x = -0.15;
    }
    if (b.state === 'flee') {
      this.armL.rotation.x = -2.6;
      this.armR.rotation.x = -2.6;
    }
    if (b.stunT > 0) {
      this.head.rotation.z = Math.sin(t * 12) * 0.25;
      this.torso.rotation.x = -0.2;
    }
    if (b.state === 'suspicious') this.head.rotation.y = Math.sin(t * 1.5) * 0.4;

    if (a) {
      const k = a.phase === 'windup' ? Math.min(1, a.t / Math.max(0.01, a.def.windup)) : 1;
      const kind = a.def.kind;
      if (kind === 'projectile' && this.bow) {
        // Tensar: brazo izquierdo extendido, derecho atrás.
        this.armL.rotation.set(-1.55, 0.25, 0);
        this.armR.rotation.set(-1.45 + (a.phase === 'windup' ? -0.1 * k : 0), -0.6 * k, 0);
        this.torso.rotation.y = 0.35;
      } else if (kind === 'projectile') {
        // Lanzar piedra: brazo atrás y adelante.
        this.armR.rotation.x = a.phase === 'windup' ? -2.6 * k : -0.6;
      } else if (kind === 'thrust') {
        this.armR.rotation.x = a.phase === 'windup' ? -1.2 + 0.5 * k : -1.6;
        this.armR.position.z = a.phase === 'active' ? 0.25 : 0;
        this.torso.rotation.x = a.phase === 'active' ? 0.45 : 0.1;
      } else if (kind === 'lunge') {
        this.legL.rotation.x = -0.8;
        this.legR.rotation.x = 0.5;
        this.armR.rotation.x = a.phase === 'windup' ? -2.6 * k : -0.4;
        this.hips.position.y = a.phase === 'windup' ? 0.62 - 0.18 * k : 0.62;
      } else if (kind === 'slam') {
        this.armL.rotation.x = a.phase === 'windup' ? -2.9 * k : -0.2;
        this.armR.rotation.x = a.phase === 'windup' ? -2.9 * k : -0.2;
        this.torso.rotation.x = a.phase === 'windup' ? -0.3 * k : 0.6;
      } else {
        // Golpe con el arma (o patada del arquero).
        const back = -2.2 * k;
        this.armR.rotation.x = a.phase === 'windup' ? back : a.phase === 'active' ? 0.6 : 0.2;
        this.armR.rotation.z = a.phase === 'windup' ? 0.4 * k : -0.3;
        this.torso.rotation.y = a.phase === 'windup' ? 0.5 * k : -0.4;
      }
    } else if (this.armR.position.z !== 0) {
      this.armR.position.z = 0;
    }
  }

  dispose(): void {
    disposeTree(this.root);
    this.skin.dispose();
    this.overhead.dispose();
  }
}
