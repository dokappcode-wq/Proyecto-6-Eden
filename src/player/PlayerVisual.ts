import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { MoveMode } from './CharacterController';

export interface PlayerAnimInput {
  mode: MoveMode;
  /** Velocidad horizontal (m/s). */
  speed: number;
  jogSpeed: number;
  sprinting: boolean;
  sliding: boolean;
  crouch: boolean;
  vy: number;
  /** Sentado dentro de la cápsula. */
  seated: boolean;
  climbMoving: boolean;
  ledgePhase: 'contact' | 'boost' | 'mantle' | null;
  glideBank: number;
  glideDive: number;
  /** 0..1 progreso del despliegue del planeador (0 = plegado). */
  glideDeploy: number;
  underwater: boolean;
}

const CYAN = new THREE.Color('#1fd6ff');

/**
 * Personaje procedural de primitivas (sin assets) con animación por código y el planeador ancestral.
 * Las estelas de las alas viven en espacio mundo (`trails`), fuera de la jerarquía del personaje.
 */
export class PlayerVisual {
  readonly root = new THREE.Group();
  readonly trails = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Group;
  private readonly head: THREE.Mesh;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly gliderPack: THREE.Group;
  private readonly wings: THREE.Group;
  private readonly wingL: THREE.Group;
  private readonly wingR: THREE.Group;
  private readonly tipL = new THREE.Object3D();
  private readonly tipR = new THREE.Object3D();
  private readonly trailL: WingTrail;
  private readonly trailR: WingTrail;
  private readonly wingGlow: THREE.MeshBasicMaterial;
  private phase = 0;
  private climbPhase = 0;
  private squash = 0;
  private squashVel = 0;
  private crouchK = 0;
  private airK = 0;
  private glideK = 0;
  private swimK = 0;
  private rollT = -1;
  private time = 0;

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
    this.torso.add(part(new THREE.BoxGeometry(0.34, 0.42, 0.14), suitDark, 0, 0.36, -0.2));
    this.torso.add(part(new THREE.BoxGeometry(0.06, 0.36, 0.02), accent, 0, 0.36, -0.28));
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

