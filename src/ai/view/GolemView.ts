import * as THREE from 'three';
import { createRng } from '../../core/math';
import type { EnemyDef } from '../../data/schemas';
import { makeRockGeometry } from '../../world/props/kit';
import type { Brain } from '../brain';
import { disposeTree, Overhead, type EnemyView } from './Overhead';

export const GOLEM_DEATH_SECONDS = 2.2;
const mossMat = new THREE.MeshStandardMaterial({ color: '#4f7a34', roughness: 1, flatShading: true });

interface Piece {
  obj: THREE.Object3D;
  /** Posición/rotación montado (local al cuerpo) y en el montón (dormido). */
  built: THREE.Vector3;
  pile: THREE.Vector3;
  pileRot: THREE.Euler;
  /** Velocidad al desmoronarse. */
  fall: THREE.Vector3;
}

/**
 * Golem de roca cubierto de musgo con un cristal cian como punto débil.
 * Dormido es un montón de rocas indistinguible del paisaje; al despertar las piezas
 * se recomponen. Golpes muy marcados (brazos arriba antes del golpe), rodillas en
 * tierra al recibir un flechazo en el cristal, y se desmorona al morir.
 */
export class GolemView implements EnemyView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly crystal: THREE.Mesh;
  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly rockMat: THREE.MeshStandardMaterial;
  private readonly pieces: Piece[] = [];
  private readonly overhead: Overhead;
  private readonly s: number;
  private t = 0;
  private assembled = 0;

  constructor(def: EnemyDef) {
    this.root.name = `enemy_${def.id}`;
    const gd = def.golem;
    const s = def.height / 2.6;
    this.s = s;
    const rng = createRng(def.id.length * 977 + def.hp);
    this.rockMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.95, flatShading: true });
    this.root.add(this.body);
    const rock = (w: number, h: number, d: number) => {
      const m = new THREE.Mesh(makeRockGeometry(Math.floor(rng() * 1000), 1), this.rockMat);
      m.scale.set(w * s, h * s, d * s);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    this.torso = rock(0.95, 0.85, 0.7);
    this.torso.position.y = 1.55 * s;
    this.head = rock(0.42, 0.36, 0.4);
    this.head.position.y = 2.32 * s;
    this.legL = rock(0.36, 0.55, 0.36);
    this.legR = rock(0.36, 0.55, 0.36);
    this.legL.position.set(-0.4 * s, 0.5 * s, 0);
    this.legR.position.set(0.4 * s, 0.5 * s, 0);
    this.body.add(this.torso, this.head, this.legL, this.legR);
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(side * 1.05 * s, 1.95 * s, 0);
      const upper = rock(0.36, 0.5, 0.36);
      upper.position.y = -0.35 * s;
      const fist = rock(0.5, 0.45, 0.5);
      fist.position.y = -1.05 * s;
      arm.add(upper, fist);
      this.body.add(arm);
    }
    // Musgo sobre hombros y cabeza.
    for (const [x, y, z, r] of [
      [0, 2.0, 0, 0.55],
      [0, 2.55, 0, 0.3],
      [-0.9, 2.2, 0, 0.28],
      [0.9, 2.2, 0, 0.28],
    ] as const) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r * s, 7, 5), mossMat);
      m.scale.y = 0.35;
      m.position.set(x * s, y * s, z * s);
      this.body.add(m);
    }
    // Cristal (punto débil).
    this.crystalMat = new THREE.MeshStandardMaterial({ color: '#5ff0ff', emissive: '#1fd6ff', emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.1 });
    const cr = (gd?.crystalRadius ?? 0.3) * 1.1;
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(cr, 0), this.crystalMat);
    const side = gd?.crystalSide ?? 'front';
    const ch = (gd?.crystalHeight ?? 0.6) * def.height;
    this.crystal.position.set(0, ch, side === 'front' ? def.radius * 0.8 : side === 'back' ? -def.radius * 0.8 : 0);
    this.crystal.scale.y = 1.4;
    this.body.add(this.crystal);

    // Posiciones del montón (dormido): todas las piezas por el suelo.
    const parts: THREE.Object3D[] = [this.torso, this.head, this.legL, this.legR, this.armL, this.armR];
    parts.forEach((o, i) => {
      const a = (i / parts.length) * Math.PI * 2 + rng();
      const r = (0.3 + rng() * 0.6) * s;
      this.pieces.push({
        obj: o,
        built: o.position.clone(),
        pile: new THREE.Vector3(Math.cos(a) * r, (o === this.torso ? 0.45 : 0.25) * s, Math.sin(a) * r),
        pileRot: new THREE.Euler(rng() * 2, rng() * 3, rng() * 2),
        fall: new THREE.Vector3(Math.cos(a) * (1 + rng()) * s, (2 + rng() * 2) * s, Math.sin(a) * (1 + rng()) * s),
      });
    });
    this.overhead = new Overhead(def.height, Math.max(1, def.radius), !def.boss);
    this.root.add(this.overhead.group);
  }

  update(b: Brain, def: EnemyDef, deadT: number, dt: number): void {
    this.t += dt;
    this.overhead.update(b, def, dt);
    const s = this.s;
    const gd = def.golem;
    // Grado de montaje: 0 = montón de rocas, 1 = en pie.
    let target = 1;
    if (b.state === 'sleep' && b.wakeT < 0) target = 0;
    else if (b.wakeT >= 0 && gd) target = 1 - b.wakeT / Math.max(0.01, gd.wakeSeconds);
    this.assembled += (target - this.assembled) * Math.min(1, dt * (target > this.assembled ? 4 : 1.2));
    const k = this.assembled;

    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);

    if (deadT >= 0) {
      // Se desmorona: cada pieza sale despedida y se hunde.
      const fallT = Math.min(deadT, 1.2);
      for (const p of this.pieces) {
        p.obj.position.set(p.built.x + p.fall.x * fallT, Math.max(0.2 * s, p.built.y + p.fall.y * fallT - 6 * fallT * fallT) - Math.max(0, deadT - 1.2) * s, p.built.z + p.fall.z * fallT);
        p.obj.rotation.set(p.pileRot.x * fallT, p.pileRot.y * fallT, p.pileRot.z * fallT);
      }
      this.crystalMat.emissiveIntensity = Math.max(0, 1.4 - deadT * 2);
      this.crystal.position.y = Math.max(0.2, this.crystal.position.y - dt * 3);
      return;
    }

    for (const p of this.pieces) {
      p.obj.position.lerpVectors(p.pile, p.built, k);
      p.obj.rotation.set(p.pileRot.x * (1 - k), p.pileRot.y * (1 - k), p.pileRot.z * (1 - k));
    }
    this.crystal.visible = k > 0.6;
    if (k < 0.99) return;

    // Caminar pesado.
    const moving = b.speed > 0.2;
    if (moving) {
      const sw = Math.sin(b.anim * 3.2);
      this.legL.rotation.x = sw * 0.45;
      this.legR.rotation.x = -sw * 0.45;
      this.armL.rotation.x = -sw * 0.3;
      this.armR.rotation.x = sw * 0.3;
      this.body.position.y = Math.abs(Math.cos(b.anim * 3.2)) * 0.06 * s;
      this.body.rotation.z = sw * 0.04;
    } else {
      this.body.position.y = Math.sin(this.t * 1.1) * 0.03 * s;
    }

    // Cristal: pulsa; de rodillas parpadea (¡ahora!).
    const base = b.kneel ? 2.4 + Math.abs(Math.sin(this.t * 9)) * 2 : 1.2 + Math.sin(this.t * 2) * 0.3;
    this.crystalMat.emissiveIntensity = base;

    if (b.kneel) {
      this.body.position.y = -0.55 * s;
      this.body.rotation.x = 0.45;
      this.legL.rotation.x = -1.3;
      this.legR.rotation.x = -1.3;
      this.armL.rotation.x = -0.3;
      this.armR.rotation.x = -0.3;
      this.head.rotation.x = 0.4;
      return;
    }
    if (b.roarT > 0) {
      this.armL.rotation.z = -1.2;
      this.armR.rotation.z = 1.2;
      this.head.rotation.x = -0.5;
      this.body.position.x = Math.sin(this.t * 40) * 0.05 * s;
      return;
    }
    if (b.stunT > 0) {
      this.body.rotation.z = Math.sin(this.t * 6) * 0.08;
      return;
    }

    const a = b.attack;
    if (!a) return;
    const p = a.phase === 'windup' ? Math.min(1, a.t / Math.max(0.01, a.def.windup)) : 1;
    switch (a.def.kind) {
      case 'slam':
        // Brazos arriba (aviso claro) y golpe a dos manos.
        this.armL.rotation.x = a.phase === 'windup' ? -3 * p : -0.9;
        this.armR.rotation.x = a.phase === 'windup' ? -3 * p : -0.9;
        this.body.rotation.x = a.phase === 'windup' ? -0.15 * p : 0.35;
        break;
      case 'swing':
        this.armR.rotation.z = a.phase === 'windup' ? 1.6 * p : -0.6;
        this.armR.rotation.x = -1.2;
        this.body.rotation.y = a.phase === 'windup' ? 0.6 * p : -0.7;
        break;
      case 'shockwave':
        this.legR.rotation.x = a.phase === 'windup' ? -1.2 * p : 0;
        this.body.position.y = a.phase === 'windup' ? 0.2 * p * s : 0;
        this.armL.rotation.z = -0.6;
        this.armR.rotation.z = 0.6;
        break;
      case 'projectile':
        this.armR.rotation.x = a.phase === 'windup' ? -2.8 * p : -0.8;
        break;
      case 'rockfall':
      case 'summon':
        this.armL.rotation.set(-2.9 * p, 0, -0.4 * p);
        this.armR.rotation.set(-2.9 * p, 0, 0.4 * p);
        this.head.rotation.x = -0.5 * p;
        break;
      default:
        this.armR.rotation.x = a.phase === 'windup' ? -1.8 * p : -0.5;
    }
  }

  dispose(): void {
    disposeTree(this.root);
    this.rockMat.dispose();
    this.crystalMat.dispose();
    this.overhead.dispose();
  }
}
