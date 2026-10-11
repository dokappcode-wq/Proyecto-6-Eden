import * as THREE from 'three';
import { clamp, damp } from '../core/math';

export interface PlayerAnimInput {
  /** Velocidad horizontal (m/s). */
  speed: number;
  jogSpeed: number;
  grounded: boolean;
  floating: boolean;
  sliding: boolean;
  crouch: boolean;
  vy: number;
  /** Sentado dentro de la cápsula. */
  seated: boolean;
}

/**
 * Personaje procedural de primitivas (sin assets) con animación por código:
 * ciclo de paso según velocidad, pose aérea, agachado, flotar y squash al aterrizar.
 */
export class PlayerVisual {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Group;
  private readonly head: THREE.Mesh;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private phase = 0;
  private squash = 0;
  private squashVel = 0;
  private crouchK = 0;
  private airK = 0;

  constructor() {
    this.root.name = 'player';
    this.root.add(this.body);
    const suit = new THREE.MeshStandardMaterial({ color: '#5a8199', roughness: 0.7 });
    const suitDark = new THREE.MeshStandardMaterial({ color: '#3a4d5a', roughness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: '#e0892e', roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: '#d9a982', roughness: 0.8 });
    const hair = new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 0.9 });

    const part = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Piernas (pivote en la cadera).
    const makeLeg = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.12, 0.92, 0);
      g.add(part(new THREE.BoxGeometry(0.17, 0.82, 0.2), suitDark, 0, -0.41, 0));
      g.add(part(new THREE.BoxGeometry(0.19, 0.14, 0.3), accent, 0, -0.86, 0.04));
      this.body.add(g);
      return g;
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.92;
    this.body.add(this.torso);
    this.torso.add(part(new THREE.BoxGeometry(0.46, 0.6, 0.27), suit, 0, 0.33, 0));
    this.torso.add(part(new THREE.BoxGeometry(0.48, 0.07, 0.29), accent, 0, 0.12, 0));
    // Mochila (el planeador se acoplará aquí en la Fase 2).
    this.torso.add(part(new THREE.BoxGeometry(0.34, 0.42, 0.14), suitDark, 0, 0.36, -0.2));
    this.torso.add(part(new THREE.BoxGeometry(0.06, 0.36, 0.02), accent, 0, 0.36, -0.28));
    // Bufanda.
    this.torso.add(part(new THREE.BoxGeometry(0.3, 0.08, 0.3), accent, 0, 0.64, 0));

    this.head = part(new THREE.SphereGeometry(0.13, 16, 12), skin, 0, 0.8, 0.01);
    this.torso.add(this.head);
    this.head.add(part(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.015, -0.01));

    const makeArm = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.3, 0.58, 0);
      g.add(part(new THREE.BoxGeometry(0.12, 0.58, 0.13), suit, 0, -0.27, 0));
      g.add(part(new THREE.BoxGeometry(0.11, 0.1, 0.12), skin, 0, -0.6, 0));
      this.torso.add(g);
      return g;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);
  }

  /** Impulso de aterrizaje (0..1) para el squash & stretch. */
  land(intensity: number): void {
    this.squashVel -= clamp(intensity, 0, 1) * 7;
  }

  jump(): void {
    this.squashVel += 4;
  }

  animate(a: PlayerAnimInput, dt: number): void {
    const run = clamp(a.speed / a.jogSpeed, 0, 1.4);
    this.crouchK = damp(this.crouchK, a.crouch || a.seated ? 1 : 0, 12, dt);
    this.airK = damp(this.airK, !a.grounded && !a.floating && !a.seated ? 1 : 0, 14, dt);

    // Fase de paso proporcional a la distancia recorrida.
    if (a.grounded && !a.sliding) this.phase += a.speed * dt * (a.crouch ? 3.2 : 2.3);
    const swing = Math.sin(this.phase) * 0.75 * Math.min(run, 1) * (1 - this.airK);
    const bob = Math.abs(Math.sin(this.phase)) * 0.06 * Math.min(run, 1) * (1 - this.airK);

    // Muelle amortiguado para squash/stretch.
    this.squashVel += (-this.squash * 160 - this.squashVel * 14) * dt;
    this.squash += this.squashVel * dt;
    const sq = clamp(this.squash, -0.3, 0.25);
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

    const swim = a.floating ? 1 : 0;
    this.body.position.y = bob - this.crouchK * 0.28 - swim * 0.5;

    // Piernas: paso, recogidas en el aire, flexionadas al agacharse.
    const airLegs = this.airK * (a.vy > 0 ? 0.6 : 0.3);
    this.legL.rotation.x = swim ? Math.sin(this.phase * 2 + performance.now() * 0.006) * 0.4 : swing - airLegs - this.crouchK * 0.9;
    this.legR.rotation.x = swim ? -this.legL.rotation.x : -swing + airLegs * 0.2 - this.crouchK * 0.9;

    // Brazos opuestos a las piernas; arriba en el aire para equilibrar.
    this.armL.rotation.x = -swing * 0.9 - this.airK * 0.6 - swim * 1.6;
    this.armR.rotation.x = swing * 0.9 - this.airK * 0.6 - swim * 1.6;
    this.armL.rotation.z = -0.08 - this.airK * 0.5 - swim * 0.3;
    this.armR.rotation.z = 0.08 + this.airK * 0.5 + swim * 0.3;

    // Inclinación del torso hacia delante al correr y al agacharse.
    this.torso.rotation.x = run * 0.14 + this.crouchK * 0.35 + (a.sliding ? -0.3 : 0);
    this.head.rotation.x = -this.torso.rotation.x * 0.6;
  }
}

/** Pool de partículas de polvo (sprites) para saltos y aterrizajes. */
export class DustPool {
  readonly group = new THREE.Group();
  private readonly items: { s: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number }[] = [];
  private next = 0;

  constructor(size = 32) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
    g.addColorStop(0, 'rgba(230,220,200,0.8)');
    g.addColorStop(1, 'rgba(230,220,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < size; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.group.add(s);
      this.items.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
    }
  }

  burst(x: number, y: number, z: number, count: number, strength: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const sp = (0.8 + Math.random() * 0.8) * strength;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 0.3 + Math.random() * 0.5;
      p.max = 0.45 + Math.random() * 0.3;
      p.life = p.max;
      p.s.position.set(x + Math.cos(a) * 0.2, y + 0.1, z + Math.sin(a) * 0.2);
      p.s.visible = true;
    }
  }

  update(dt: number): void {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      const k = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.vx *= 1 - 3 * dt;
      p.vz *= 1 - 3 * dt;
      p.s.scale.setScalar(0.3 + k * 0.9);
      p.s.material.opacity = (1 - k) * 0.7;
    }
  }
}