    // --- Planeador ancestral: cilindro plegado en la mochila + alas de tela con borde cian.
    const ancestral = new THREE.MeshStandardMaterial({ color: '#3d4c58', roughness: 0.5, metalness: 0.35 });
    this.wingGlow = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.95 });
    this.gliderPack = new THREE.Group();
    this.gliderPack.position.set(0, 0.62, -0.31);
    this.gliderPack.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10).rotateZ(Math.PI / 2), ancestral, 0, 0, 0));
    this.gliderPack.add(part(new THREE.TorusGeometry(0.075, 0.012, 6, 16).rotateY(Math.PI / 2), this.wingGlow, 0.12, 0, 0));
    this.gliderPack.add(part(new THREE.TorusGeometry(0.075, 0.012, 6, 16).rotateY(Math.PI / 2), this.wingGlow, -0.12, 0, 0));
    this.gliderPack.visible = false;
    this.torso.add(this.gliderPack);

    this.wings = new THREE.Group();
    this.wings.position.set(0, 1.25, -0.05);
    this.torso.add(this.wings);
    this.wings.add(part(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8).rotateZ(Math.PI / 2), ancestral, 0, 0, 0.12));
    // Emisivo suave: la tela se ve clara también por debajo (cara en sombra al planear).
    const cloth = new THREE.MeshStandardMaterial({ color: '#efe6d2', emissive: '#6d675a', emissiveIntensity: 0.6, roughness: 0.85, side: THREE.DoubleSide });
    const makeWing = (side: number) => {
      const g = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.25);
      shape.lineTo(1.55, 0.05);
      shape.quadraticCurveTo(1.2, -0.45, 0.1, -0.55);
      shape.lineTo(0, 0.25);
      const geo = new THREE.ShapeGeometry(shape, 8).rotateX(Math.PI / 2); // borde de ataque hacia +Z (delante)
      if (side < 0) geo.scale(-1, 1, 1);
      const sail = new THREE.Mesh(geo, cloth);
      sail.castShadow = true;
      g.add(sail);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.025, 0.04), this.wingGlow);
      edge.position.set(side * 0.78, 0.01, 0.15);
      edge.rotation.y = side * 0.13;
      g.add(edge);
      this.wings.add(g);
      return g;
    };
    this.wingL = makeWing(-1);
    this.wingR = makeWing(1);
    this.tipL.position.set(-1.55, 0, 0.05);
    this.tipR.position.set(1.55, 0, 0.05);
    this.wingL.add(this.tipL);
    this.wingR.add(this.tipR);
    this.wings.visible = false;

    this.trailL = new WingTrail();
    this.trailR = new WingTrail();
    this.trails.add(this.trailL.line, this.trailR.line);
    this.trails.name = 'glider-trails';
  }

  setGliderEquipped(on: boolean): void {
    this.gliderPack.visible = on;
  }

  /** Impulso de aterrizaje (0..1) para el squash & stretch. */
  land(intensity: number): void {
    this.squashVel -= clamp(intensity, 0, 1) * 7;
  }

  jump(): void {
    this.squashVel += 4;
  }

  /** Voltereta al aterrizar rodando. */
  roll(): void {
    this.rollT = 0;
  }

  animate(a: PlayerAnimInput, dt: number): void {
    this.time += dt;
    const run = clamp(a.speed / a.jogSpeed, 0, 1.6);
    const airborne = a.mode === 'air';
    this.crouchK = damp(this.crouchK, a.crouch || a.seated ? 1 : 0, 12, dt);
    this.airK = damp(this.airK, airborne && !a.seated ? 1 : 0, 14, dt);
    this.glideK = damp(this.glideK, a.mode === 'glide' ? 1 : 0, 14, dt);
    this.swimK = damp(this.swimK, a.mode === 'swim' ? 1 : 0, 6, dt);

    if (a.mode === 'ground' && !a.sliding) this.phase += a.speed * dt * (a.crouch ? 3.2 : a.sprinting ? 1.9 : 2.3);
    if (a.mode === 'swim') this.phase += dt * (2 + a.speed);
    if (a.climbMoving) this.climbPhase += dt * 7;
    const swing = Math.sin(this.phase) * (a.sprinting ? 0.95 : 0.75) * Math.min(run, 1) * (1 - this.airK) * (a.mode === 'ground' ? 1 : 0);
    const bob = Math.abs(Math.sin(this.phase)) * 0.06 * Math.min(run, 1) * (a.mode === 'ground' ? 1 : 0);

    this.squashVel += (-this.squash * 160 - this.squashVel * 14) * dt;
    this.squash += this.squashVel * dt;
    const sq = clamp(this.squash, -0.3, 0.25);
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.body.position.y = bob - this.crouchK * 0.28;
    this.body.rotation.set(0, 0, 0);

    // --- base: andar / correr / aire
    const airLegs = this.airK * (a.vy > 0 ? 0.6 : 0.3);
    let legL = swing - airLegs - this.crouchK * 0.9;
    let legR = -swing + airLegs * 0.2 - this.crouchK * 0.9;
    let armLx = -swing * 0.9 - this.airK * 0.6;
    let armRx = swing * 0.9 - this.airK * 0.6;
    let armLz = -0.08 - this.airK * 0.5;
    let armRz = 0.08 + this.airK * 0.5;
    let torsoX = run * (a.sprinting ? 0.22 : 0.14) + this.crouchK * 0.35 + (a.sliding ? -0.3 : 0);

    if (a.mode === 'climb') {
      // Brazos alternos hacia arriba, piernas empujando.
      const c = Math.sin(this.climbPhase);
      armLx = -2.6 + c * 0.5;
      armRx = -2.6 - c * 0.5;
      armLz = -0.25;
      armRz = 0.25;
      legL = -0.5 - c * 0.4;
      legR = -0.5 + c * 0.4;
      torsoX = 0.1;
    } else if (a.mode === 'ledge') {
      if (a.ledgePhase === 'contact') {
        armLx = armRx = -3.0;
        armLz = -0.15;
        armRz = 0.15;
        legL = legR = 0.15;
        torsoX = 0.05;
      } else {
        // Impulso: empuja con los brazos y recoge las rodillas.
        armLx = armRx = -0.6;
        armLz = -0.35;
        armRz = 0.35;
        legL = -1.4;
        legR = -0.9;
        torsoX = 0.45;
      }
    } else if (a.mode === 'swim') {
      const k = Math.sin(this.phase * 2);
      legL = 0.35 + k * 0.35;
      legR = 0.35 - k * 0.35;
      armLx = -2.4 + Math.sin(this.phase) * 1.2;
      armRx = -2.4 - Math.sin(this.phase) * 1.2;
      armLz = -0.3;
      armRz = 0.3;
      this.body.rotation.x = 1.1 * this.swimK;
      this.body.position.y -= (a.underwater ? 0.9 : 0.45) * this.swimK;
    }

    // --- planeo: brazos arriba sujetando la barra, cuerpo inclinado y alabeo
    if (this.glideK > 0.01) {
      const k = this.glideK;
      armLx = lerpN(armLx, -2.95, k);
      armRx = lerpN(armRx, -2.95, k);
      armLz = lerpN(armLz, -0.22, k);
      armRz = lerpN(armRz, 0.22, k);
      legL = lerpN(legL, 0.25 + Math.sin(this.time * 3) * 0.05, k);
      legR = lerpN(legR, 0.18 - Math.sin(this.time * 3) * 0.05, k);
      torsoX = lerpN(torsoX, 0.15 + a.glideDive * 0.5, k);
      this.body.rotation.z = -a.glideBank * k;
      this.body.rotation.x = (0.3 + a.glideDive * 0.5) * k;
    }

    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.armL.rotation.x = armLx;
    this.armR.rotation.x = armRx;
    this.armL.rotation.z = armLz;
    this.armR.rotation.z = armRz;
    this.torso.rotation.x = torsoX;
    this.head.rotation.x = -torsoX * 0.6;

    // --- voltereta al rodar
    if (this.rollT >= 0) {
      this.rollT += dt;
      const k = clamp(this.rollT / 0.45, 0, 1);
      this.body.rotation.x += k * Math.PI * 2;
      this.body.position.y -= Math.sin(k * Math.PI) * 0.45;
      if (k >= 1) this.rollT = -1;
    }

    // --- alas: escala con rebote en el despliegue (≤ 0.25 s)
    const d = a.glideDeploy;
    this.wings.visible = d > 0.001;
    this.gliderPack.scale.setScalar(this.gliderPack.visible ? 1 - d : 1);
    if (this.wings.visible) {
      const pop = d < 1 ? Math.sin(d * Math.PI * 0.5) * (1 + Math.sin(d * Math.PI) * 0.12) : 1;
      this.wingL.scale.set(pop, 1, 0.4 + pop * 0.6);
      this.wingR.scale.set(pop, 1, 0.4 + pop * 0.6);
      this.wingL.rotation.z = 0.08 + a.glideBank * 0.25;
      this.wingR.rotation.z = -0.08 + a.glideBank * 0.25;
      this.wingGlow.opacity = 0.7 + Math.sin(this.time * 6) * 0.2;
    }

    // --- estelas cian de las puntas de las alas (espacio mundo)
    const gliding = a.mode === 'glide' && d > 0.6;
    this.root.updateMatrixWorld(true);
    this.trailL.update(gliding ? this.tipL.getWorldPosition(tmpV) : null, dt);
    this.trailR.update(gliding ? this.tipR.getWorldPosition(tmpV) : null, dt);
  }
}

const tmpV = new THREE.Vector3();

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Estela de una punta de ala: polilínea con desvanecimiento por vértice. */
class WingTrail {
  readonly line: THREE.Line;
  private readonly points: THREE.Vector3[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly max = 28;
  private fade = 0;

  constructor() {
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  update(p: THREE.Vector3 | null, dt: number): void {
    if (p) {
      this.points.unshift(p.clone());
      if (this.points.length > this.max) this.points.pop();
      this.fade = 1;
    } else {
      this.fade = Math.max(0, this.fade - dt * 3);
      if (this.points.length) this.points.pop();
    }
    this.line.visible = this.points.length > 1 && this.fade > 0;
    if (!this.line.visible) return;
    for (let i = 0; i < this.max; i++) {
      const q = this.points[Math.min(i, this.points.length - 1)];
      this.positions.set([q.x, q.y, q.z], i * 3);
      const k = (1 - i / this.max) * this.fade;
      this.colors.set([CYAN.r * k, CYAN.g * k, CYAN.b * k], i * 3);
    }
    this.line.geometry.getAttribute('position').needsUpdate = true;
    this.line.geometry.getAttribute('color').needsUpdate = true;
  }
}

/** Pool de partículas de polvo (sprites) para saltos, aterrizajes y salpicaduras. */
export class DustPool {
  readonly group = new THREE.Group();
  private readonly items: { s: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number }[] = [];
  private next = 0;

  constructor(size = 40) {
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
